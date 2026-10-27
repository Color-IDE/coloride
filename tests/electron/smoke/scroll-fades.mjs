import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
// Run with --source [dark|light]. API/model output is simulated; the real IDE
// and its WebSocket event reducer render every transition in isolated user data.
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const source = process.argv[2] === '--source';

const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-package-test-'));
await mkdir(join(sandbox, 'home'));
await mkdir(resolve('artifacts/terminal-smoke'),{recursive:true});
await mkdir(join(sandbox, 'project with spaces'));
await writeFile(join(sandbox, 'project with spaces', 'README.md'), '# Local terminal smoke\n');
await Promise.all(Array.from({length:80}, (_,i) => writeFile(join(sandbox, 'project with spaces', `file-${String(i).padStart(3,'0')}.txt`), 'export const value = 1;')));
const env = {...process.env, HOME: join(sandbox,'home'), COLORIDE_TEST_USER_DATA: join(sandbox,'user-data'),
  COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', SHELL: process.env.COLORIDE_TEST_SHELL ?? '/bin/zsh'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.COLORIDE_WEB_DEV_URL;
env.COLORIDE_PYTHON = resolveTestPython();
env.COLORIDE_DEV = '0';
let app, runtime;
try {
  app = await _electron.launch({executablePath: binary, args: source ? [resolve("client/desktop/src/main.cjs")] : [], env, timeout: 60000});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const pageErrors=[];
  page.on("pageerror", error => pageErrors.push(error.message));
  await expect.poll(async () => {try {runtime = JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await page.route('https://**/*', route => route.abort());
  await expect(page.getByRole('button', {name:'Explorer', exact:true})).toBeVisible({timeout:60000});
  await (await app.browserWindow(page)).evaluate(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });
  expect(await app.evaluate(({app}) => app.getName())).toBe('Coloride');
  await expect(page).toHaveTitle('Coloride');
  await expect(page.getByRole('img', {name: 'Coloride', exact: true})).toBeVisible();
  await page.screenshot({path: resolve('artifacts/terminal-smoke/coloride-welcome.png')});
  const sockets=[];
  await page.routeWebSocket(/\/ws\/events/,ws=>{sockets.push(ws);ws.connectToServer();});
  let session=null;
  await page.route('**/api/agents/config',async route=>{
    const response=await route.fetch();const config=await response.json();
    await route.fulfill({json:{...config,configured:true,availability:'available',managedLlm:false,credentialSource:'environment'}});
  });
  await page.route('**/api/agents/session/start',async route=>{
    const body=route.request().postDataJSON();
    session={sessionId:'transition-fixture',agent:'coloride',task:body.task,cwd:body.cwd,workspaceKind:'local',mode:'act',state:'running',spentUsd:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await route.fulfill({json:{sessionId:session.sessionId}});
  });
  await page.route('**/api/agents/sessions**',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname.endsWith('/transition-fixture'))return route.fulfill({json:session});
    if(pathname.endsWith('/events'))return route.fulfill({json:[{id:'msg',sessionId:'transition-fixture',sequence:1,type:'user_message',data:{text:'hey'},createdAt:new Date().toISOString()}]});
    if(pathname==='/api/agents/sessions')return route.fulfill({json:session?[session]:[]});
    return route.fulfill({json:[]});
  });
  await page.reload();
  await expect(page.getByRole("button",{name:"Explorer",exact:true})).toBeVisible();
  await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); }, join(sandbox,'project with spaces'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  const theme = process.argv[3] ?? 'dark';
  await page.evaluate(theme => { document.body.dataset.theme = theme; }, theme);
  const expected = theme === 'dark' ? '#171717' : '#ffffff';
  const fadeColor = (selector) => page.locator(selector).first().evaluate(el => getComputedStyle(el).getPropertyValue('--scroll-edge-fade-color').trim().replace(/^#fff$/, '#ffffff'));
  expect(await fadeColor('.filetree-edge-fade')).toBe(expected);
  await page.locator('[aria-label="Workspace file tree"]').getByText('file-000.txt', {exact:true}).dblclick();
  await expect(page.locator('.editor-tabs-fade').first()).toBeAttached();
  expect(await fadeColor('.editor-tabs-fade')).toBe(expected);
  await page.locator('[aria-label="Workspace file tree"]').getByText('file-000.txt', {exact:true}).click({button:'right'});
  const treeMenu = page.locator('.filetree-context-menu:not(.editor-context-menu)');
  await expect(treeMenu).toBeVisible();
  const treeWidth = (await treeMenu.boundingBox()).width;
  await page.keyboard.press('Escape');
  await page.locator('.cm-content').click({button:'right'});
  const editorMenu = page.locator('.editor-context-menu');
  await expect(editorMenu).toBeVisible();
  expect((await editorMenu.boundingBox()).width).toBe(treeWidth);
  const clippedLabels = await editorMenu.locator('.filetree-context-item > span:first-child').evaluateAll(labels => {
    const context = document.createElement('canvas').getContext('2d');
    return labels.filter(label => {
      const style = getComputedStyle(label);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = context.measureText(label.textContent);
      return label.getBoundingClientRect().height < metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    }).map(label => label.textContent);
  });
  expect(clippedLabels).toEqual([]);
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/editor-context-width-${theme}.png`)});
  await page.keyboard.press('Escape');
  await page.locator('.filetree-scroll').evaluate(el => { el.scrollTop = 300; });
  await expect(page.locator('.filetree-edge-fade[data-edge="top"]')).toHaveClass(/opacity-100/);
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/scroll-fades-tree-${theme}.png`)});
  await page.getByRole('button', {name:'Settings',exact:true}).click();
  await expect(page.locator('.settings-content-scroll')).toBeVisible();
  expect(await fadeColor('.settings-content-fade')).toBe(expected);
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/scroll-fades-settings-${theme}.png`)});
  expect(pageErrors).toEqual([]);
  console.log(`Tree, editor and settings fades ${theme}: passed`);
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
  await rm(sandbox,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
