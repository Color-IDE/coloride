// Real file-tree checks: only disposable projects and an isolated Electron profile.
import {_electron, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {resolveTestPython} = require('../support/python.cjs');
const sandbox = await realpath(await mkdtemp(join(tmpdir(), 'coloride-tree-')));
const project = join(sandbox, 'project with spaces');
const second = join(sandbox, 'second project');
const output = resolve('artifacts/file-tree');
const results = [], logs = [], requests = [], errors = [];
let app, page, runtime;
// Attribute escaping without interpreting fixture names as CSS syntax.
const item = path => page.locator(`[data-tree-path=${JSON.stringify(path)}]`);
const root = () => page.locator('.filetree-workspace-toggle');
const scroll = () => page.getByLabel('Workspace file tree', {exact: true});
const top = async () => { await scroll().evaluate(el => {el.scrollTop = 0;}); };
async function check(name, run) {
  const start = performance.now();
  try { const detail = await run(); results.push({name, status: 'passed', ms: Math.round(performance.now()-start), detail}); }
  catch(error) { results.push({name, status: 'failed', ms: Math.round(performance.now()-start), error: String(error)}); await page?.screenshot({path:join(output, `${results.length}-failure.png`)}).catch(()=>{}); }
  console.log(`${results.at(-1).status.toUpperCase()}: ${name}`, JSON.stringify(results.at(-1).detail ?? results.at(-1).error ?? ''));
}
async function menu(target, label) {
  await target.click({button:'right'});
  await page.getByRole('menuitem', {name:label, exact:true}).click();
}
async function openProject(path) {
  await app.evaluate(({dialog}, folder) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]});}, path);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
  await expect(root()).toHaveAttribute('title', path, {timeout:30000});
  await expect(scroll()).toBeVisible();
}
async function apiList(path, limit=1000) {
  const response = await fetch(`http://${runtime.host}:${runtime.port}/api/files/list`, {method:'POST',headers:{Authorization:`Bearer ${runtime.token}`,'Content-Type':'application/json'},body:JSON.stringify({path,offset:0,limit})});
  assert(response.ok, `list ${response.status}`); return response.json();
}
try {
  await Promise.all([output, join(sandbox,'home'), second, ...['alpha/nested/deeper','empty','large','slow','unicode ñ'].map(p=>join(project,p))].map(p=>mkdir(p,{recursive:true})));
  await Promise.all([
    writeFile(join(project,'root.txt'),'root fixture\n'),
    writeFile(join(project,'alpha','one.txt'),'alpha fixture\n'),
    writeFile(join(project,'alpha/nested/deeper','leaf.txt'),'deep fixture\n'),
    writeFile(join(project,'slow','slow.txt'),'slow fixture\n'),
    writeFile(join(project,'unicode ñ','árbol 空.txt'),'unicode fixture\n'),
    writeFile(join(second,'second.txt'),'second project\n'),
    ...Array.from({length:650},(_,i)=>writeFile(join(project,'large',`file-${String(i).padStart(4,'0')}.txt`),`fixture ${i}\n`))
  ]);
  const env = {...process.env, HOME:join(sandbox,'home'), COLORIDE_TEST_USER_DATA:join(sandbox,'profile'), COLORIDE_DEV:'0', COLORIDE_CLOUD_ENABLED:'0', COLORIDE_SENTRY_DISABLED:'1', COLORIDE_SKIP_UPDATE_CHECK:'1', COLORIDE_PYTHON:resolveTestPython()};
  for(const key of ['ELECTRON_RUN_AS_NODE','COLORIDE_WEB_DEV_URL','COLORIDE_SIDECAR']) delete env[key];
  app = await _electron.launch({executablePath:require('electron'),args:[resolve('client/desktop/src/main.cjs')],env,timeout:60000});
  for(const stream of ['stdout','stderr']) app.process()[stream]?.on('data',data=>logs.push({source:stream,text:data.toString()}));
  page = await app.firstWindow(); page.setDefaultTimeout(6000);
  await (await app.browserWindow(page)).evaluate(win => {win.webContents.setBackgroundThrottling(false);win.showInactive();});
  page.on('console', msg=>{if(['warning','error'].includes(msg.type())) logs.push({source:'renderer',type:msg.type(),text:msg.text()});});
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('requestfailed',request=>logs.push({source:'requestfailed',url:new URL(request.url()).pathname,error:request.failure()?.errorText}));
  page.on('response',response=>{
    if(!response.url().includes('/api/')) return;
    const request=response.request(); let body; try{body=request.postDataJSON();}catch{}
    const record={time:Date.now(),path:new URL(response.url()).pathname,status:response.status(),method:request.method(),filePath:body?.path,offset:body?.offset,limit:body?.limit};
    requests.push(record);
    if(record.path==='/api/files/list') void response.json().then(data=>{record.entries=data.entries?.length;}).catch(()=>{});
  });
  page.on('dialog',dialog=>dialog.accept());
  await expect(page.getByRole('menuitem',{name:'Open Project',exact:true})).toBeVisible({timeout:60000});
  await expect.poll(async()=>{try{runtime=JSON.parse(await readFile(join(sandbox,'profile/terminal-host.json'),'utf8'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
  await check('Open local folder and show root entries',async()=>{
    await app.evaluate(({dialog}, folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},project);
    await page.getByRole('menuitem',{name:'Open Project',exact:true}).click();
    await expect(item(join(project,'alpha'))).toBeVisible({timeout:6000});
    await expect(item(join(project,'root.txt'))).toBeVisible();
  });
  // Keep the opening failure in the report, then recover through the real UI
  // so one empty-tree bug does not turn every later scenario into a cascade.
  if (await item(join(project,'alpha')).count() === 0) {
    await check('Manual refresh recovers empty initial tree', async () => {
      await writeFile(join(output,'empty-root.json'),JSON.stringify({rootTitle:await root().getAttribute('title'),rows:await page.locator('[data-tree-path]').count(),rootListings:requests.filter(r=>r.path==='/api/files/list'&&r.filePath===project)},null,2));
      await menu(root(),'Refresh');await expect(item(join(project,'alpha'))).toBeVisible();
    });
  }
  await check('Expand nested folders and open deep file',async()=>{
    for(const part of ['alpha','alpha/nested','alpha/nested/deeper']) {await item(join(project,part)).click();await expect(item(join(project,part))).toHaveAttribute('aria-busy','false');}
    const leaf=join(project,'alpha/nested/deeper/leaf.txt');await expect(item(leaf)).toBeVisible();await item(leaf).click();
    await expect(page.locator('.cm-content')).toContainText('deep fixture');
  });
  await check('Collapse and reopen cached directory',async()=>{
    const folder=join(project,'alpha'), leaf=join(folder,'one.txt');await item(folder).click();await expect(item(leaf)).toHaveCount(0);
    const before=requests.filter(r=>r.path==='/api/files/list'&&r.filePath===folder).length;
    await item(folder).click();await expect(item(leaf)).toBeVisible();
    return {listRequestsBefore:before,listRequestsAfter:requests.filter(r=>r.path==='/api/files/list'&&r.filePath===folder).length};
  });
  await check('Open empty folder without stuck loading',async()=>{const p=join(project,'empty');await item(p).click();await expect(item(p)).toHaveAttribute('aria-busy','false');await item(p).click();});
  await check('Names with spaces, accents and non-Latin characters',async()=>{await item(join(project,'unicode ñ')).click();await item(join(project,'unicode ñ/árbol 空.txt')).click();await expect(page.locator('.cm-content')).toContainText('unicode fixture');});
  await check('Rapid toggle while directory response is pending',async()=>{
    const folder=join(project,'slow');let held, release;const gate=new Promise(r=>release=r);const arrived=new Promise(r=>held=r);
    const handler=async route=>{const body=route.request().postDataJSON();if(body.path!==folder)return route.continue();held();await gate;await route.continue();};
    await page.route('**/api/files/list',handler);
    try {await item(folder).click();await Promise.race([arrived,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No slow listing request')),5000))]);
      await item(folder).click();release();await expect(item(folder)).toHaveAttribute('aria-busy','false');await expect(item(join(folder,'slow.txt'))).toHaveCount(0);
      await item(folder).click();await expect(item(join(folder,'slow.txt'))).toBeVisible();
    }finally{release();await page.unroute('**/api/files/list',handler);}
  });
  await check('Collapse and expand whole workspace',async()=>{await root().click();await expect(scroll()).toHaveCount(0);await root().click();await expect(item(join(project,'root.txt'))).toBeVisible();});
  await check('External create and delete update an expanded directory',async()=>{
    const path=join(project,'alpha/external.txt');await writeFile(path,'external fixture\n');await expect(item(path)).toBeVisible({timeout:15000});await rm(path);await expect(item(path)).toHaveCount(0,{timeout:15000});
  });
  await check('Create folder and file through context menu',async()=>{
    await top();await menu(root(),'New Folder');const input=page.locator('.filetree-body input');await input.fill('created');await input.press('Enter');await expect(item(join(project,'created'))).toBeVisible();
    await menu(item(join(project,'created')),'New File');await input.fill('created.txt');await input.press('Enter');await expect(item(join(project,'created/created.txt'))).toBeVisible();assert((await stat(join(project,'created/created.txt'))).isFile());
  });
  await check('Rename, delete and undo a file',async()=>{
    const old=join(project,'created/created.txt'), renamed=join(project,'created/renamed.txt');await menu(item(old),'Rename');const input=page.getByLabel('Rename created.txt',{exact:true});await input.fill('renamed.txt');await input.press('Enter');await expect(item(renamed)).toBeVisible();assert((await stat(renamed)).isFile());
    await menu(item(renamed),'Delete');await expect(item(renamed)).toHaveCount(0);await expect.poll(async()=>{try{await stat(renamed);return false;}catch{return true;}}).toBe(true);
    await menu(root(),'Undo');await expect(item(renamed)).toBeVisible();assert((await stat(renamed)).isFile());
  });
  await check('Collapse All and Expand All preserve deep entries',async()=>{await menu(root(),'Collapse All');await expect(item(join(project,'alpha/one.txt'))).toHaveCount(0);await menu(root(),'Expand All');await expect(item(join(project,'alpha/nested/deeper/leaf.txt'))).toBeVisible({timeout:15000});await menu(root(),'Collapse All');});
  await check('Large folder exposes every file, including number 650',async()=>{
    await top();const folder=join(project,'large');await item(folder).click();await expect(item(join(folder,'file-0000.txt'))).toBeVisible();
    await scroll().evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(item(join(folder,'file-0649.txt'))).toBeVisible();
    const actual=await apiList(folder);const listed=requests.filter(r=>r.path==='/api/files/list'&&r.filePath===folder);const detail={filesOnDisk:650,apiEntriesWithLimit1000:actual.entries.length,treeListings:listed.map(r=>({offset:r.offset,limit:r.limit,entries:r.entries})),lastVisiblePaths:await page.locator('[data-tree-path]').evaluateAll(nodes=>nodes.slice(-5).map(n=>n.dataset.treePath))};
    await writeFile(join(output,'large-folder.json'),JSON.stringify(detail,null,2));
    await expect(item(join(folder,'file-0649.txt'))).toBeVisible({timeout:1500});return detail;
  });
  await check('Keyboard ArrowRight expands focused folder',async()=>{await top();await menu(root(),'Collapse All');await item(join(project,'alpha')).focus();await page.keyboard.press('ArrowRight');await expect(item(join(project,'alpha/one.txt'))).toBeVisible({timeout:1000});});
  await check('Keyboard navigation moves focus through virtual rows and parents',async()=>{
    await menu(root(),'Collapse All');const alpha=item(join(project,'alpha'));await alpha.focus();
    await page.keyboard.press('End');await expect(item(join(project,'root.txt'))).toBeFocused();
    await page.keyboard.press('Home');await expect(alpha).toBeFocused();
    await page.keyboard.press('ArrowRight');await expect(alpha).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('ArrowRight');await expect(item(join(project,'alpha/nested'))).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(alpha).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(alpha).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('ArrowDown');await expect(item(join(project,'created'))).toBeFocused();
    await page.keyboard.press('ArrowUp');await expect(alpha).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(root()).toBeFocused();
    await page.keyboard.press('ArrowLeft');await expect(root()).toHaveAttribute('aria-expanded','false');
    await page.keyboard.press('ArrowRight');await expect(root()).toHaveAttribute('aria-expanded','true');
    await item(join(project,'large')).click();await item(join(project,'large/file-0000.txt')).focus();
    await page.keyboard.press('End');await expect(item(join(project,'root.txt'))).toBeFocused();
    await page.keyboard.press('Home');await expect(alpha).toBeFocused();await menu(root(),'Collapse All');
  });
  await check('Watcher detects changes beyond the first 500 entries',async()=>{
    // Tree writes intentionally defer the watcher for 12s; allow that quiet period plus polling.
    const folder=join(project,'large');await item(folder).click();const extra=join(folder,'zz-added.txt');await writeFile(extra,'external large-folder addition\n');
    await expect.poll(async()=>{await scroll().evaluate(el=>{el.scrollTop=el.scrollHeight;});return item(extra).isVisible();},{timeout:30000}).toBe(true);
    await rm(extra);await expect(item(extra)).toHaveCount(0,{timeout:15000});await top();await menu(root(),'Collapse All');
  });
  await check('Folder rows expose expansion state to accessibility tools',async()=>{await top();await expect(item(join(project,'alpha'))).toHaveAttribute('aria-expanded',/true|false/,{timeout:1000});});
  await check('Manual refresh keeps nested folders usable',async()=>{await menu(root(),'Collapse All');await item(join(project,'alpha')).click();await expect(item(join(project,'alpha/one.txt'))).toBeVisible();await menu(root(),'Refresh');await expect(item(join(project,'alpha/one.txt'))).toBeVisible();await item(join(project,'alpha')).click();await item(join(project,'alpha')).click();await expect(item(join(project,'alpha/one.txt'))).toBeVisible();});
  await check('Switch project without an empty or stale tree',async()=>{
    await top();await menu(root(),'Collapse All');await openProject(second);await expect(item(join(second,'second.txt'))).toBeVisible();await expect(page.locator(`[data-tree-path^=${JSON.stringify(project+'/')}]`)).toHaveCount(0);
    await openProject(project);await expect(item(join(project,'alpha'))).toBeVisible();

  });
  await check('Late directory response cannot leak into another project',async()=>{
    await top();await menu(root(),'Collapse All');const folder=join(project,'slow');let release,arrived;
    const gate=new Promise(resolve=>release=resolve), started=new Promise(resolve=>arrived=resolve);
    const handler=async route=>{if(route.request().postDataJSON().path!==folder)return route.continue();arrived();await gate;await route.continue();};
    await page.route('**/api/files/list',handler);
    try {
      await item(folder).click();await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No delayed listing')),5000))]);
      await openProject(second);await expect(item(join(second,'second.txt'))).toBeVisible();
      const finished=page.waitForResponse(response=>response.url().endsWith('/api/files/list')&&response.request().postDataJSON()?.path===folder);
      release();await finished;await expect(page.locator(`[data-tree-path^=${JSON.stringify(project+'/')}]`)).toHaveCount(0);
      await expect(item(join(second,'second.txt'))).toBeVisible();await openProject(project);await expect(item(join(project,'alpha'))).toBeVisible();
    } finally {release();await page.unroute('**/api/files/list',handler);}
  });
  await check('Logs contain no CSP, Sentry IPC or update URL errors',async()=>{
    assert.deepEqual(logs.filter(row=>/Content Security Policy|Sentry SDK failed|ERR_INVALID_URL/.test(row.text||'')),[]);
  });
  await page.screenshot({path:join(output,'final.png')});
  await check('No uncaught renderer exceptions',async()=>assert.deepEqual(errors,[]));
} catch(error) {await page?.screenshot({path:join(output,'startup-failure.png')}).catch(()=>{});results.push({name:'Harness startup',status:'failed',error:String(error)});console.error(error);}
finally {
  await app?.close().catch(error=>logs.push({source:'cleanup',text:String(error)}));
  await writeFile(join(output,'report.json'),JSON.stringify({conditions:'Real source Electron, production renderer, disposable local project and isolated HOME/profile; no user workspace mutations.',results,errors,failedApiRequests:requests.filter(r=>r.status>=400)},null,2));
  await writeFile(join(output,'logs.json'),JSON.stringify(logs,null,2));await writeFile(join(output,'requests.json'),JSON.stringify(requests,null,2));
  const hostLog = await readFile(join(sandbox,'profile/logs/terminal-host.log'),'utf8').catch(()=>'');
  await writeFile(join(output,'host.log'),hostLog.replace(/([?&]token=)[^\s"&]+/g,'$1[redacted]'));
  await rm(sandbox,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,report:join(output,'report.json')}));
process.exitCode=results.some(r=>r.status==='failed')?1:0;
