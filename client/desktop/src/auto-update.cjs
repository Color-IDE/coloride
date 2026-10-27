/**
 * In-app auto-update via electron-updater (generic feed on VPS).
 *
 * Seamless flow (Antigravity / Cursor style):
 *  1. check on startup → if available, download immediately (no UI wait)
 *  2. download in background (no progress modal required)
 *  3. on downloaded → quitAndInstall automatically (app restarts on new version)
 *
 * Open-source builds have no update feed. Set COLORIDE_UPDATE_FEED_URL for an official release.
 */

/** Empty unless the official build injects its own feed. */
const UPDATE_FEED_URL = process.env.COLORIDE_UPDATE_FEED_URL || "";

const { app, shell } = require("electron");
const { getColorideVersion } = require("./app-version.cjs");

/** @typedef {"idle"|"checking"|"available"|"not-available"|"downloading"|"downloaded"|"installing"|"error"} UpdateStatus */

/**
 * @typedef {object} UpdateSnapshot
 * @property {UpdateStatus} status
 * @property {"stable"|"beta"} channel
 * @property {string} currentVersion
 * @property {string|null} latestVersion
 * @property {string|null} notes
 * @property {string|null} publishedAt
 * @property {string|null} downloadUrl
 * @property {boolean} available
 * @property {number} progress
 * @property {string|null} error
 * @property {boolean} canInstall
 * @property {boolean} autoUpdateEnabled
 * @property {string|null} checkedAt
 * @property {boolean} autoInstalling
 */

/** @type {import('electron').BrowserWindow | null} */
let mainWindowRef = null;
/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let listenersBound = false;
let autoInstallStarted = false;

/** @type {UpdateSnapshot} */
let snapshot = {
  status: "idle",
  channel: "stable",
  currentVersion: getColorideVersion(),
  latestVersion: null,
  notes: null,
  publishedAt: null,
  downloadUrl: null,
  available: false,
  progress: 0,
  error: null,
  canInstall: false,
  autoUpdateEnabled: false,
  checkedAt: null,
  autoInstalling: false,
};

function broadcast() {
  if (!mainWindowRef || mainWindowRef.isDestroyed() || mainWindowRef.webContents.isDestroyed()) {
    return;
  }
  mainWindowRef.webContents.send("coloride:updateEvent", { ...snapshot });
}

/**
 * @param {Partial<UpdateSnapshot>} patch
 */
function patchSnapshot(patch) {
  snapshot = { ...snapshot, ...patch, currentVersion: getColorideVersion() };
  broadcast();
}

function getSnapshot() {
  return { ...snapshot, currentVersion: getColorideVersion() };
}

/**
 * @param {import('electron').BrowserWindow | null} win
 */
function setMainWindow(win) {
  mainWindowRef = win;
}

function isAutoUpdateSupported() {
  if (!UPDATE_FEED_URL) return false;
  if (process.env.COLORIDE_OFFICIAL_UPDATE !== "1") return false;
  return Boolean(app.isPackaged);
}

function publicDownloadUrlForVersion(version) {
  if (!version) return UPDATE_FEED_URL;
  if (process.platform === "darwin") {
    return `${UPDATE_FEED_URL}Coloride-${version}-arm64.dmg`;
  }
  if (process.platform === "win32") {
    return `${UPDATE_FEED_URL}Coloride-${version}-win-x64-setup.exe`;
  }
  return UPDATE_FEED_URL;
}

/**
 * Lazy-load electron-updater.
 * @returns {import('electron-updater').AppUpdater | null}
 */
