const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("node:path");
if (!process.env.COLORIDE_TEST_USER_DATA || !process.env.COLORIDE_TEST_URL) throw new Error("Isolated test environment required");
app.setPath("userData", process.env.COLORIDE_TEST_USER_DATA);
ipcMain.handle("test:runtime", () => JSON.parse(process.env.COLORIDE_TEST_CONFIG));
ipcMain.handle("test:clipboard-read", () => clipboard.readText());
ipcMain.handle("test:clipboard-write", (_, text) => clipboard.writeText(text));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false } });
  win.webContents.setBackgroundThrottling(false);
  await win.loadURL(process.env.COLORIDE_TEST_URL);
  // A hidden window can freeze image animations and CSS transitions on CI.
  // Keep the page painting without taking focus from the developer.
  if (!win.isDestroyed()) win.showInactive();
});
app.on("window-all-closed", () => app.quit());
