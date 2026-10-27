const path = require('node:path');
const { createRuntime } = require('./runtime.cjs');
module.exports = function registerDictation({ app, ipcMain, getMainWindow }) {
  // Warm the model after the IDE renders; never block opening files or terminals.
  let runtime;
  let active = null;
  let prewarmed = false;
  const { session, systemPreferences } = require('electron');
  app.whenReady().then(() => {
    session.defaultSession.setPermissionCheckHandler((contents, permission) =>
      permission === 'media' && contents === getMainWindow()?.webContents);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(permission === 'media' && contents === getMainWindow()?.webContents
        && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === 'audio'));
    });
  });
  const getRuntime = () => runtime ??= createRuntime(process.env.COLORIDE_VOICE_HOME || path.join(app.getPath('userData'), 'voice-runtime'), {
    bundleRoot: app.isPackaged ? path.join(process.resourcesPath, 'voice-runtime') : path.join(__dirname, '../../resources/voice-runtime'),
    packaged: app.isPackaged,
  });
  const valid = event => event.sender === getMainWindow()?.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('coloride:dictation:start', async (event, { id } = {}) => {
    if (!valid(event)) throw new Error('Invalid dictation caller.');
    if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid dictation session.');
    active = id;
    if (process.platform === 'darwin' && !await systemPreferences.askForMediaAccess('microphone')) {
      throw new Error('Allow Microphone access for Coloride in macOS Privacy & Security settings.');
    }
    if (active !== id) return { cancelled: true };
    const endpoint = await getRuntime().ensure(message => {
      if (active === id && !event.sender.isDestroyed()) event.sender.send('coloride:dictation:event', { id, type: 'progress', message });
    });
    if (active !== id) return { cancelled: true };
    return endpoint;
  });
  ipcMain.handle('coloride:dictation:stop', (event, id) => {
    if (valid(event) && active === id) active = null;
  });
  app.on('before-quit', () => { active = null; runtime?.stop(); });
  return {
    prewarm() {
      // The medium voice model is large. Open-source builds load it on first mic use.
      if (prewarmed || process.env.COLORIDE_VOICE_PREWARM !== '1') return;
      prewarmed = true;
      void getRuntime().ensure(() => {}).catch(() => {
        // Report startup failures through the mic action, not a background alert.
      });
    },
  };
};
