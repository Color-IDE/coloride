import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
// Run with --source in isolated user data. Results are simulated unless COLORIDE_VOICE_TEST_WAV enables the actual bundled engine.
// This check does not request microphone or Speech Recognition permission.
const require = createRequire(import.meta.url);
const { resolveTestPython } = require('../support/python.cjs');
const source = process.argv[2] === '--source';
const realAudio = process.env.COLORIDE_VOICE_TEST_WAV ? resolve(process.env.COLORIDE_VOICE_TEST_WAV) : null;

const binary = source ? require('electron') : resolve(process.argv[2] ?? 'artifacts/terminal-smoke/package/mac-arm64/Coloride.app/Contents/MacOS/Coloride');
const sandbox = await mkdtemp(join(tmpdir(), 'coloride-package-test-'));
await mkdir(join(sandbox, 'home'));
await mkdir(resolve('artifacts/terminal-smoke'),{recursive:true});
await mkdir(join(sandbox, 'project with spaces'));
await writeFile(join(sandbox, 'project with spaces', 'README.md'), '# Local terminal smoke\n');
const env = {...process.env, HOME: join(sandbox,'home'), COLORIDE_TEST_USER_DATA: join(sandbox,'user-data'),
  COLORIDE_SENTRY_DISABLED: '1', COLORIDE_SKIP_UPDATE_CHECK: '1', SHELL: process.env.COLORIDE_TEST_SHELL ?? '/bin/zsh'};
