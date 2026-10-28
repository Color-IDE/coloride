import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const source = process.argv[2] === '--source';

const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-package-test-'));
await mkdir(join(sandbox, 'home'));
await mkdir(resolve('artifacts/terminal-smoke'),{recursive:true});
await mkdir(resolve('artifacts/notifications'),{recursive:true});
await mkdir(join(sandbox, 'project with spaces'));
await writeFile(join(sandbox, 'project with spaces', 'README.md'), '# Local terminal smoke\n');
const env = {...process.env, HOME: join(sandbox,'home'), COLORIDE_TEST_USER_DATA: join(sandbox,'user-data'),
  COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', SHELL: process.env.COLORIDE_TEST_SHELL ?? '/bin/zsh'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.COLORIDE_WEB_DEV_URL;
env.COLORIDE_DEV = '0';
env.COLORIDE_PYTHON = resolveTestPython();
let app, runtime;
try {
  app = await _electron.launch({executablePath: binary, args: source ? [resolve("client/desktop/src/main.cjs")] : [], env, timeout: 60000});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const pageErrors=[];
  page.on("pageerror", error => pageErrors.push(error.message));
  await expect.poll(async () => {try {runtime = JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await page.route('https://**/*', route => route.abort());
  await expect(page.getByRole('menuitem', {name:'Open Project', exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
  await (await app.browserWindow(page)).evaluate(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });
  expect(await app.evaluate(({app}) => app.getName())).toBe('Coloride');
  await expect(page).toHaveTitle('Coloride');
  await expect(page.getByRole('img', {name: 'Coloride', exact: true})).toBeVisible();
  await expect.poll(() => page.getByRole('img', {name:'Coloride', exact:true}).evaluate(image =>
    image.complete && image.naturalWidth > 0 && image.src.includes('coloride-mark'))).toBe(true);
  await page.screenshot({path: resolve('artifacts/terminal-smoke/coloride-welcome.png')});
  await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); }, join(sandbox,'project with spaces'));
  await page.getByRole('menuitem', {name:'Open Project', exact:true}).click();
  await expect(page.getByRole('button', {name:'Explorer', exact:true})).toBeVisible();
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  // Real shell actions use the shared notification viewport, with one notice
  // per operation even if the menu action is repeated.
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-ssh-workspace'})));
  }
  const notices = page.getByRole('region', {name:'Notifications', exact:true});
  await expect(notices.locator('.notification-card')).toHaveCount(1);
  await expect(notices).toContainText('SSH connections are turned off in this build.');
  await expect(notices.locator('li')).toHaveCSS('opacity', '1');
  await page.screenshot({path: resolve('artifacts/notifications/local-workspace.png')});
  await notices.getByRole('button', {name:'Dismiss: Workspace notice', exact:true}).click();
  await expect(notices.locator('.notification-card')).toHaveCount(0);
  await page.route('**/api/agents/config', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fulfill({json:{...route.request().postDataJSON(), configured:false,
      availability:'missing_credentials', managedLlm:false, credentialSource:'user', capabilities:{tools:true}}});
  });
  await expect(page.locator('.agent-chat-column.is-empty-chat')).toBeVisible();
  const composerBeforeModelChange = await page.locator('textarea.agent-composer-input').boundingBox();
  await page.locator('.agent-composer-model-trigger').click();
  await page.getByRole('menuitem', {name: /Grok 4\.5|Gemini 3\.8 Flash/}).click();
  // A provider without a saved key is absent from the flyout. The catalog-error
  // notice is covered by the agent restore spec, which stubs that catalog.
  await expect(page.getByText('Add an API key in Settings to load models.', {exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const composerAfterModelChange = await page.locator('textarea.agent-composer-input').boundingBox();
  expect(composerAfterModelChange.y).toBeCloseTo(composerBeforeModelChange.y, 0);
  expect(composerAfterModelChange.height).toBeCloseTo(composerBeforeModelChange.height, 0);
  await expect(page.locator('.agent-composer-retry-error, .agent-view > .agent-error')).toHaveCount(0);
  await expect(notices.locator('.notification-card')).toHaveCount(0);
  await page.screenshot({path: resolve('artifacts/notifications/agent-provider-error.png')});
  const terminalToggle = page.getByRole('button', {name:'Show terminal', exact:true}).first();
  if (await terminalToggle.isVisible()) await terminalToggle.click();
  await expect(page.locator('[data-terminal-status=ready]').first()).toBeVisible({timeout:30000});
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.insertText("printf 'PACKAGED_%s\\n' LOCAL > smoke.txt; cat smoke.txt");
  await page.keyboard.press('Enter');
  await expect.poll(async () => {try {return await readFile(join(sandbox,'project with spaces','smoke.txt'),'utf8');} catch{return '';}}).toBe('PACKAGED_LOCAL\n');
  const outputRow = page.locator('.xterm-rows > div').filter({hasText:'PACKAGED_LOCAL'}).first();
  await expect(outputRow).toBeVisible();
  const bounds = await outputRow.boundingBox();
  if (!bounds) throw new Error('Packaged terminal output has no bounds');
  const clip = {x:Math.ceil(bounds.x),y:Math.ceil(bounds.y),width:Math.floor(bounds.width),height:Math.floor(bounds.height)};
  await expect.poll(async () => (await app.browserWindow(page)).evaluate(async (win,clip) => {
    const bitmap = (await win.capturePage(clip)).toBitmap();
    let ink=0;
    for(let i=0;i<bitmap.length;i+=4) if(Math.max(bitmap[i],bitmap[i+1],bitmap[i+2])>100) ink++;
    return ink;
  },clip)).toBeGreaterThan(30);
  await writeFile(resolve('artifacts/terminal-smoke/packaged-terminal.png'), await (await app.browserWindow(page)).evaluate(async win => (await win.capturePage()).toPNG()));
  // Exercise the real TerminalPanel layer, not the component harness.
  const viewport = page.locator('.xterm-viewport').first();
  const geometry = async () => page.locator('[data-terminal-surface="true"]').first().evaluate(el => {
    const screen = el.querySelector('.xterm-screen');
    const viewport = el.querySelector('.xterm-viewport');
    const host = el.getBoundingClientRect(), grid = screen.getBoundingClientRect();
    const surface=el.closest('[data-terminal-surface-pane]');
    const slot=document.querySelector(`[data-terminal-surface-slot="${surface.dataset.terminalSurfacePane}"]`);
    const offset=surface.getBoundingClientRect().top-slot.getBoundingClientRect().top;
    return {offset, host: host.toJSON(), grid: grid.toJSON(), scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
      scrollbar: getComputedStyle(viewport, '::-webkit-scrollbar').display};
  });
  console.log('Full IDE baseline geometry', JSON.stringify(await geometry()));
  await expect.poll(async () => (await geometry()).scrollbar).not.toBe('none');
  await expect(viewport).toHaveCSS('cursor','default');
  const input = async text => {
    await page.locator('.xterm-helper-textarea').first().focus();
    await page.keyboard.insertText(text); await page.keyboard.press('Enter');
  };
  await input("awk 'BEGIN {for(i=1;i<=250;i++) print \"IDE_HISTORY_\" i}'");
  await expect(page.locator('.xterm-rows').first()).toContainText('IDE_HISTORY_250');
  const win = await app.browserWindow(page);
  console.log('Full IDE: resize');
  for (const [width,height] of [[1100,800],[1600,1000],[900,700],[1300,900]]) {
    await win.evaluate((win,size) => win.setSize(...size), [width,height]);
    await expect.poll(async () => {
      const g = await geometry();
      return Math.abs(g.offset)<0.5 && g.grid.right <= g.host.right + 1 && g.grid.bottom <= g.host.bottom + 1 && g.grid.width > 100;
    }).toBe(true);
  }
  await page.locator('.xterm-screen').first().hover(); await page.mouse.wheel(0,-1000);
  await expect.poll(async () => {const g=await geometry(); return g.scrollTop < g.scrollHeight-g.clientHeight-50;}).toBe(true);
  console.log('Full IDE: panel toggles');
  // Exercise actual IDE chrome while output and font geometry are live.
  for (const pair of [['Hide agent panel','Show agent panel'], ['Hide side panel','Show side panel'], ['Hide terminal','Show terminal']]) {
    const hide = page.getByRole('button',{name:pair[0],exact:true}).first();
    if (await hide.isVisible() && await hide.isEnabled()) {
      await hide.click();
      await page.getByRole('button',{name:pair[1],exact:true}).first().click();
    }
  }
  await input("printf '%s' $$ > pid-before.txt");
  await expect.poll(async () => {try{return await readFile(join(sandbox,'project with spaces','pid-before.txt'),'utf8');}catch{return '';}}).toMatch(/^\d+$/);
  const pid = await readFile(join(sandbox,'project with spaces','pid-before.txt'),'utf8');
  const {createServer} = await import('node:net');
  const port = await new Promise(resolve => {const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
  const quote = s => "'"+s.replaceAll("'", "'\\''")+"'";
  await writeFile(join(sandbox,'project with spaces','package.json'),JSON.stringify({scripts:{dev:`${quote(process.execPath)} ${quote(resolve('client/ide/node_modules/vite/bin/vite.js'))} --host 127.0.0.1 --port ${port} --strictPort`}}));
  await writeFile(join(sandbox,'project with spaces','index.html'),'<script type="module" src="/main.ts"></script>');
  await writeFile(join(sandbox,'project with spaces','main.ts'),'import "./missing.ts";');
  console.log('Full IDE: npm run dev');
  await input('npm run dev');
  await expect(page.locator('.xterm-rows').first()).toContainText('Local:');
  for(let i=0;i<3;i++) await fetch(`http://127.0.0.1:${port}/main.ts`);
  await expect(page.locator('.xterm-rows').first()).toContainText('viteTransformMiddleware');
  await page.locator('.xterm-screen').first().hover(); await page.mouse.wheel(0,-500);
  await expect.poll(async () => {const g=await geometry(); return g.scrollTop < g.scrollHeight-g.clientHeight-20;}).toBe(true);
  await page.locator('.xterm-helper-textarea').first().focus(); await page.keyboard.press('Control+c');
  await input("printf '%s' $$ > pid-after.txt; printf '\\nVISIBLE_%s\\n' AFTER");
  await expect.poll(async () => {try{return await readFile(join(sandbox,'project with spaces','pid-after.txt'),'utf8');}catch{return '';}}).toBe(pid);
  await expect(page.locator('.xterm-rows').first()).toContainText('VISIBLE_AFTER');
  const finalRow = page.locator('.xterm-rows > div').filter({hasText:'VISIBLE_AFTER'}).first();
  const finalBox = await finalRow.boundingBox();
  if (!finalBox) throw new Error('Revealed output has no geometry');
  await expect.poll(async () => win.evaluate(async (win, box) => {
    const pixels=(await win.capturePage({x:Math.ceil(box.x),y:Math.ceil(box.y),width:Math.floor(box.width),height:Math.floor(box.height)})).toBitmap();
    let ink=0; for(let i=0;i<pixels.length;i+=4) if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>100) ink++;
    return ink;
  },finalBox)).toBeGreaterThan(30);
  console.log('Full IDE: split');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:terminal-command',{detail:'split'})));
  await expect(page.locator('.xterm-screen')).toHaveCount(2);
  await expect(page.locator('[data-terminal-status=ready]')).toHaveCount(2);
  await expect.poll(async () => {
    const g=await geometry(); return g.grid.right <= g.host.right+1 && g.grid.width>100;
  }).toBe(true);
  await writeFile(resolve('artifacts/terminal-smoke/full-ide-terminal.png'), await win.evaluate(async win => (await win.capturePage()).toPNG()));
  runtime = JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));
  if (runtime.terminalHostVersion !== 5) throw new Error('Wrong packaged terminal host version');
  if (env.COLORIDE_CLOUD_ENABLED === '0') {
    expect(await page.evaluate(() => window.colorideDesktop.cloudConfig.enabled)).toBe(false);
    expect(await page.evaluate(() => window.colorideDesktop.cloudAuth.hasSession())).toBe(false);
    const headers = {Authorization: `Bearer ${runtime.token}`};
    const blocked = await fetch(`http://${runtime.host}:${runtime.port}/api/cloud-auth/device/code`, {method:'POST', headers});
    expect(blocked.status).toBe(403);
    const config = await (await fetch(`http://${runtime.host}:${runtime.port}/api/agents/config`, {headers})).json();
    expect(config.managedLlm).toBe(false);
  }
  // Old account links open General in the native Settings window.
  const settingsOpened = app.waitForEvent('window');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:open-settings', {detail:{section:'account'}})));
  const settings = await settingsOpened;
  settings.setDefaultTimeout(15000);
  await expect(settings.getByRole('region', {name:'General settings', exact:true})).toBeVisible();
  await expect(settings.getByRole('navigation', {name:'Settings sections'}).getByRole('button', {name:'Account', exact:true})).toHaveCount(0);
  await expect(settings.locator('.settings-account')).toHaveCount(0);
  await settings.screenshot({path: resolve('artifacts/terminal-smoke/settings-without-account.png')});
  await expect(page.getByRole('button', {name:'Account menu', exact:true})).toHaveCount(0);
  if (await page.evaluate(() => window.colorideDesktop.cloudConfig.enabled)) {
    const signIn = page.getByRole('button', {name:'Sign in', exact:true});
    await expect(signIn).toBeVisible();
    await page.screenshot({path: resolve('artifacts/terminal-smoke/titlebar-sign-in.png')});
    // Stub cloud boundaries in this isolated fixture; never open a real browser or account.
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('coloride:cloudAuth:requestDeviceCode');
      ipcMain.handle('coloride:cloudAuth:requestDeviceCode', () => ({
        device_code:'fixture-challenge', expires_in:900,
        verification_uri_complete:'https://login.example.test/device?challenge=fixture',
      }));
      ipcMain.removeHandler('coloride:cloudAuth:pollDeviceCode');
      ipcMain.handle('coloride:cloudAuth:pollDeviceCode', () => ({status:'pending'}));
      ipcMain.removeHandler('coloride:openExternal');
      ipcMain.handle('coloride:openExternal', (_event, url) => { globalThis.fixtureLoginUrl = url; return true; });
    });
    await signIn.click();
    await expect(page.getByRole('button', {name:'Cancel sign in', exact:true})).toBeVisible();
    expect(await app.evaluate(() => globalThis.fixtureLoginUrl)).toBe('https://login.example.test/device?challenge=fixture');
    await page.getByRole('button', {name:'Cancel sign in', exact:true}).click();
    await expect(signIn).toBeVisible();
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('coloride:cloudAuth:requestDeviceCode');
      ipcMain.handle('coloride:cloudAuth:requestDeviceCode', () => { throw new Error('Fixture cloud unavailable'); });
    });
    await signIn.click();
    await expect(page.getByRole('alert')).toContainText('Could not sign in');
    await expect(signIn).toBeEnabled();
  } else {
    await expect(page.getByRole('button', {name:'Sign in', exact:true})).toHaveCount(0);
  }

  expect(pageErrors).toEqual([]);
  console.log(`${source ? 'Source' : 'Packaged'} full IDE: local PTY, native scroll, resizing and splits PASS`);
} finally {
  await app?.close().catch(()=>{});
  if (!runtime) {try {runtime=JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));} catch {}}
  if (runtime) {
    const headers = {Authorization:`Bearer ${runtime.token}`};
    const sessions = await (await fetch(`http://${runtime.host}:${runtime.port}/api/term`,{headers})).json();
    for (const session of sessions) await fetch(`http://${runtime.host}:${runtime.port}/api/term/${session.termId}/close`,{method:'POST',headers});
  }
  // The app intentionally leaves the host alive. Terminate only this isolated
  // fixture's host by its discovery port, never a user's installed host.
  const {execFileSync} = await import('node:child_process');
  if (runtime) {
    try {
      const pids=execFileSync('/usr/sbin/lsof',['-tiTCP:'+runtime.port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim().split(/\s+/);
      for(const pid of pids) if(Number(pid)>0) process.kill(Number(pid),'SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      for(const pid of pids) if(Number(pid)>0) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    } catch {}
  }
  await rm(sandbox,{recursive:true,force:true});
}
