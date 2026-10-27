// Run alone: exercises real Electron and only disposable profiles/PTYs.
import { _electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const dev = process.argv.includes('--dev');
assert(process.argv.slice(2).every(arg => arg === '--dev'), 'Usage: node tests/electron/smoke/host-startup.mjs [--dev]');
assert.equal(process.platform, 'darwin', 'This smoke currently uses macOS fixture-host cleanup.');
if (dev) {
  assert((await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(2000) })).ok, 'Start pnpm dev:web first.');
} else await readFile(join(root, 'client/ide/dist/index.html'));

const sandbox = await realpath(await mkdtemp(join(tmpdir(), 'coloride-host-startup-')));
const home = join(sandbox, 'home');
const userData = join(sandbox, 'user-data');
const project = join(sandbox, 'project with spaces');
const file = join(project, 'startup.txt');
const output = join(root, 'artifacts/host-startup', dev ? 'dev' : 'production');
await Promise.all([home, userData, project, output].map(folder => mkdir(folder, { recursive: true })));
await writeFile(file, 'ColorIDE startup fixture\n');
const env = { ...process.env, HOME: home, COLORIDE_TEST_USER_DATA: userData,
  COLORIDE_DEV: dev ? '1' : '0', COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1',
  COLORIDE_VOICE_PREWARM: '0', SHELL: '/bin/bash' };
for (const key of ['ELECTRON_RUN_AS_NODE', 'COLORIDE_WEB_DEV_URL', 'COLORIDE_SIDECAR']) delete env[key];
env.COLORIDE_PYTHON = resolveTestPython();
const samples = [];
const report = { mode: dev ? 'Vite' : 'production renderer', timestamp: new Date().toISOString(),
  conditions: 'Checkout Electron/source host, isolated HOME/profile/project, OS caches unchanged; UI timings include Playwright overhead.',
  samples, status: 'running' };
let app, runtime, releasePendingRoutes;

