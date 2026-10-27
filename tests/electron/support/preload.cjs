const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("colorideDesktop", {
  getRuntime: () => ipcRenderer.invoke("test:runtime"),
  readClipboardText: () => ipcRenderer.invoke("test:clipboard-read"),
  writeClipboardCodeRef: ({ text }) => ipcRenderer.invoke("test:clipboard-write", text).then(() => true),
  writeClipboardText: (text) => ipcRenderer.invoke("test:clipboard-write", text),
});
