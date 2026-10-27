const { contextBridge, ipcRenderer } = require("electron");
const testConfig = JSON.parse(process.env.COLORIDE_TEST_CONFIG || "{}");
contextBridge.exposeInMainWorld("colorideDesktop", {
  cloudConfig: testConfig.cloudConfig,
  getRuntime: () => ipcRenderer.invoke("test:runtime"),
  readClipboardText: () => ipcRenderer.invoke("test:clipboard-read"),
  writeClipboardCodeRef: ({ text }) => ipcRenderer.invoke("test:clipboard-write", text).then(() => true),
  writeClipboardText: (text) => ipcRenderer.invoke("test:clipboard-write", text),
});