async function readRuntime() {
  runtime = JSON.parse(await readFile(join(userData, 'terminal-host.json'), 'utf8'));
  return runtime;
}
function hostPid() {
  const pids = execFileSync('/usr/sbin/lsof', ['-tiTCP:' + runtime.port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.equal(pids.length, 1, 'Expected one isolated fixture host.');
  assert(Number(pids[0]) > 0, 'Missing isolated host PID.');
  return Number(pids[0]);
}
async function closeApp() {
  await app?.close();
  app = null;
}
async function stopHost() {
  if (!runtime) return;
  let pid;
  try { pid = hostPid(); } catch { return; }
  const base = `http://${runtime.host}:${runtime.port}`;
  const headers = { Authorization: `Bearer ${runtime.token}` };
  try {
    try {
      const sessions = await (await fetch(base + '/api/term', { headers, signal: AbortSignal.timeout(2000) })).json();
      for (const session of sessions) await fetch(`${base}/api/term/${session.termId}/close`, { method: 'POST', headers, signal: AbortSignal.timeout(2000) });
    } finally { process.kill(pid, 'SIGTERM'); }
    await expect.poll(async () => {
      try { return (await fetch(base + '/api/health', { headers, signal: AbortSignal.timeout(200) })).ok; }
      catch { return false; }
    }, { timeout: 5000 }).toBe(false);
  } finally {
    // A closed listener does not prove the detached process exited: background
    // tasks can keep it alive. This PID belongs only to the temporary fixture.
    try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
  }
}
function durationMs(value, unit) {
  return Number(value) * (unit === 's' ? 1000 : 1);
}
async function scenario(name, { restored = name === 'reused', holdSshProbes = false } = {}) {
  const started = performance.now();
  const sample = { scenario: name, logs: '' };
  samples.push(sample);
  app = await _electron.launch({ executablePath: require('electron'),
    args: [join(root, 'client/desktop/src/main.cjs')], env, timeout: 60000 });
  app.process().stdout.on('data', data => { sample.logs += String(data); });
  const blockedSshProbes = [];
  if (holdSshProbes) {
    const gate = new Promise(done => { releasePendingRoutes = done; });
    // Install on the context before the app navigates from its native loading
    // page, so a fast reused host cannot finish the probes before interception.
    await app.context().route(/\/api\/(?:profiles|conn\/state)(?:\?|$)/, async route => {
      blockedSshProbes.push(new URL(route.request().url()).pathname);
      await gate;
      await route.continue().catch(() => {});
    });
  }
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.route('https://**/*', route => route.abort());
  await expect(page.getByRole('button', { name: 'Explorer', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
  sample.uiReadyMs = performance.now() - started;
  await expect.poll(() => sample.logs.includes('[Electron] app loaded in')).toBe(true);
  const timings = sample.logs.match(/app loaded in ([\d.]+) (ms|s) \(sidecar: ([\d.]+) (ms|s), renderer: ([\d.]+) (ms|s)\)/);
  assert(timings, 'Missing real main-process startup timings.');
  sample.appLoadedMs = durationMs(timings[1], timings[2]);
  sample.sidecarReadyMs = durationMs(timings[3], timings[4]);
  sample.rendererMs = durationMs(timings[5], timings[6]);
  await readRuntime();
  sample.hostPid = hostPid();
  sample.hostPort = runtime.port;
  await (await app.browserWindow(page)).evaluate(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });

  if (!restored) {
    // A replacement host serves the production renderer on a new origin/port,
    // so its localStorage has no restored folder. Reuse keeps the same origin
    // and must restore the project and existing shell without this action.
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', { detail: 'open-local-folder' })));
  }
  const tree = page.getByLabel('Workspace file tree');
  await expect(tree).toBeVisible();
  await tree.getByText('startup.txt', { exact: true }).click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toContainText('ColorIDE startup fixture');
  await editor.click();
  await page.keyboard.press('Meta+a');
  const edited = `ColorIDE startup fixture\nedited ${name}\n`;
  await page.keyboard.insertText(edited);
  await expect(editor).toContainText(`edited ${name}`);
  await page.keyboard.press('Meta+s');
  await expect.poll(() => readFile(file, 'utf8')).toBe(edited);
  sample.editAcceptedMs = performance.now() - started;
  if (holdSshProbes) {
    assert(blockedSshProbes.includes('/api/profiles'), 'The saved-profiles request must have been held during restore.');
    sample.blockedSshProbes = [...blockedSshProbes];
    sample.editedBeforeSshProbesReleased = true;
    releasePendingRoutes();
    releasePendingRoutes = null;
  }

  const showTerminal = page.getByRole('button', { name: 'Show terminal', exact: true }).first();
  if (await showTerminal.isVisible()) await showTerminal.click();
  await expect(page.locator('[data-terminal-status=ready]').first()).toBeVisible();
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.insertText(`printf '%s' $$ > ${name}.pid; printf '\\nSTARTUP_%s\\n' ${name.toUpperCase()}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows').first()).toContainText(`STARTUP_${name.toUpperCase()}`);
  const pidFile = join(project, `${name}.pid`);
  await expect.poll(async () => { try { return await readFile(pidFile, 'utf8'); } catch { return ''; } }).toMatch(/^\d+$/);
  sample.shellPid = Number(await readFile(pidFile, 'utf8'));
  sample.terminalCommandMs = performance.now() - started;
  await page.screenshot({ path: join(output, `${name}.png`) });
  await closeApp();
  console.log(`${name}: sidecar ${sample.sidecarReadyMs} ms, app ${sample.appLoadedMs} ms, UI ${sample.uiReadyMs.toFixed(0)} ms; editor + terminal PASS`);
  return sample;
}

try {
  const fresh = await scenario('fresh');
  await stopHost(); // Retain discovery exactly as a stopped host does.
  const stopped = await scenario('stopped');
  assert.notEqual(stopped.hostPid, fresh.hostPid, 'Stopped host must be replaced.');
  assert(stopped.sidecarReadyMs < 6000, 'Stopped discovery added a long startup stall.');
  assert(stopped.sidecarReadyMs - fresh.sidecarReadyMs < 2000, 'Stopped discovery must not add more than 2 seconds to fresh startup.');
  const reused = await scenario('reused');
  assert.equal(reused.hostPid, stopped.hostPid, 'Healthy persistent host was restarted.');
  assert.equal(reused.hostPort, stopped.hostPort, 'Healthy persistent host port changed.');
  assert.equal(reused.shellPid, stopped.shellPid, 'Healthy terminal shell was restarted.');
  const slowSsh = await scenario('reused-slow-ssh', { restored: true, holdSshProbes: true });
  assert.equal(slowSsh.hostPid, reused.hostPid, 'Delayed SSH probes must not restart the healthy host.');
  assert.equal(slowSsh.hostPort, reused.hostPort, 'Delayed SSH probes must preserve the local origin.');
  assert.equal(slowSsh.shellPid, reused.shellPid, 'Delayed SSH probes must preserve the existing shell.');
  // PID/port/shell identity proves reuse. Early console output can precede
  // Playwright's launch attachment and is not reliable as an assertion.
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  releasePendingRoutes?.();
  await closeApp().catch(() => {});
  try { await readRuntime(); } catch {}
  try { await stopHost(); } catch {}
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`Report: ${join(output, 'report.json')}`);
}