env.COLORIDE_VOICE_PREWARM = '0';
delete env.ELECTRON_RUN_AS_NODE;
delete env.COLORIDE_WEB_DEV_URL;
env.COLORIDE_DEV = '0';
env.COLORIDE_PYTHON = resolveTestPython();
let app, runtime;
try {
  app = await _electron.launch({executablePath: binary, args: source ? [resolve("client/desktop/src/main.cjs"), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"], env, timeout: 60000});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const pageErrors=[];
  page.on("pageerror", error => pageErrors.push(error.message));
  await expect.poll(async () => {try {runtime = JSON.parse(await readFile(join(sandbox,'user-data','terminal-host.json'),'utf8'));return true;}catch{return false;}},{timeout:60000}).toBe(true);
  await page.route('https://**/*', route => route.abort());
  await expect(page.getByRole('button', {name:'Explorer', exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
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
  // A stale manual preference must never disable automatic recognition.
  await page.evaluate(() => localStorage.setItem('coloride.voice-language', 'en'));
  await page.reload();
  await expect(page.getByRole("button",{name:"Explorer",exact:true})).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-startup', /.+/);
  await app.evaluate(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); }, join(sandbox,'project with spaces'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('coloride:app-menu-action', {detail:'open-local-folder'})));
  await expect(page.getByLabel('Workspace file tree')).toBeVisible();
  const column=page.locator('.agent-view-sidebar .agent-chat-column');
  await expect(column).toHaveClass(/is-empty-chat/,{timeout:30000});
  await page.waitForTimeout(500);
  expect(sockets.length).toBeGreaterThan(0);
  const theme=process.argv[3] ?? 'dark';
  await page.evaluate(theme=>document.body.dataset.theme=theme,theme);
  if (realAudio) {
    // Keep the actual preload, IPC, runtime and recognition engine. Only the
    // hardware microphone is replaced by a known speech WAV in this test app.
    await app.evaluate(({ipcMain}) => {
      global.voiceTrace = [];
      for (const name of ['coloride:dictation:start', 'coloride:dictation:stop']) {
        const original = ipcMain._invokeHandlers.get(name);
        ipcMain.removeHandler(name);
        ipcMain.handle(name, async (event, ...args) => {
          global.voiceTrace.push({name, phase:'call', at:Date.now()});
          try {
            const result = await original(event, ...args);
            global.voiceTrace.push({name, phase:'result', cancelled:result?.cancelled, at:Date.now()});
            return result;
          } catch (error) {
            global.voiceTrace.push({name, phase:'error', message:error.message, at:Date.now()});
            throw error;
          }
        });
      }
    });
    // Chromium's fake file flag is inconsistent in Electron; feed the known
    // WAV through a MediaStream instead. Permission and every app layer remain real.
    await page.evaluate(bytes => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const hardware = await getUserMedia(constraints);
        const context = new AudioContext({sampleRate:16000});
        const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        await context.resume();
        source.start(context.currentTime + .1);
        let stopped = false;
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            if (stopped) return;
            stopped = true;
            source.stop();
            hardware.getTracks().forEach(track => track.stop());
            void context.close();
          };
        }
        return destination.stream;
      };
    }, [...await readFile(realAudio)]);
    await column.evaluate(el => {
      window.voiceUiTrace=[];
      window.voiceFrames={count:0, peak:0};
      const OriginalNode=window.AudioWorkletNode;
      window.AudioWorkletNode=class extends OriginalNode {
        constructor(...args) {
          super(...args);
          this.port.addEventListener('message', ({data}) => {
            if (!(data instanceof ArrayBuffer)) return;
            window.voiceFrames.count++;
            for(const value of new Int16Array(data)) window.voiceFrames.peak=Math.max(window.voiceFrames.peak,Math.abs(value));
          });
        }
      };
      let previous='';
      new MutationObserver(() => {
        const state=JSON.stringify({pressed:el.querySelector('.agent-voice-button')?.getAttribute('aria-pressed'),status:el.querySelector('[role=status]')?.textContent,error:el.querySelector('[role=alert]')?.textContent,value:el.querySelector('textarea')?.value});
        if(state!==previous) {window.voiceUiTrace.push({at:Date.now(),state});previous=state;}
      }).observe(el,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-pressed','readonly']});
    });
    try {
    const input = column.locator('textarea');
    await input.fill('Borrador:');
    const voice = column.getByRole('button', {name: 'Dictate message'});
    await voice.click();
    await expect.poll(() => page.evaluate(() => window.voiceFrames.count), {timeout:30000}).toBeGreaterThan(3);
    await expect(column.getByRole('combobox', {name:'Dictation language'})).toHaveCount(0);
    await expect(column.getByRole('status')).toHaveCount(0);
    await page.waitForTimeout(7000);
    await page.screenshot({path: resolve('artifacts/terminal-smoke/voice-input-starting.png')});
    await column.getByRole('button', {name: 'Stop dictation'}).click();
    await expect(voice).toHaveAttribute('aria-pressed', 'false', {timeout: 150000});
    await expect(input).toHaveValue(/Borrador:.*hola/i);
    await expect(column.getByRole('alert')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    const capture = await page.evaluate(() => window.voiceFrames);
    expect(capture.count).toBeGreaterThan(0);
    expect(capture.peak).toBeGreaterThan(1000);
    const ipcTrace = await app.evaluate(() => global.voiceTrace);
    expect(ipcTrace.some(entry => entry.phase === 'error' || entry.cancelled)).toBe(false);
    const hypotheses = await page.evaluate(() => window.voiceUiTrace.map(entry => JSON.parse(entry.state).value || ''));
    expect(hypotheses.some(text => /hello|we are testing/i.test(text))).toBe(false);
    await page.screenshot({path: resolve('artifacts/terminal-smoke/voice-input-real-engine.png')});
    console.log('Real automatic model + microphone PCM + startup buffer + stop + composer PASS');
    console.log('Recognized:', await input.inputValue());
    // A second capture reuses the loaded engine: measure first actual Spanish
    // text while the microphone is still running, rather than timing startup.
    await input.fill('Warm:');
    const warmStart = Date.now();
    await voice.click();
    await expect(input).toHaveValue(/Warm:.*hola/i, {timeout:30000});
    const firstTextMs = Date.now() - warmStart;
    await expect(column.getByRole('button', {name:'Stop dictation'})).toBeEnabled();
    await column.getByRole('button', {name:'Stop dictation'}).click();
    await expect(voice).toHaveAttribute('aria-pressed', 'false', {timeout:60000});
    await expect(voice).toHaveAttribute('title', 'Dictate message');
    await expect(column.getByRole('status')).toHaveCount(0);
    await expect(column.getByRole('alert')).toHaveCount(0);
    console.log('Warm automatic first Spanish text while recording:', firstTextMs, 'ms');
    } finally {
      console.log('Voice IPC trace:', JSON.stringify(await app.evaluate(() => global.voiceTrace)));
      console.log('Voice capture:', JSON.stringify(await page.evaluate(() => window.voiceFrames)));
      console.log('Voice UI trace:', JSON.stringify(await page.evaluate(() => window.voiceUiTrace)));
    }
  } else {
  // Exercise real microphone capture/PCM with Chromium's synthetic audio device.
  let pcmFrames = 0;
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:19876\/asr(?:\?|$)/, socket => {
    expect(new URL(socket.url()).searchParams.get('language')).toBe('auto');
    socket.send(JSON.stringify({type:'config',useAudioWorklet:true}));
    socket.onMessage(message => {
      if (message.length === 0) {
        socket.send(JSON.stringify({lines:[{text:'Hola, revisa este archivo.'}],buffer_transcription:''}));
        socket.send(JSON.stringify({type:'ready_to_stop'}));
      } else {
        pcmFrames++;
        if (pcmFrames === 1) socket.send(JSON.stringify({lines:[],buffer_transcription:'Hola'}));
        if (pcmFrames === 4) socket.send(JSON.stringify({lines:[{text:'Hola,'}],buffer_transcription:'revisa este archivo.'}));
      }
    });
  });
  await app.evaluate(({ipcMain}) => {
    ipcMain.removeHandler('coloride:dictation:start');
    ipcMain.removeHandler('coloride:dictation:stop');
    global.voiceFixture = {id:null, starts:0, aborts:0};
    ipcMain.handle('coloride:dictation:start', async (event, {id}) => {
      global.voiceFixture.id = id;
      global.voiceFixture.starts++;
      if (global.voiceFixture.starts === 2) throw new Error('Microphone permission denied.');
      if (global.voiceFixture.starts >= 3) await new Promise(resolve => {global.voiceFixture.release = resolve;});
      return {url:'ws://127.0.0.1:19876/asr'};
    });
    ipcMain.handle('coloride:dictation:stop', () => {global.voiceFixture.aborts++;});
  });
  const input = column.locator('textarea');
  await input.fill('Borrador:');
  const voice = column.getByRole('button', {name:'Dictate message'});
  await expect(voice).toBeVisible();
  await expect(voice).toBeEnabled();
  await app.evaluate(({app}) => app.focus({steal:true}));
  await page.bringToFront();
  await voice.hover();
  await voice.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  await expect.poll(() => voice.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(255, 255, 255, 0.1)');
  const shape = await voice.evaluate(el => ({ radius: getComputedStyle(el).borderRadius, width: el.clientWidth, height: el.clientHeight, icon: el.querySelector('svg').getAttribute('width') }));
  expect(shape).toEqual({radius:'50%', width:24, height:24, icon:'14'});
  await page.screenshot({path:resolve('artifacts/terminal-smoke/voice-input-hover.png')});
  await page.evaluate(() => {
    window.voiceCues = [];
    window.voiceCaptureFrames = 0;
    const OriginalNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends OriginalNode {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', ({data}) => {if(data instanceof ArrayBuffer) window.voiceCaptureFrames++;});
      }
    };
    window.voiceCueVolumes = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.voiceCues.push(this.src);
      window.voiceCueVolumes.push(this.volume);
      return play.call(this);
    };
  });
  await voice.click();
  await expect(input).toHaveClass(/is-voice-provisional/);
  await expect(column.getByRole('status')).toHaveCount(0);
  await expect(column.getByRole('button', {name:'Stop dictation'})).toHaveAttribute('aria-pressed','true');
  await input.press('Enter');
  await expect(input).toHaveValue('Borrador: Hola, revisa este archivo.');
  expect(pcmFrames).toBeGreaterThanOrEqual(4);
  expect(session).toBeNull();
  for (const theme of ['dark','light']) {
    await page.evaluate(theme=>document.body.dataset.theme=theme,theme);
    await page.screenshot({path:resolve(`artifacts/terminal-smoke/voice-input-${theme}.png`)});
  }
  const provisionalColor = await input.evaluate(el => getComputedStyle(el).color);
  await column.getByRole('button', {name:'Stop dictation'}).click();
  await expect(input).toHaveValue('Borrador: Hola, revisa este archivo.');
  await expect(voice).toHaveAttribute('aria-pressed','false');
  await expect(input).not.toHaveClass(/is-voice-provisional/);
  expect(await input.evaluate(el => getComputedStyle(el).color)).not.toBe(provisionalColor);
  const cues = await page.evaluate(() => window.voiceCues);
  expect(cues).toHaveLength(2);
  expect(await page.evaluate(() => window.voiceCueVolumes)).toEqual([0.25, 0.25]);
  expect(cues[0]).toMatch(/clasp[^/]*\.wav/);
  expect(cues[1]).toMatch(/unclasp[^/]*\.wav/);
  expect(session).toBeNull();
  await voice.click();
  await expect(voice).toHaveAttribute('title', /Microphone permission denied/);
  await expect(column.getByRole('alert')).toHaveCount(0);
  await expect(input).toHaveValue('Borrador: Hola, revisa este archivo.');
  await expect(voice).toHaveAttribute('aria-pressed','false');
  await expect(input).not.toHaveClass(/is-voice-provisional/);
  const previousFrames = await page.evaluate(() => window.voiceCaptureFrames);
  const previousPcm = pcmFrames;
  const beforeWarmupAborts = await app.evaluate(() => global.voiceFixture.aborts);
  await voice.click();
  await expect(column.getByRole('status')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.voiceCaptureFrames)).toBeGreaterThan(previousFrames + 3);
  expect(pcmFrames).toBe(previousPcm); // model endpoint is still unavailable
  await column.getByRole('button', {name:'Stop dictation'}).click();
  await expect(column.getByRole('button', {name:'Stop dictation'})).toBeDisabled();
  await expect(column.getByRole('status')).toHaveCount(0);
  expect(await app.evaluate(() => global.voiceFixture.aborts)).toBe(beforeWarmupAborts);
  await app.evaluate(() => global.voiceFixture.release());
  await expect(voice).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toHaveValue('Borrador: Hola, revisa este archivo. Hola, revisa este archivo.');
  expect(pcmFrames).toBeGreaterThan(previousPcm + 3);
  await expect(column.getByRole('alert')).toHaveCount(0);
  console.log('Cold startup: microphone buffers before model ready; stop preserves PCM; final flush PASS');
  await voice.click();
  await expect(input).toHaveClass(/is-voice-provisional/);
  await expect(column.getByRole('status')).toHaveCount(0);
  const previousAborts = await app.evaluate(() => global.voiceFixture.aborts);
  // Closing the panel disposes capture and ignores results from that draft.
  await page.getByRole('button',{name:'Hide agent panel'}).click();
  await expect(page.locator(".explorer-agent-dock")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => app.evaluate(() => global.voiceFixture.aborts)).toBe(previousAborts + 1);
  const framesAfterClose = pcmFrames;
  await app.evaluate(() => global.voiceFixture.release());
  await page.waitForTimeout(200);
  expect(pcmFrames).toBe(framesAfterClose);
  expect(pageErrors).toEqual([]);
  console.log('WhisperLiveKit: live PCM, streaming draft, terminal flush, error, no auto-send, themes, cancellation PASS');
  }

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
