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
let app, runtime, page;
try {
  app = await _electron.launch({executablePath: binary, args: source ? [resolve("client/desktop/src/main.cjs")] : [], env, timeout: 60000});
  page = await app.firstWindow();
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
  await expect(page.getByRole('treeitem').filter({hasText:'README.md'})).toBeVisible();
  for (let index = 0; index < 8; index++) {
    const folder = join(sandbox, `workspace-${index}`);
    const filename = `visible-${index}.txt`;
    await mkdir(folder);
    await writeFile(join(folder, filename), `workspace ${index}\n`);
    await app.evaluate(({dialog}, folder) => {
      dialog.showOpenDialog = async () => ({canceled:false, filePaths:[folder]});
    }, folder);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
    await expect(page.getByRole('treeitem').filter({hasText:filename})).toBeVisible();
    await expect(page.getByRole('treeitem').filter({hasText:'README.md'})).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
  await page.screenshot({path:resolve('artifacts/terminal-smoke/workspace-tree.png')});
  console.log('Workspace tree: initial listing and eight root switches PASS');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({path:resolve('artifacts/terminal-smoke/failure.png')}).catch(()=>{});
    await page.locator('.xterm-rows').evaluateAll(rows => rows.map(row => ({text:row.textContent, bounds:row.getBoundingClientRect().toJSON()})))
      .then(rows => writeFile(resolve('artifacts/terminal-smoke/failure-terminal.json'), JSON.stringify(rows, null, 2))).catch(()=>{});
  }
  throw error;
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
