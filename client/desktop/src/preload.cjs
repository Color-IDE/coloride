const { contextBridge, ipcRenderer } = require("electron");

let settingsSection;
ipcRenderer.on("coloride:settingsSection", (_event, section) => { settingsSection = section; });

const desktopApi = {
  cloudConfig: ipcRenderer.sendSync("coloride:cloudConfig"),
  startupAppearance: process.argv.find(arg => arg.startsWith("--coloride-startup-theme="))?.split("=")[1],
  nativeStartupSplash: process.argv.includes("--coloride-native-startup-splash")
    && ipcRenderer.sendSync("coloride:hasStartupSplash"),
  openSettings: (section) => ipcRenderer.invoke("coloride:openSettings", section),
  onSettingsSectionChange: (callback) => {
    if (settingsSection) callback(settingsSection);
    const listener = (_event, section) => callback(section);
    ipcRenderer.on("coloride:settingsSection", listener);
    return () => ipcRenderer.removeListener("coloride:settingsSection", listener);
  },
  getRuntime: () => ipcRenderer.invoke("coloride:getRuntime"),
  getAppInfo: () => ipcRenderer.invoke("coloride:getAppInfo"),
  finishStartup: () => ipcRenderer.invoke("coloride:finishStartup"),
  openExternal: (externalUrl) => ipcRenderer.invoke("coloride:openExternal", externalUrl),
  /** After device-login Approve — show + focus the main window (no deep link). */
  focusMainWindow: () => ipcRenderer.invoke("coloride:focusMainWindow"),
  /** Frameless Windows chrome controls. */
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
  checkForUpdates: (channel) => ipcRenderer.invoke("coloride:checkForUpdates", channel),
  getUpdateState: () => ipcRenderer.invoke("coloride:getUpdateState"),
  downloadUpdate: () => ipcRenderer.invoke("coloride:downloadUpdate"),
  quitAndInstallUpdate: () => ipcRenderer.invoke("coloride:quitAndInstallUpdate"),
  openUpdateDownload: (downloadUrl) => ipcRenderer.invoke("coloride:openUpdateDownload", downloadUrl),
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("coloride:updateEvent", listener);
    return () => ipcRenderer.removeListener("coloride:updateEvent", listener);
  },
  openFolder: () => ipcRenderer.invoke("coloride:openFolder"),
  saveFile: (suggestedName) => ipcRenderer.invoke("coloride:saveFile", suggestedName),
  selectFile: () => ipcRenderer.invoke("coloride:selectFile"),
  /**
   * Plain text from the OS clipboard (terminal paste, etc.).
   * Prefer this over navigator.clipboard in Electron — permissions are flaky.
   */
  readClipboardText: async () => {
    try {
      const text = await ipcRenderer.invoke("coloride:clipboard:readText");
      return typeof text === "string" ? text : "";
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error || "");
      if (message.includes("No handler registered") || message.includes("clipboard:readText")) {
        return "";
      }
      console.warn("[coloride] readClipboardText failed", error);
      return "";
    }
  },
  /**
   * OS clipboard image (screenshots / Discord / Figma).
   * Returns null when empty, when real files are on the pasteboard, or if the
   * main process hasn't registered the handler yet.
   */
  readClipboardImage: async () => {
    try {
      return await ipcRenderer.invoke("coloride:clipboard:readImage");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error || "");
      // Stale Electron main without the handler — soft-fail so paste can fall back.
      if (message.includes("No handler registered") || message.includes("clipboard:readImage")) {
        return null;
      }
      console.warn("[coloride] readClipboardImage failed", error);
      return null;
    }
  },
  /**
   * Real OS clipboard files (Finder copy of .ttf / .zip / anything).
   * Prefer this over readClipboardImage — macOS often attaches a PNG thumbnail.
   */
  readClipboardFiles: async () => {
    try {
      const payload = await ipcRenderer.invoke("coloride:clipboard:readFiles");
      return Array.isArray(payload) ? payload : [];
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error || "");
      if (message.includes("No handler registered") || message.includes("clipboard:readFiles")) {
        return [];
      }
      console.warn("[coloride] readClipboardFiles failed", error);
      return [];
    }
  },
  /**
   * Write plain text + application/x-coloride-code-ref (editor/terminal chips).
   */
  writeClipboardCodeRef: async (payload) => {
    try {
      return Boolean(await ipcRenderer.invoke("coloride:clipboard:writeCodeRef", payload));
    } catch (error) {
      console.warn("[coloride] writeClipboardCodeRef failed", error);
      return false;
    }
  },
  /** Read custom code-ref JSON if present on the OS pasteboard. */
  readClipboardCodeRef: async () => {
    try {
      const raw = await ipcRenderer.invoke("coloride:clipboard:readCodeRef");
      return typeof raw === "string" && raw.trim() ? raw : null;
    } catch {
      return null;
    }
  },
  /** Native OS menu — paints above WebContentsView (unlike HTML portals). */
  popupMenu: (payload) => ipcRenderer.invoke("coloride:popupMenu", payload),
  setKeyboardShortcuts: (bindings) => ipcRenderer.send("coloride:setKeyboardShortcuts", bindings),
  localPathAction: (payload) => ipcRenderer.invoke("coloride:localPathAction", payload),
  setMenuRecents: (recents) => ipcRenderer.send("coloride:setMenuRecents", recents),
  /** "glass" = OS blur of desktop (login); "opaque" = solid app chrome. */
  setWindowBackdrop: (mode, options) =>
    ipcRenderer.invoke("coloride:setWindowBackdrop", mode, options),
  /** Re-show macOS traffic lights if a selection/compositing glitch hid them. */
  ensureTrafficLights: () => ipcRenderer.invoke("coloride:ensureTrafficLights"),
  // Product account (api.coloride.com) — refresh token only; access stays in renderer memory.
  cloudAuth: {
    hasSession: () => ipcRenderer.invoke("coloride:cloudAuth:hasSession"),
    requestDeviceCode: () => ipcRenderer.invoke("coloride:cloudAuth:requestDeviceCode"),
    pollDeviceCode: (deviceCode) => ipcRenderer.invoke("coloride:cloudAuth:pollDeviceCode", deviceCode),
    refreshSession: () => ipcRenderer.invoke("coloride:cloudAuth:refreshSession"),
    logout: (remote = true) => ipcRenderer.invoke("coloride:cloudAuth:logout", remote),
  },
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("coloride:menuAction", listener);
    return () => ipcRenderer.removeListener("coloride:menuAction", listener);
  },
  onSidecarExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("sidecar:exit", listener);
    return () => ipcRenderer.removeListener("sidecar:exit", listener);
  },

  // Real Chromium embed (WebContentsView) routed through VPS SSH SOCKS.
  browserEmbed: {
    open: (payload) => ipcRenderer.invoke("coloride:browserEmbed:open", payload),
    navigate: (payload) => ipcRenderer.invoke("coloride:browserEmbed:navigate", payload),
    reload: (payload) => ipcRenderer.invoke("coloride:browserEmbed:reload", payload),
    goBack: (payload) => ipcRenderer.invoke("coloride:browserEmbed:goBack", payload),
    goForward: (payload) => ipcRenderer.invoke("coloride:browserEmbed:goForward", payload),
    setBounds: (payload) => ipcRenderer.invoke("coloride:browserEmbed:setBounds", payload),
    hide: (payload) => ipcRenderer.invoke("coloride:browserEmbed:hide", payload),
    hideAll: () => ipcRenderer.invoke("coloride:browserEmbed:hideAll"),
    close: (payload) => ipcRenderer.invoke("coloride:browserEmbed:close", payload),
    setSocks: (payload) => ipcRenderer.invoke("coloride:browserEmbed:setSocks", payload),
    /** Open embed in a separate OS window (same VPS SOCKS session). */
    popOut: (payload) => ipcRenderer.invoke("coloride:browserEmbed:popOut", payload),
    /** Return a popped-out embed into the main Coloride window. */
    dock: (payload) => ipcRenderer.invoke("coloride:browserEmbed:dock", payload),
    isPoppedOut: (payload) => ipcRenderer.invoke("coloride:browserEmbed:isPoppedOut", payload),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("coloride:browserEmbed:event", listener);
      return () => ipcRenderer.removeListener("coloride:browserEmbed:event", listener);
    }
  }
};
contextBridge.exposeInMainWorld("colorideDesktop", desktopApi);
contextBridge.exposeInMainWorld("recturyDesktop", desktopApi);
