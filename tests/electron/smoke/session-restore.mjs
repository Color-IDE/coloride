import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-session-restore-'));
const project = join(sandbox, 'project');
await mkdir(project); await mkdir(join(sandbox, 'home'));
await writeFile(join(project, 'hello.py'), 'print("session restore")\n');
const env = { ...process.env, HOME: join(sandbox, 'home'), COLORIDE_TEST_USER_DATA: join(sandbox, 'profile'),
  COLORIDE_PYTHON: resolveTestPython(), COLORIDE_DEV: '0', COLORIDE_CLOUD_ENABLED: '0', COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1' };
delete env.ELECTRON_RUN_AS_NODE; delete env.COLORIDE_WEB_DEV_URL;
let app, page, runtime;
const launch = async () => {
  app = await _electron.launch({ executablePath: require('electron'), args: [resolve('client/desktop/src/main.cjs')], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await expect(page.locator('[aria-label="Coloride desktop app"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/, { timeout: 60000 });
  await expect.poll(async () => {
    try { runtime = JSON.parse(await readFile(join(sandbox, 'profile/terminal-host.json'), 'utf8')); return true; } catch { return false; }
  }).toBe(true);
};
const terminals = async () => {
  const response = await fetch(`http://${runtime.host}:${runtime.port}/api/term`, { headers: { Authorization: `Bearer ${runtime.token}` } });
  expect(response.ok).toBe(true); return response.json();
};
const openHeaderTerminal = async () => {
  await page.getByRole('button', { name: 'Add tab', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveAttribute('aria-selected', 'true');
};
const shellPid = async filename => {
  const terminal = page.locator('.agent-view-sidebar .xterm').filter({ visible: true });
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText('%');
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(`printf '%s' $$ > ${filename}`); await page.keyboard.press('Enter');
  await expect.poll(() => readFile(join(project, filename), 'utf8').catch(() => '')).toMatch(/^\d+$/);
  return readFile(join(project, filename), 'utf8');
};
try {
  await launch();
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
  await page.getByRole('menuitem', { name: 'Open Project', exact: true }).click();
  await page.getByLabel('Workspace file tree').getByText('hello.py', { exact: true }).click();
  await expect(page.locator('.cm-content').first()).toContainText('session restore');
  await openHeaderTerminal();
  const before = await shellPid('before.pid');
  const header = (await terminals()).find(terminal => terminal.sessionId.startsWith('header-terminal-'));
  expect(header).toBeTruthy();
  // Simulate an old renderer that never persisted its header-tab list.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('coloride.agent.open-tabs.v1.')) localStorage.removeItem(key);
  });
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('data-active', 'true');
  await app.close();
  await launch();
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toHaveAttribute('data-active', 'true');
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.locator('.cm-content').first()).toContainText('session restore');
  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  expect(await shellPid('after.pid')).toBe(before);
  expect((await terminals()).filter(terminal => terminal.sessionId === header.sessionId)).toHaveLength(1);
  // Persist the active terminal as well as the recovered tab itself.
  await app.close(); await launch();
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await shellPid('third.pid')).toBe(before);
  await page.route(`**/api/term/${header.termId}/close`, route => route.fulfill({ status: 503, json: { detail: 'isolated close failure' } }));
  await page.getByRole('button', { name: 'Close chat: Terminal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The terminal is still open');
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toBeVisible();
  expect(await shellPid('failed-close.pid')).toBe(before);
  await page.unroute(`**/api/term/${header.termId}/close`);
  await page.getByRole('button', { name: 'Close chat: Terminal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await terminals()).some(terminal => terminal.termId === header.termId)).toBe(false);
  await app.close(); await launch();
  await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveCount(0);
  expect((await terminals()).filter(terminal => terminal.sessionId.startsWith('header-terminal-'))).toHaveLength(0);
  const settingsMenu = () => app.evaluate(({ Menu }) => {
    const walk = items => items.flatMap(item => [item, ...(item.submenu ? walk(item.submenu.items) : [])]);
    walk(Menu.getApplicationMenu().items).find(item => item.label === 'Settings…').click();
  });
  let opened = app.waitForEvent('window'); await settingsMenu();
  let settings = await opened;
  await settings.getByRole('navigation', { name: 'Settings sections' }).locator('.settings-nav-label').filter({ hasText: /^Appearance$/ }).click();
  await expect(settings.getByRole('region', { name: 'Appearance settings', exact: true })).toBeVisible();
  await expect.poll(() => settings.evaluate(() => localStorage.getItem('coloride.settings.section.v1'))).toBe('appearance');
  const settingsClosed = settings.waitForEvent('close');
  await (await app.browserWindow(settings)).evaluate(win => win.close());
  await settingsClosed;
  opened = app.waitForEvent('window'); await settingsMenu(); settings = await opened;
  await expect(settings.getByRole('region', { name: 'Appearance settings', exact: true })).toBeVisible();
  console.log('PASS: active screen, editor, recovered header terminal, stable shell PID, active tab and confirmed close survive real app restarts.');
} catch (error) {
  console.error('App running:', app && !app.process().killed, 'page closed:', page?.isClosed());
  if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 1500));
  throw error;
} finally {
  await app?.close().catch(() => {});
  if (runtime) {
    try {
      const pids = execFileSync('/usr/sbin/lsof', ['-tiTCP:' + runtime.port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
      const fixturePids = new Set(pids.map(Number));
      const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      let added = true;
      while (added) {
        added = false;
        for (const [pid, parent] of processes) if (fixturePids.has(parent) && !fixturePids.has(pid)) { fixturePids.add(pid); added = true; }
      }
      for (const pid of [...fixturePids].reverse()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    } catch { /* The isolated host may already have stopped. */ }
  }
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