function getUpdater() {
  if (updater) return updater;
  try {
    // eslint-disable-next-line global-require
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch (error) {
    console.warn("[updates] electron-updater not available:", error && error.message);
    return null;
  }
  if (!updater) return null;

  // Seamless: download as soon as available; install on quit (and we also force-install).
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // Faster / more reliable full package (skip flaky differential on Mac).
  try {
    updater.disableDifferentialDownload = true;
  } catch {
    // older electron-updater
  }

  // Windows: allow unsigned / differently signed builds (CI may ship without Authenticode).
  if (process.platform === "win32") {
    try {
      updater.verifyUpdateCodeSignature = async () => null;
    } catch {
      // ignore
    }
  }

  try {
    updater.setFeedURL({
      provider: "generic",
      url: UPDATE_FEED_URL,
    });
  } catch (error) {
    console.warn("[updates] setFeedURL failed:", error && error.message);
  }

  updater.logger = {
    info: (...args) => console.log("[updates]", ...args),
    warn: (...args) => console.warn("[updates]", ...args),
    error: (...args) => console.error("[updates]", ...args),
    debug: () => undefined,
  };

  if (!listenersBound) {
    listenersBound = true;
    updater.on("checking-for-update", () => {
      patchSnapshot({
        status: "checking",
        error: null,
        progress: 0,
        autoInstalling: false,
      });
    });
    updater.on("update-available", (info) => {
      const version = info?.version || null;
      patchSnapshot({
        status: "downloading",
        available: true,
        latestVersion: version,
        notes: typeof info?.releaseNotes === "string"
          ? info.releaseNotes
          : Array.isArray(info?.releaseNotes)
            ? info.releaseNotes.map((n) => (typeof n === "string" ? n : n?.note || "")).filter(Boolean).join("\n")
            : null,
        publishedAt: info?.releaseDate || null,
        downloadUrl: publicDownloadUrlForVersion(version),
        error: null,
        canInstall: false,
        progress: Math.max(snapshot.progress, 1),
        checkedAt: new Date().toISOString(),
        autoInstalling: false,
      });
      // autoDownload=true starts download; ensure it if something blocked it.
      void ensureDownload().catch((err) => {
        console.warn("[updates] auto download failed:", err && err.message);
      });
    });
    updater.on("update-not-available", (info) => {
      autoInstallStarted = false;
      patchSnapshot({
        status: "not-available",
        available: false,
        latestVersion: info?.version || getColorideVersion(),
        notes: null,
        downloadUrl: null,
        error: null,
        canInstall: false,
        progress: 0,
        checkedAt: new Date().toISOString(),
        autoInstalling: false,
      });
    });
    updater.on("download-progress", (progress) => {
      const pct = typeof progress?.percent === "number" ? progress.percent : 0;
      patchSnapshot({
        status: "downloading",
        progress: Math.max(0, Math.min(100, pct)),
        error: null,
        available: true,
      });
    });
    updater.on("update-downloaded", (info) => {
      const version = info?.version || snapshot.latestVersion;
      patchSnapshot({
        status: "downloaded",
        available: true,
        latestVersion: version,
        progress: 100,
        canInstall: true,
        error: null,
        downloadUrl: publicDownloadUrlForVersion(version),
        autoInstalling: true,
      });
      // Antigravity-style: install + relaunch immediately (no progress UI required).
      scheduleAutoInstall();
    });
    updater.on("error", (err) => {
      const message = err && err.message ? String(err.message) : String(err || "Update error");
      console.error("[updates] error:", message);
      // Signature failures on Mac (unsigned CI builds) → open DMG as fallback.
      if (/signature|firma|codesign|did not pass validation|recursos/i.test(message)) {
        const url = snapshot.downloadUrl || publicDownloadUrlForVersion(snapshot.latestVersion);
        patchSnapshot({
          status: "error",
          error:
            "Automatic install could not verify this build. Opening the installer download…",
          canInstall: false,
          autoInstalling: false,
          downloadUrl: url,
        });
        if (url) {
          void shell.openExternal(url).catch(() => undefined);
        }
        return;
      }
      patchSnapshot({
        status: "error",
        error: message,
        canInstall: false,
        autoInstalling: false,
      });
    });
  }

  return updater;
}

async function ensureDownload() {
  const u = getUpdater();
  if (!u) return;
  try {
    await u.downloadUpdate();
  } catch (error) {
    // autoDownload may already be running — ignore duplicate calls.
    const msg = error && error.message ? String(error.message) : String(error);
    if (!/already|progress|download/i.test(msg)) {
      throw error;
    }
  }
}

function scheduleAutoInstall() {
  if (autoInstallStarted) return;
  autoInstallStarted = true;
  // Brief beat so the renderer can show a tiny “Restarting…” state if mounted.
  setTimeout(() => {
    try {
      quitAndInstall();
    } catch (error) {
      autoInstallStarted = false;
      const message = error && error.message ? String(error.message) : String(error);
      patchSnapshot({
        status: "error",
        error: message,
        autoInstalling: false,
        canInstall: true,
      });
    }
  }, 600);
}

/**
 * @param {"stable"|"beta"} channel
 */
function applyChannel(channel) {
  const next = channel === "beta" ? "beta" : "stable";
  snapshot.channel = next;
  const u = getUpdater();
  if (!u) return;
  u.allowPrerelease = next === "beta";
  u.channel = next === "beta" ? "beta" : "latest";
}

/**
 * @param {"stable"|"beta"} [channel]
 */
async function checkForUpdates(channel = "stable") {
  applyChannel(channel);
  autoInstallStarted = false;
  patchSnapshot({
    autoUpdateEnabled: isAutoUpdateSupported(),
    channel: snapshot.channel,
  });

  if (!isAutoUpdateSupported()) {
    patchSnapshot({
      status: "not-available",
      available: false,
      latestVersion: getColorideVersion(),
      error: null,
      checkedAt: new Date().toISOString(),
      autoUpdateEnabled: false,
      autoInstalling: false,
    });
    return getSnapshot();
  }

  const u = getUpdater();
  if (!u) {
    patchSnapshot({
      status: "error",
      error: "Auto-update is not available in this build.",
      autoUpdateEnabled: false,
    });
    return getSnapshot();
  }

  try {
    patchSnapshot({ status: "checking", error: null, autoInstalling: false });
    const result = await u.checkForUpdates();
    if (snapshot.status === "checking") {
      patchSnapshot({
        status: "not-available",
        available: false,
        latestVersion: result?.updateInfo?.version || getColorideVersion(),
        checkedAt: new Date().toISOString(),
      });
    }
    return getSnapshot();
  } catch (error) {
    let message = error && error.message ? String(error.message) : String(error);
    if (
      /latest-mac\.yml|404|Cannot find/i.test(message)
      || /Coloride-Releases/i.test(message)
    ) {
      message =
        "No update package on the release channel yet. " +
        "No update package is published for this build.";
      patchSnapshot({
        status: "not-available",
        available: false,
        latestVersion: getColorideVersion(),
        error: message,
        checkedAt: new Date().toISOString(),
      });
      return getSnapshot();
    }
    patchSnapshot({
      status: "error",
      error: message,
      checkedAt: new Date().toISOString(),
    });
    return getSnapshot();
  }
}

async function downloadUpdate() {
  if (!isAutoUpdateSupported()) {
    throw new Error("Auto-update only works in the installed (packaged) app.");
  }
  const u = getUpdater();
  if (!u) throw new Error("Auto-update is not available in this build.");
  if (
    snapshot.status !== "available"
    && snapshot.status !== "error"
    && snapshot.status !== "downloading"
    && snapshot.status !== "downloaded"
  ) {
    await checkForUpdates(snapshot.channel);
  }
  if (snapshot.status === "downloaded" && snapshot.canInstall) {
    scheduleAutoInstall();
    return getSnapshot();
  }
  patchSnapshot({
    status: "downloading",
    progress: Math.max(snapshot.progress, 1),
    error: null,
  });
  await u.downloadUpdate();
  return getSnapshot();
}

function quitAndInstall() {
  if (!isAutoUpdateSupported()) {
    throw new Error("Auto-update only works in the installed (packaged) app.");
  }
  const u = getUpdater();
  if (!u) throw new Error("Auto-update is not available in this build.");
  patchSnapshot({ status: "installing", autoInstalling: true, canInstall: true, progress: 100 });
  // Windows: silent install + relaunch. Mac: force run after install.
  // isSilent=true → NSIS /S (no wizard). isForceRunAfter=true → reopen app.
  const silent = process.platform === "win32";
  setImmediate(() => {
    try {
      u.quitAndInstall(silent, true);
    } catch (error) {
      console.error("[updates] quitAndInstall failed:", error);
      // Last resort: open public installer URL.
      const url = snapshot.downloadUrl || publicDownloadUrlForVersion(snapshot.latestVersion);
      if (url) void shell.openExternal(url).catch(() => undefined);
    }
  });
  return true;
}

/**
 * Quiet startup check — packaged only. Downloads + installs without user steps.
 * @param {"stable"|"beta"} channel
 */
function scheduleStartupCheck(channel = "stable") {
  if (!isAutoUpdateSupported()) return;
  setTimeout(() => {
    void checkForUpdates(channel).catch(() => undefined);
  }, 2_500);
}

module.exports = {
  setMainWindow,
  getSnapshot,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  scheduleStartupCheck,
  isAutoUpdateSupported,
  applyChannel,
};
