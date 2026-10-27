const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(permission = true, env = {}) {
  const handlers = new Map();
  let permissions = 0;
  let runtimeLoads = 0;
  let releaseSplash;
  const splashFinished = new Promise(resolve => { releaseSplash = resolve; });
  let release;
  let entered;
  const ready = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const frame = {};
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send() {} });
  const electron = {
    systemPreferences: { askForMediaAccess: async () => {permissions++; return permission;} },
    session: { defaultSession: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} } },
  };
  const module = { exports: {} };
  const file = path.resolve(__dirname, '../../../client/desktop/src/dictation/ipc.cjs');
  vm.runInNewContext(readFileSync(file, 'utf8'), {
    module, __dirname: path.dirname(file), process: { platform: 'darwin', env },
    require(name) {
      if (name === 'electron') return electron;
      if (name === './runtime.cjs') return { createRuntime: () => ({ ensure: () => { runtimeLoads++; entered(); return ready; }, stop() {} }) };
      return require(name);
    },
  });
  const window = { webContents: contents, isDestroyed: () => false };
  const app = Object.assign(new EventEmitter(), {
    whenReady: () => Promise.resolve(), getPath: () => '/tmp/voice-ipc-fixture',
  });
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const dictation = module.exports({
    app,
    ipcMain,
    getMainWindow: () => window,
  });
  // Execute the real main-process wiring: model startup follows completion of
  // the native fade, rather than any did-finish-load (including about:blank).
  const main = readFileSync(path.resolve(__dirname, '../../../client/desktop/src/main.cjs'), 'utf8');
  const start = main.indexOf('ipcMain.handle("coloride:finishStartup",');
  const end = main.indexOf('\nipcMain.handle(', start + 1);
  assert(start >= 0 && end > start);
  vm.runInNewContext(main.slice(start, end), {
    ipcMain, mainWindow: window, dictation, finishStartupSplash: () => splashFinished,
  });
  const event = { sender: contents, senderFrame: frame };
  return {
    load: () => { app.emit('browser-window-created', {}, window); contents.emit('did-finish-load'); },
    finishStartup: (caller = event) => handlers.get('coloride:finishStartup')(caller), releaseSplash,
    runtimeLoads: () => runtimeLoads,
    permissions: () => permissions,
    start: id => handlers.get('coloride:dictation:start')(event, { id }),
    stop: id => handlers.get('coloride:dictation:stop')(event, id), started, release,
  };
}

test('intentional cancellation while loading resolves without an IPC error', async () => {
  const voice = fixture();
  const pending = voice.start('old');
  await voice.started;
  voice.stop('old');
  voice.release({ url: 'ws://127.0.0.1:1234/asr' });
  assert.equal((await pending).cancelled, true);
});

test('a cancelled startup cannot displace the next recording', async () => {
  const voice = fixture();
  const old = voice.start('old');
  await voice.started;
  voice.stop('old');
  const next = voice.start('new');
  voice.release({ url: 'ws://127.0.0.1:1234/asr' });
  assert.equal((await old).cancelled, true);
  assert.equal((await next).url, 'ws://127.0.0.1:1234/asr');
});

test('permission denial remains a visible failure', async () => {
  await assert.rejects(fixture(false).start('denied'), /Allow Microphone access/);
});

test('prewarming waits for the real startup fade without opening the microphone', async () => {
  const voice = fixture(true, { COLORIDE_VOICE_PREWARM: '1' });
  voice.load(); // The initial about:blank document.
  voice.load(); // Loading the real HTML still precedes React and its splash fade.
  assert.equal(voice.runtimeLoads(), 0);
  const finishing = voice.finishStartup();
  await Promise.resolve();
  assert.equal(voice.runtimeLoads(), 0, 'The IDE must be visible before model loading starts.');
  voice.releaseSplash(true);
  assert.equal(await finishing, true);
  await voice.started;
  assert.equal(voice.runtimeLoads(), 1);
  assert.equal(voice.permissions(), 0);
  await voice.finishStartup();
  assert.equal(voice.runtimeLoads(), 1, 'Repeated startup completion must not reload the model.');
  voice.release({url:'ws://127.0.0.1:1234/asr'});
  assert.equal((await voice.start('ready')).url, 'ws://127.0.0.1:1234/asr');
  assert.equal(voice.permissions(), 1);
});

test('disabled automatic prewarm still allows explicit microphone use', async () => {
  const voice = fixture(true, { COLORIDE_VOICE_PREWARM: '0' });
  voice.load();
  voice.releaseSplash(true);
  await voice.finishStartup();
  assert.equal(voice.runtimeLoads(), 0);
  const recording = voice.start('explicit');
  await voice.started;
  voice.release({ url: 'ws://127.0.0.1:1234/asr' });
  assert.equal((await recording).url, 'ws://127.0.0.1:1234/asr');
});

test('another frame cannot trigger model prewarming through startup completion', async () => {
  const voice = fixture(true, { COLORIDE_VOICE_PREWARM: '1' });
  assert.equal(await voice.finishStartup({ sender: {}, senderFrame: {} }), false);
  assert.equal(voice.runtimeLoads(), 0);
});
