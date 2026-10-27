import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
// Run with --source [dark|light]. API/model output is simulated; the real IDE
// and its WebSocket event reducer render every transition in isolated user data.
const require = createRequire(import.meta.url);
const source = process.argv[2] === '--source';

const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-package-test-'));
await mkdir(join(sandbox, 'home'));
await mkdir(resolve('artifacts/terminal-smoke'),{recursive:true});
await mkdir(join(sandbox, 'project with spaces'));
await writeFile(join(sandbox, 'project with spaces', 'README.md'), '# Local terminal smoke\n');
const env = {...process.env, HOME: join(sandbox,'home'), COLORIDE_TEST_USER_DATA: join(sandbox,'user-data'),
  COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', SHELL: process.env.COLORIDE_TEST_SHELL ?? '/bin/zsh'};
delete env.ELECTRON_RUN_AS_NODE;
delete env.COLORIDE_WEB_DEV_URL;
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
  await expect(page.locator('.coloride-brand-svg text').first()).toHaveText('Coloride');
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
  await page.addInitScript(theme=>localStorage.setItem('coloride.app-preferences.v1',JSON.stringify({theme})),process.argv[3] ?? 'dark');
  await page.reload();
  await expect(page.getByRole("button",{name:"Explorer",exact:true})).toBeVisible();
  await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); }, join(sandbox,'project with spaces'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  const column=page.locator('.agent-view-sidebar .agent-chat-column');
  await expect(column).toHaveClass(/is-empty-chat/,{timeout:30000});
  await page.waitForTimeout(500);
  expect(sockets.length).toBeGreaterThan(0);
  const theme=process.argv[3] ?? 'dark';
  await page.evaluate(theme=>document.body.dataset.theme=theme,theme);
  await column.locator('textarea').fill('hey');
  await page.evaluate(()=>{
    window.transitionFrames=[];
    const record=()=>{
      const column=document.querySelector('.agent-view-sidebar .agent-chat-column');
      const bubble=column?.querySelector('.agent-user-message');
      const turn=column?.querySelector('.agent-turn.has-user');
      if(bubble)window.transitionFrames.push({y:bubble.getBoundingClientRect().y,wrapY:bubble.parentElement.getBoundingClientRect().y,turnY:turn.getBoundingClientRect().y,turnHeight:turn.getBoundingClientRect().height,scroll:column.querySelector('.agent-timeline').scrollTop,transform:getComputedStyle(turn).transform,inputHeight:column.querySelector('textarea').getBoundingClientRect().height});
      window.transitionRaf=requestAnimationFrame(record);
    };record();
  });
  await column.locator('textarea').press('Enter');
  await expect(column.locator('.agent-user-message-text')).toHaveText('hey');
  await page.waitForTimeout(250);
  const emit=(sequence,type,data)=>sockets.forEach(ws=>ws.send(JSON.stringify({event:'agent:event',payload:{id:'evt-'+sequence,sessionId:'transition-fixture',sequence,type,data,createdAt:new Date().toISOString()}})));
  emit(2,'reasoning_delta',{text:'Considering the greeting.',delta:'Considering the greeting.'});
  await page.waitForTimeout(250);
  const responseGap = await column.locator('.agent-turn').evaluate(turn => {
    const prompt = turn.querySelector('.agent-user-message');
    const response = turn.querySelector('.agent-turn-body');
    return response.getBoundingClientRect().top - prompt.getBoundingClientRect().bottom;
  });
  expect(responseGap).toBe(16);
  emit(3,'tool_call',{itemId:'git-fixture',tool:'git_status',arguments:{}});
  emit(4,'tool_output',{itemId:'git-fixture',tool:'git_status',text:'On branch main\nNothing to commit'});
  emit(5,'tool_result',{itemId:'git-fixture',tool:'git_status',failed:false});
  emit(6,'tool_call',{itemId:'cmd-fixture',tool:'execute_command',arguments:{command:'npm test'}});
  emit(7,'tool_output',{itemId:'cmd-fixture',tool:'execute_command',text:'9 tests passed'});
  emit(8,'tool_result',{itemId:'cmd-fixture',tool:'execute_command',failed:false});
  for (const group of await column.locator('.agent-explore-group > .agent-thinking-toggle').all()) {
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
  }
  await expect(column.locator('.agent-tool-row')).toHaveCount(2);
  const information=column.locator('.agent-tool-row.is-informational');
  await expect(information).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(information).toHaveCSS('border-top-width','0px');
  const command=column.locator('.agent-tool-row.is-command');
  await expect(command).toHaveCSS('background-color',theme==='light'?'rgb(244, 244, 245)':'rgb(27, 27, 27)');
  await expect(command).toHaveCSS('border-radius','8px');
  await expect(command).toHaveCSS('border-top-width','1px');
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/plain-activities-${theme}.png`)});
  console.log('Git query plain and command card restored PASS',theme);
  emit(9,'text' ,{text:'Hey. What do you want to work on in this project?'});
  await expect(column).toContainText('What do you want to work on');
  await page.waitForTimeout(250);
  emit(10,'done',{});
  session.state='idle';
  sockets.forEach(ws=>ws.send(JSON.stringify({event:'agent:state',payload:{sessionId:session.sessionId,state:'idle'}})));
  await page.waitForTimeout(750);
  const frames=await page.evaluate(()=>{cancelAnimationFrame(window.transitionRaf);return window.transitionFrames;});
  const movement=Math.max(...frames.map(f=>f.y))-Math.min(...frames.map(f=>f.y));
  console.log(`Sidebar ${theme}: ${frames.length} frames; prompt movement ${movement}px`);
  expect(frames.length).toBeGreaterThan(10);
  expect(Math.max(...frames.map(f=>f.y))-Math.min(...frames.map(f=>f.y))).toBeLessThanOrEqual(0.5);
  await page.screenshot({path:resolve(`artifacts/terminal-smoke/sidebar-stability-${theme}.png`)});
  console.log('Submit + streamed response + completion stable PASS');
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
