// Run alone. Native input is restricted to fresh fixture process/window IDs.
import assert from 'node:assert/strict';
import { _electron } from '@playwright/test';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startResourceSampler, visualSamples, summarizeComparison } from './protocol.mjs';
const execute=promisify(execFile), require=createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=join(root,'artifacts/performance/comparison');
const plan=JSON.parse(await readFile(join(output,'plan.json'),'utf8'));
const probe=process.argv.includes('--probe');
assert(probe || process.argv.includes('--experimental'), 'Comparative adapters are unfinished; use --probe, or --experimental for unverified raw captures only.');
const editorArg=process.argv.find(arg=>arg.startsWith('--editor='))?.split('=')[1];
assert(plan.permissions.screenRecording && plan.permissions.accessibility,'Native permissions required');
const tools=join(root,'artifacts/performance/tools'), driver=join(tools,'native-driver');
for(const name of ['native-driver','native-capture']) execFileSync('/usr/bin/swiftc',['-O',join(root,`tests/electron/benchmarks/${name}.swift`),'-o',join(tools,name)]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const native=async(pid,...args)=>{
 for(let attempt=0;;attempt++){
  try{return JSON.parse((await execute(driver,['--pid',String(pid),...args],{maxBuffer:5e6})).stdout);}
  catch(error){
   // Retry only a failed observation, never an input action or timed sample.
   if(args.includes('--clicks')||args.includes('--bounds')||attempt>=3||!error.stdout?.includes('-3811'))throw error;
   await sleep(300);
  }
 }
};
const normalize=text=>text.toUpperCase().replace(/[^A-Z0-9]/g,'');
let application,hostPid,pid,activeSampler,captureProcess;
const executions=[];
async function cleanup(){
 if(activeSampler){await activeSampler.stop().catch(()=>{});activeSampler=null;}
 if(captureProcess && captureProcess.exitCode===null)captureProcess.kill('SIGTERM');
 captureProcess=null;
 if(application){await application.close().catch(()=>{});application=null;}
 else if(pid){try{process.kill(pid,'SIGTERM');}catch{}}
 if(hostPid){try{process.kill(hostPid,'SIGTERM');}catch{}}
 pid=null;hostPid=null;
}
async function launch(entry){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('VSCODE_')&&!key.startsWith('ELECTRON_')));
 Object.assign(env,{HOME:entry.home,COLORIDE_SENTRY_DISABLED:'1',COLORIDE_SKIP_UPDATE_CHECK:'1'});
 const folder=dirname(plan.files[0].path);
 if(entry.editor==='coloride'){
  Object.assign(env,{COLORIDE_TEST_USER_DATA:join(entry.profile,'user-data'),COLORIDE_DEV:'0',SHELL:'/bin/bash'});
  for(const key of ['COLORIDE_WEB_DEV_URL','COLORIDE_SIDECAR'])delete env[key];
  env.COLORIDE_PYTHON=resolveTestPython();
  application=await _electron.launch({executablePath:require('electron'),args:[join(root,'client/desktop/src/main.cjs')],env,timeout:60000});
  pid=application.process().pid;
  const page=await application.firstWindow();page.setDefaultTimeout(30000);
  await page.getByRole('button',{name:'Open a local folder',exact:true}).waitFor();
  // Fixture setup only; no Playwright input or DOM clocks are used in timed blocks.
  await page.evaluate(settings=>localStorage.setItem('coloride.app-preferences.v1',JSON.stringify(settings)),plan.settings.coloride);
  await page.reload();
  await page.getByRole('button',{name:'Open a local folder',exact:true}).waitFor();
  await application.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
  await page.getByRole('button',{name:'Open a local folder',exact:true}).click();
  await page.getByLabel('Workspace file tree').getByText(plan.files[0].name,{exact:true}).waitFor();
  const runtime=JSON.parse(await readFile(join(entry.profile,'user-data/terminal-host.json'),'utf8'));
  hostPid=Number(execFileSync('/usr/sbin/lsof',['-tiTCP:'+runtime.port,'-sTCP:LISTEN'],{encoding:'utf8'}).trim());
 }else{
  const args=['--user-data-dir',join(entry.profile,'user-data'),'--extensions-dir',join(entry.profile,'extensions'),'--disable-extensions','--new-window','--skip-welcome','--skip-release-notes',folder,plan.files[0].path];
  await execute('/usr/bin/open',['-n','/Applications/Visual Studio Code.app','--args',...args],{env});
  for(let attempt=0;attempt<60;attempt++){
   const rows=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
   const row=rows.find(line=>line.includes('/Applications/Visual Studio Code.app/Contents/MacOS/Code')&&line.includes(entry.profile));
   if(row){pid=Number(row.trim().split(/\s+/)[0]);break;}await sleep(250);
  }
  assert(pid,'Isolated editor process did not start');
 }
 let inspected;
 for(let attempt=0;attempt<30;attempt++){
  try{inspected=await native(pid);break;}catch(error){if(attempt===29)throw error;await sleep(300);}
 }
 const setup=inspected.ocr.find(row=>/Stay in Restricted Mode/i.test(row.text));
 if(setup){const path=join(output,'setup-click.json');await writeFile(path,JSON.stringify([{x:setup.x,y:setup.y}]));await native(pid,'--window-id',String(inspected.windowID),'--clicks',path);}
 await native(pid,'--window-id',String(inspected.windowID),'--bounds','96,80,1400,900');
 await sleep(500);
 inspected=await native(pid,'--window-id',String(inspected.windowID));
 return inspected;
}
function fileRows(inspected){
 const rows=new Map();
 for(const row of inspected.ocr){
  const text=normalize(row.text),match=text.match(/(\d{3})(?:SAMPLE|WARMUP)TXT/);
  if(!match)continue;
  const id=Number(match[1]);if(id>20)continue;
  // Explorer rows share one x region. Keep every candidate until that region is identified.
  if(!rows.has(id))rows.set(id,[]);rows.get(id).push(row);
 }
 assert.equal(rows.size,21,'All fixture rows must be visible before timing');
 const unique=Array.from(rows.entries()).filter(([id])=>id>0 && id<20).flatMap(([,values])=>values);
 const x=unique.map(row=>row.x).sort((a,b)=>a-b)[Math.floor(unique.length/2)];
 return new Map([...rows].map(([id,values])=>[id,values.reduce((a,b)=>Math.abs(a.x-x)<Math.abs(b.x-x)?a:b)]));
}
try{
 for(const entry of plan.schedule.filter(entry=>!editorArg||entry.editor===editorArg)){
  if(probe){
   entry.profile=await mkdtemp('/tmp/cide-probe-');entry.home=join(entry.profile,'home');
   await mkdir(entry.home,{recursive:true});await mkdir(join(entry.profile,'extensions'),{recursive:true});
   if(entry.editor!=='coloride'){
    const path=join(entry.profile,'user-data/User/settings.json');
    await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(plan.settings[entry.editor],null,2));
   }
  }
  assert.equal(entry.status,'pending','Refusing to reuse a measured profile');
  console.log(`SETUP ${entry.editor} round ${entry.round}`);
  const inspected=await launch(entry);
  const rows=fileRows(inspected);
  const warmupPath=join(output,'warmup-click.json');await writeFile(warmupPath,JSON.stringify([{x:rows.get(0).x,y:rows.get(0).y,fileId:0}]));
  await native(pid,'--window-id',String(inspected.windowID),'--clicks',warmupPath);
  const warmup=await native(pid,'--window-id',String(inspected.windowID));
  assert(warmup.ocr.some(row=>normalize(row.text).includes(normalize(plan.files[0].marker))),'Warmup marker must be visible');
  assert.deepEqual(warmup.frame,[96,80,1400,900],'Common geometry required');
  const marker=warmup.ocr.find(row=>normalize(row.text).includes(normalize(plan.files[0].marker)));
  const crop=[Math.max(0,Math.floor(marker.x-240)),Math.max(0,Math.floor(marker.y-25)),600,65];
  assert(crop[0]+crop[2]<1400 && crop[1]+crop[3]<900);
  const runDir=join(output,probe?'adapter-probes':'runs',entry.editor,`round-${entry.round}`);await mkdir(runDir,{recursive:true});
  const evidence={profile:entry.profile,pid,hostPid,settings:plan.settings[entry.editor],window:warmup,crop};
  await writeFile(join(runDir,'configuration.json'),JSON.stringify(evidence,null,2));
  if(probe){console.log(`PROBE PASSED ${entry.editor} PID ${pid}`);await cleanup();break;}
  const clicks=entry.fileOrder.map(id=>({fileId:id,x:rows.get(id).x,y:rows.get(id).y}));
  const clicksPath=join(runDir,'clicks.json');await writeFile(clicksPath,JSON.stringify(clicks));
  const sampler=await startResourceSampler([pid,...(hostPid?[hostPid]:[])]);activeSampler=sampler;await sleep(2000);
  const capture=spawn(plan.recorder,['--pid',String(pid),'--window-id',String(warmup.windowID),'--output',runDir,'--rect',crop.join(','),'--seconds','17']);
  captureProcess=capture;
  let log='',errors='';capture.stderr.on('data',chunk=>{errors+=chunk;});
  const completion=new Promise((resolve,reject)=>{capture.on('error',reject);capture.on('exit',code=>code===0?resolve():reject(new Error(`Capture exit ${code}: ${errors} ${log}`)));});
  completion.catch(()=>{}); // Cleanup can stop capture after another setup/input error.
  await new Promise((resolve,reject)=>{capture.stdout.on('data',chunk=>{log+=chunk;if(log.includes('"status":"recording"'))resolve();});capture.on('exit',()=>{if(!log.includes('"status":"recording"'))reject(new Error(log+errors));});});
  sampler.markPhase('active');
  try{await native(pid,'--window-id',String(warmup.windowID),'--clicks',clicksPath);}finally{
   const resources=await sampler.stop();activeSampler=null;await writeFile(join(runDir,'resources.json'),JSON.stringify(resources,null,2));
  }
  await completion;
  const pixels=JSON.parse(await readFile(join(runDir,'capture.json'),'utf8'));
  const samples=visualSamples(pixels,plan.files,entry.fileOrder);
  const resources=JSON.parse(await readFile(join(runDir,'resources.json'),'utf8'));
  const result={editor:entry.editor,round:entry.round,profile:entry.profile,method:'native-visible-frame-v1',
   environmentFingerprint:createHash('sha256').update(JSON.stringify({environment:plan.environment,frame:warmup.frame})).digest('hex'),
   // A settings snapshot and a single calibration smoke are not sufficient
   // to certify both adapters. Keep publication blocked until that
   // independent verification is implemented.
   configurationVerified:false,captureCalibrated:false,samples,resources};
  executions.push(result);entry.status='completed';plan.results=executions;
  await writeFile(join(output,'partial-results.json'),JSON.stringify(executions,null,2));
  await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2));
  console.log(`COMPLETED ${entry.editor} round ${entry.round}: ${samples.length} openings`);
  await cleanup();await sleep(500);
 }
 if(!probe&&!editorArg){const summary=summarizeComparison(executions);await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));}
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,completed:executions.length},null,2));throw error;}
finally{await cleanup();}
