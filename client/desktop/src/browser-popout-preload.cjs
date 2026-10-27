const { contextBridge, ipcRenderer } = require("electron");

const tabId = process.argv.find((arg) => arg.startsWith("--coloride-popout-tab="))?.slice("--coloride-popout-tab=".length) || "";

contextBridge.exposeInMainWorld("coloridePopout", {
  tabId,
  platform: process.platform,
  goBack: () => ipcRenderer.invoke("coloride:browserPopout:goBack"),
  goForward: () => ipcRenderer.invoke("coloride:browserPopout:goForward"),
  reload: () => ipcRenderer.invoke("coloride:browserPopout:reload"),
  navigate: (url) => ipcRenderer.invoke("coloride:browserPopout:navigate", { url }),
  dock: () => ipcRenderer.invoke("coloride:browserPopout:dock"),
  getState: () => ipcRenderer.invoke("coloride:browserPopout:getState"),
  newTab: () => ipcRenderer.invoke("coloride:browserPopout:newTab"),
  selectTab: (nextTabId) => ipcRenderer.invoke("coloride:browserPopout:selectTab", { tabId: nextTabId }),
  closeTab: (nextTabId) => ipcRenderer.invoke("coloride:browserPopout:closeTab", { tabId: nextTabId }),
  windowControls: {
    minimize: () => ipcRenderer.invoke("coloride:window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("coloride:window:toggleMaximize"),
    isMaximized: () => ipcRenderer.invoke("coloride:window:isMaximized"),
    close: () => ipcRenderer.invoke("coloride:window:close"),
    onMaximizedChange: (callback) => {
      const listener = (_event, maximized) => callback(Boolean(maximized));
      ipcRenderer.on("coloride:window:maximized", listener);
      return () => ipcRenderer.removeListener("coloride:window:maximized", listener);
    },
  },
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("coloride:browserPopout:state", listener);
    return () => ipcRenderer.removeListener("coloride:browserPopout:state", listener);
  },
});
