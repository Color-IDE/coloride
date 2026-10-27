const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, session, shell, WebContentsView } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const autoUpdate = require("./auto-update.cjs");
const { getColorideVersion } = require("./app-version.cjs");
const { waitForSidecarHealth } = require("./sidecar-health.cjs");
const Sentry = require("@sentry/electron/main");

// Keep this clock in the main process so the development terminal reports the
// full cold-start cost: Electron boot, sidecar availability and renderer load.
// `hrtime` is monotonic, unlike Date.now(), so an OS clock change cannot make
// a boot duration negative or inaccurate.
const APP_BOOT_STARTED_AT = process.hrtime.bigint();

function elapsedSinceBootMs() {
  return Number(process.hrtime.bigint() - APP_BOOT_STARTED_AT) / 1_000_000;
}

function formatBootDuration(durationMs) {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(2)} s`;
}

// Bump this whenever the persistent sidecar protocol or its boot contract
// changes. It prevents a newly installed desktop app from silently talking to
// an older daemon still alive from a previous launch.
const TERMINAL_HOST_VERSION = 5;

// Development Electron otherwise uses the generic "Electron" user-data
// directory. That leaks localStorage, recents and cloud login across clean
// Coloride runs. Keep dev state isolated just like the packaged app.
app.setName("Coloride");
if (process.env.COLORIDE_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.COLORIDE_TEST_USER_DATA));
} else if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "@coloride", "electron"));
} else {
  app.setPath("userData", path.join(app.getPath("appData"), "Coloride"));
}

// Sentry as early as possible (main process + native crashes).
// DSN from Sentry Electron project; override with COLORIDE_SENTRY_DSN if needed.
const SENTRY_DSN = process.env.COLORIDE_SENTRY_DSN || "";

if (SENTRY_DSN && process.env.COLORIDE_SENTRY_DISABLED !== "1") {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: `coloride@${getColorideVersion()}`,
    environment: app.isPackaged ? "production" : "development",
    // Helpful while wiring up; set COLORIDE_SENTRY_DEBUG=1 to keep logs noisy.
    debug: process.env.COLORIDE_SENTRY_DEBUG === "1" || !app.isPackaged,
    sendDefaultPii: false,
    // Lower in production later if volume is high.
    tracesSampleRate: app.isPackaged ? 0.2 : 1.0,
  });
}

// Prefer "Coloride" over the host binary name ("Electron") in menus / About.
try {
  // Some Electron builds only honor this before ready; keep both paths.
  if (typeof app.setAboutPanelOptions === "function") {
    app.setAboutPanelOptions({
      applicationName: "Coloride",
      iconPath: path.join(__dirname, "../resources/icon.png"),
      applicationVersion: getColorideVersion(),
      version: getColorideVersion(),
      copyright: "Copyright © Coloride",
    });
  }
} catch {
  // ignore
}

// Chromium always bypasses 127.0.0.1/localhost for proxies unless this is set.
// We NEED loopback to go through the VPS SSH SOCKS hop so that
// http://localhost:3003 in the embedded browser is the VPS app, not the Mac.
// "<-loopback>" = do NOT bypass loopback (Chromium special token).
// Must run before app.whenReady() / any session is created.
app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>");

/**
 * Monorepo root (Python sidecar + .env) for development.
 * Packaged builds use the bundled PyInstaller binary under resources/sidecar/.
 */
function getRepoRoot() {
  if (process.env.COLORIDE_REPO_ROOT && fs.existsSync(process.env.COLORIDE_REPO_ROOT)) {
    return process.env.COLORIDE_REPO_ROOT;
  }
  const fromSource = path.resolve(__dirname, "..", "..", "..");
  if (
    !app.isPackaged
    && fs.existsSync(path.join(fromSource, "core", "ide-host", "src", "coloride_desktop"))
  ) {
    return fromSource;
  }
  // Dev convenience: common local checkouts (not required for end users).
  try {
    const home = app.getPath("home");
    const candidates = [
      path.join(home, "Desktop", "Coloride"),
      path.join(home, "Desktop", "Coloride"),
      path.join(home, "Desktop", "Coloride"),
      path.join(home, "Desktop", "Coloride"),
      fromSource,
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "core", "ide-host", "src", "coloride_desktop"))) {
        return candidate;
      }
    }
  } catch {
    // app.getPath before ready — fall through
  }
  return fromSource;
}

/**
 * Packaged PyInstaller sidecar path (extraResources → resources/sidecar/).
 * @returns {string|null}
 */
function packagedSidecarPath() {
  if (!app.isPackaged) return null;
  const base = path.join(process.resourcesPath, "sidecar");
  const name = process.platform === "win32" ? "coloride-sidecar.exe" : "coloride-sidecar";
  const candidate = path.join(base, name);
  if (fs.existsSync(candidate)) return candidate;
  // Legacy / alternate layout
  const flat = path.join(process.resourcesPath, name);
  return fs.existsSync(flat) ? flat : null;
}
const preloadPath = path.join(__dirname, "preload.cjs");
const splashHtmlPath = path.join(__dirname, "splash.html");
const browserPopoutHtmlPath = path.join(__dirname, "browser-popout.html");
const browserPopoutPreloadPath = path.join(__dirname, "browser-popout-preload.cjs");
/** Packaged / dev app icons (from Icon Composer → iconutil). */
const resourcesDir = path.join(__dirname, "..", "resources");
const appIconIcnsPath = path.join(resourcesDir, "icon.icns");
const appIconPngPath = path.join(resourcesDir, "icon.png");
/** Tab strip + toolbar in popped-out browser windows (DIP). */
const BROWSER_POPOUT_TAB_STRIP_HEIGHT = 36;
const BROWSER_POPOUT_TOOLBAR_HEIGHT = 36;
const BROWSER_POPOUT_CHROME_HEIGHT = BROWSER_POPOUT_TAB_STRIP_HEIGHT + BROWSER_POPOUT_TOOLBAR_HEIGHT;

/** Resolve the best native icon path for this platform. */
function resolveAppIconPath() {
  if (process.platform === "darwin" && fs.existsSync(appIconIcnsPath)) {
    return appIconIcnsPath;
  }
  if (fs.existsSync(appIconPngPath)) return appIconPngPath;
  if (fs.existsSync(appIconIcnsPath)) return appIconIcnsPath;
  return null;
}

/**
 * Dock (macOS) + window icon. Call after app.whenReady().
 * @returns {import('electron').NativeImage | null}
 */
function applyAppIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return null;
  let image = null;
  try {
    image = nativeImage.createFromPath(iconPath);
  } catch {
    return null;
  }
  if (!image || image.isEmpty()) return null;
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(image);
    } catch {
      // ignore
    }
  }
  return image;
}

let sidecar = null;
let sidecarConfig = null;
let mainWindow = null;
let keyboardShortcuts = {
  "files.new-file": "mod+n",
  "files.new-folder": "mod+shift+n",
  "files.open-browser": "mod+o",
  "files.save": "mod+s",
  "terminal.new": "ctrl+shift+`",
  "terminal.toggle": "mod+j",
  "terminal.clear": "mod+k",
  "terminal.close": "mod+shift+w",
  "layout.toggle-sidebar": "mod+b",
  "navigation.explorer": "mod+shift+e",
  "navigation.server": "mod+shift+h",
  "navigation.settings": "mod+,",
  "agents.new-task": "mod+t",
};

/**
 * @typedef {{
 *   view: import('electron').WebContentsView,
 *   socksPort: number | null,
 *   visible: boolean,
 *   wantVisible: boolean,
 *   lastUrl: string,
 *   hostWin: import('electron').BrowserWindow | null,
 * }} BrowserEmbedEntry
 */
/** @type {Map<string, BrowserEmbedEntry>} */
const browserEmbeds = new Map();
/** Pop-out windows keyed by tabId (separate OS window, same SOCKS session). */
/** @type {Map<string, import('electron').BrowserWindow>} */
const browserPopouts = new Map();
const BROWSER_PARTITION = "persist:coloride-vps-browser";
function toElectronAccelerator(binding) {
  if (!binding || typeof binding !== "string") return undefined;
  const labels = {
    alt: "Alt",
    backspace: "Backspace",
    ctrl: "Control",
    delete: "Delete",
    down: "Down",
    enter: "Enter",
    escape: "Escape",
    left: "Left",
    mod: "CommandOrControl",
    right: "Right",
    shift: "Shift",
    space: "Space",
    tab: "Tab",
    up: "Up",
    "`": "`",
  };
  return binding
    .split("+")
    .map((part) => {
      if (part === "`") return "`";
      return labels[part] || (part.length === 1 ? part.toUpperCase() : part);
    })
    .join("+");
}

function isDev() {
  return process.env.COLORIDE_DEV === "1" || Boolean(process.env.COLORIDE_WEB_DEV_URL);
}

/** DevTools only while developing — packaged / user builds stay locked down. */
function allowDevTools() {
  return isDev();
}

/**
 * Block Inspect Element / DevTools shortcuts and auto-close if anything opens them.
 * @param {import('electron').WebContents} contents
 */
/**
 * Keep the desktop UI at 100% zoom — no Cmd+/-/0, no pinch, no menu zoom.
 * Embedded browser views are left alone so sites can still zoom if needed.
 */
function lockPageZoom(contents) {
  if (!contents || contents.isDestroyed()) return;

  const forceDefault = () => {
    try {
      contents.setZoomFactor(1);
    } catch {
      // ignore
    }
    try {
      contents.setZoomLevel(0);
    } catch {
      // ignore
    }
  };

  forceDefault();
  try {
    void contents.setVisualZoomLevelLimits(1, 1);
  } catch {
    // ignore
  }

  contents.on("before-input-event", (event, input) => {
    if (!input) return;
    const mod = process.platform === "darwin" ? Boolean(input.meta && !input.control && !input.alt) : Boolean(input.control && !input.alt);
    if (!mod) return;
    const key = String(input.key || "");
    const code = String(input.code || "").toLowerCase();
    // Cmd/Ctrl + / - / = / + / 0  (and numpad)
    const isZoom =
      key === "+"
      || key === "="
      || key === "-"
      || key === "_"
      || key === "0"
      || code === "equal"
      || code === "minus"
      || code === "numpadadd"
      || code === "numpadsubtract"
      || code === "numpad0"
      || code === "digit0";
    if (isZoom) {
      event.preventDefault();
      forceDefault();
      // Native View commands zoom editor text while the window stays at 100%.
      if (process.platform === "darwin" && input.type === "keyDown" && contents === mainWindow?.webContents) {
        sendMenuAction(key === "0" || code === "digit0" || code === "numpad0" ? "editor-zoom-reset" : key === "-" || key === "_" || code === "minus" || code === "numpadsubtract" ? "editor-zoom-out" : "editor-zoom-in");
      }
    }
  });

  // Belt-and-suspenders if something still bumps zoom.
  contents.on("zoom-changed", () => {
    forceDefault();
  });
  contents.on("did-finish-load", () => {
    forceDefault();
  });
}

function lockDownDevTools(contents) {
  if (!contents || contents.isDestroyed() || allowDevTools()) return;

  const blockShortcut = (event, input) => {
    if (!input) return;
    const key = String(input.key || "").toLowerCase();
    const code = String(input.code || "").toLowerCase();
    const mod = Boolean(input.control || input.meta);
    const shift = Boolean(input.shift);
    const alt = Boolean(input.alt);
    // F12, Ctrl/Cmd+Shift+I/J/C, Alt+Cmd+I (macOS default)
    const isDevTools =
      key === "f12"
      || code === "f12"
      || (mod && shift && (key === "i" || key === "j" || key === "c"))
      || (mod && alt && key === "i");
    if (isDevTools) event.preventDefault();
  };

  contents.on("before-input-event", blockShortcut);
  contents.on("devtools-opened", () => {
    try {
      contents.closeDevTools();
    } catch {
      // ignore
    }
  });
}

// Apply to every WebContents (main window, embeds, popouts) before any window opens.
app.on("web-contents-created", (_event, contents) => {
  try {
    lockDownDevTools(contents);
  } catch {
    // ignore
  }
});

const updateManifestUrls = {
  stable: process.env.COLORIDE_UPDATE_MANIFEST_URL || "",
  beta: process.env.COLORIDE_UPDATE_MANIFEST_BETA_URL || "",
};

function parseVersion(value) {
  const normalized = String(value || "0.0.0").trim().replace(/^v/i, "");
  const [core, prerelease = ""] = normalized.split("-", 2);
  return {
    core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prerelease ? prerelease.split(".") : []
  };
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  const coreLength = Math.max(left.core.length, right.core.length, 3);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (left.core[index] || 0) - (right.core[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function validateHttpsUrl(value, label) {
  const parsed = new URL(value);
  const localDevelopmentUrl = isDev() && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopmentUrl) {
    throw new Error(`${label} must use HTTPS.`);
  }
  return parsed.toString();
}

/**
 * Prefer electron-updater (GitHub Releases) when packaged.
 * Fallback: optional JSON manifest (COLORIDE_UPDATE_MANIFEST_URL / coloride.com) for legacy.
 */
async function checkForUpdates(channel) {
  const nextChannel = channel === "beta" ? "beta" : "stable";

  // Packaged installs → real auto-update (download + restart).
  if (autoUpdate.isAutoUpdateSupported()) {
    const snap = await autoUpdate.checkForUpdates(nextChannel);
    return snapshotToLegacyResult(snap);
  }

  // Dev / unpackaged: optional HTTPS manifest for “is there a newer version?” only.
  const currentVersion = getColorideVersion();
  const emptyResult = {
    available: false,
    channel: nextChannel,
    currentVersion,
    latestVersion: currentVersion,
    publishedAt: undefined,
    notes: undefined,
    downloadUrl: undefined,
    hasChecksum: false,
    hasSignature: false,
    status: "not-available",
    progress: 0,
    canInstall: false,
    autoUpdateEnabled: false,
    error: null,
    checkedAt: new Date().toISOString(),
  };

  if (isDev() && !process.env.COLORIDE_UPDATE_MANIFEST_URL) {
    return emptyResult;
  }

  const manifestUrl = validateHttpsUrl(
    process.env.COLORIDE_UPDATE_MANIFEST_URL || updateManifestUrls[nextChannel],
    "Update manifest URL"
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(manifestUrl, {
      headers: {
        accept: "application/json",
        "user-agent": `Coloride/${getColorideVersion()}`
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (response.status === 404 || response.status === 204) {
      return emptyResult;
    }
    if (!response.ok) {
      console.warn(`[updates] check failed HTTP ${response.status} for ${manifestUrl}`);
      return emptyResult;
    }

    const manifest = await response.json();
    if (!manifest || typeof manifest.version !== "string") {
      console.warn("[updates] manifest missing version field");
      return emptyResult;
    }

    const downloadUrl = manifest.downloadUrl
      ? validateHttpsUrl(manifest.downloadUrl, "Update download URL")
      : undefined;
    const available = compareVersions(manifest.version, currentVersion) > 0;

    return {
      available,
      channel: nextChannel,
      currentVersion,
      latestVersion: manifest.version,
      publishedAt: typeof manifest.publishedAt === "string" ? manifest.publishedAt : undefined,
      notes: typeof manifest.notes === "string" ? manifest.notes : undefined,
      downloadUrl: available ? downloadUrl : undefined,
      hasChecksum: typeof manifest.sha256 === "string" && manifest.sha256.length > 0,
      hasSignature: typeof manifest.signature === "string" && manifest.signature.length > 0,
      status: available ? "available" : "not-available",
      progress: 0,
      canInstall: false,
      autoUpdateEnabled: false,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      console.warn("[updates] check timed out");
      return emptyResult;
    }
    console.warn("[updates] check failed:", error && error.message ? error.message : error);
    return emptyResult;
  } finally {
    clearTimeout(timeout);
  }
}

/** Map auto-update snapshot → renderer UpdateCheckResult shape. */
function snapshotToLegacyResult(snap) {
  return {
    available: Boolean(snap.available),
    channel: snap.channel === "beta" ? "beta" : "stable",
    currentVersion: snap.currentVersion || getColorideVersion(),
    latestVersion: snap.latestVersion || snap.currentVersion || getColorideVersion(),
    publishedAt: snap.publishedAt || undefined,
    notes: snap.notes || undefined,
    downloadUrl: snap.downloadUrl || undefined,
    hasChecksum: false,
    hasSignature: true,
    status: snap.status || "idle",
    progress: typeof snap.progress === "number" ? snap.progress : 0,
    autoInstalling: Boolean(snap.autoInstalling),
    canInstall: Boolean(snap.canInstall),
    autoUpdateEnabled: Boolean(snap.autoUpdateEnabled),
    error: snap.error || null,
    checkedAt: snap.checkedAt || null,
  };
}

/**
 * Resolve how to launch the sidecar.
 * @returns {{ command: string, argsPrefix: string[], mode: "bundled"|"python" }}
 */
function resolvePythonCommand(command) {
  if (!command) return null;
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : null;
  }
  const located = spawnSync(command, ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const executable = located.status === 0 ? String(located.stdout || "").trim() : "";
  return executable && fs.existsSync(executable) ? executable : null;
}

function resolveSidecarLaunch() {
  if (process.env.COLORIDE_SIDECAR && fs.existsSync(process.env.COLORIDE_SIDECAR)) {
    return { command: process.env.COLORIDE_SIDECAR, argsPrefix: [], mode: "bundled" };
  }

  const bundled = packagedSidecarPath();
  if (bundled) {
    console.log("[sidecar] using packaged binary:", bundled);
    return { command: bundled, argsPrefix: [], mode: "bundled" };
  }

  if (process.env.COLORIDE_PYTHON) {
    const forced = resolvePythonCommand(process.env.COLORIDE_PYTHON);
    if (!forced) {
      console.warn("[sidecar] COLORIDE_PYTHON not found:", process.env.COLORIDE_PYTHON);
    } else {
      return { command: forced, argsPrefix: ["-m", "coloride_desktop.sidecar"], mode: "python" };
    }
  }

  const root = getRepoRoot();
  const venvCandidates = [
    path.join(root, "core", "ide-host", ".venv", "Scripts", "python.exe"),
    path.join(root, "core", "ide-host", ".venv", "bin", "python"),
    path.join(root, "core", "ide-host", ".venv", "bin", "python3"),
  ];
  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      console.log("[sidecar] using venv python:", candidate);
      return { command: candidate, argsPrefix: ["-m", "coloride_desktop.sidecar"], mode: "python" };
    }
  }

  if (app.isPackaged) {
    throw new Error(
      "Packaged Coloride is missing the embedded backend (resources/sidecar/coloride-sidecar). " +
        "Rebuild the desktop app so the embedded backend is included.",
    );
  }

  const fallback = process.platform === "win32" ? "python" : "python3";
  console.warn(
    "[sidecar] no core/ide-host/.venv under",
    root,
    "— PATH fallback:",
    fallback,
    "\n         Dev setup: tooling/dev/setup-backend-windows.ps1 (Windows) or core/ide-host .venv",
  );
  return { command: fallback, argsPrefix: ["-m", "coloride_desktop.sidecar"], mode: "python" };
}

/** Load KEY=VALUE pairs from repo-root .env (gitignored) into process.env if missing. */
function loadRepoDotEnv() {
  const envPath = path.join(getRepoRoot(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.error("[env] failed to read .env:", error);
  }
}

// Resolve once for the renderer, authentication and child host alike.
loadRepoDotEnv();
const cloudConfig = require("./cloud-config.cjs").resolveCloudConfig();
ipcMain.on("coloride:cloudConfig", (event) => { event.returnValue = cloudConfig; });

function clineRuntimeBundlePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agent-runtime", "cline-runtime.mjs");
  }
  return path.join(getRepoRoot(), "client", "desktop", "resources", "agent-runtime", "cline-runtime.mjs");
}

/** Dev checkouts gitignore the bundle. Build it so Windows (and Mac) can start the agent. */
function ensureClineRuntime() {
  const built = clineRuntimeBundlePath();
  if (fs.existsSync(built) || app.isPackaged) {
    return built;
  }
  const electronRoot = path.join(getRepoRoot(), "client", "desktop");
  const buildScript = path.join(electronRoot, "src", "agent-runtime", "build.mjs");
  if (!fs.existsSync(buildScript)) {
    return built;
  }
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: electronRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(
      "[agent-runtime] failed to build cline-runtime.mjs:",
      result.stderr || result.stdout || (result.error && result.error.message),
    );
  }
  return built;
}

function sidecarEnv(mode) {
  loadRepoDotEnv();
  const env = { ...process.env };
  env.COLORIDE_CLOUD_ENABLED = cloudConfig.enabled ? "1" : "0";
  env.COLORIDE_CLOUD_AUTH_BASE = cloudConfig.apiBase;
  // Use Electron's embedded Node runtime; packaged users need no Node install.
  env.COLORIDE_AGENT_NODE = process.execPath;
  // Always the esbuild bundle. The source host imports TypeScript, which
  // Electron's embedded Node cannot load. beforePack rebuilds this file.
  env.COLORIDE_CLINE_RUNTIME = ensureClineRuntime();
  env.COLORIDE_TERMINAL_STATE_DIR = path.join(app.getPath("userData"), "terminal-host", "sessions");
  // Only needed when launching via python -m from the monorepo.
  if (mode === "python") {
    const root = getRepoRoot();
    env.PYTHONPATH = path.join(root, "core", "ide-host", "src");
    if (isDev()) {
      // Enables the local, redacted agent diagnostics written to Electron's
      // launch console. This never applies to packaged builds.
      env.COLORIDE_DEV = "1";
      env.COLORIDE_DEV_SIDECAR_STAMP = developmentSidecarStamp();
    }
  }
  return env;
}

/**
 * The terminal host intentionally survives Electron in production. In dev,
 * however, reusing that process after editing Python makes it run stale code.
 * A cheap tree stamp lets us retain persistence between normal reloads while
 * replacing the host when backend source changed.
 */
function developmentSidecarStamp() {
  if (!isDev()) return "";
  const root = path.join(getRepoRoot(), "core", "ide-host", "src", "coloride_desktop");
  const stack = [root];
  let latest = 0;
  let count = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__pycache__") stack.push(item);
      } else if (entry.isFile() && entry.name.endsWith(".py")) {
        try {
          latest = Math.max(latest, fs.statSync(item).mtimeMs);
          count += 1;
        } catch {
          // A save racing Electron boot merely means the next launch refreshes.
        }
      }
    }
  }
  return `${Math.floor(latest)}:${count}`;
}

function frontendDistPath() {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, "frontend-dist");
    if (fs.existsSync(path.join(packaged, "index.html"))) return packaged;
  }
  return path.join(getRepoRoot(), "client", "ide", "dist");
}

function sidecarDiscoveryPath() {
  return path.join(app.getPath("userData"), "terminal-host.json");
}

async function readReusableSidecar() {
  const discovery = sidecarDiscoveryPath();
  try {
    const config = JSON.parse(fs.readFileSync(discovery, "utf8"));
    if (!config || typeof config.host !== "string" || !config.host ||
        !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
        typeof config.token !== "string" || !config.token) {
      throw new Error("Invalid terminal host discovery.");
    }
    try {
      // A discovered host has already started. A refused loopback listener is
      // stale immediately; busy live hosts retain their recovery grace.
      await waitForSidecarHealth(config, { failFastOnRefused: true });
    } catch (error) {
      if (error.code !== "ECONNREFUSED") {
        // A busy host, reset connection or auth failure does not establish
        // that its terminal sessions are gone. Keep discovery for a retry.
        throw Object.assign(new Error("The previous terminal host could not be verified. Its terminal sessions have been preserved; try reopening Coloride.", { cause: error }), {
          preserveTerminalHost: true,
        });
      }
      throw error;
    }
    if (JSON.stringify(config.cloudConfiguration ?? { enabled: false, appBase: "", apiBase: "" }) !== JSON.stringify(cloudConfig) ||
        config.terminalHostVersion !== TERMINAL_HOST_VERSION ||
        (isDev() && config.devSourceStamp !== developmentSidecarStamp())) {
      const response = await fetch(`http://${config.host}:${config.port}/api/term`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!response.ok) throw Object.assign(new Error("Cannot inspect the running terminal host. Close its terminals before updating."), { preserveTerminalHost: true });
      const sessions = await response.json();
      if (sessions.some((session) => session.status !== "exited")) {
        throw Object.assign(new Error("A previous terminal host still has active sessions. Close those terminal tabs before updating Coloride; their processes have been preserved."), { preserveTerminalHost: true });
      }
      throw new Error("stale terminal host without active sessions");
    }
    return config;
  } catch (error) {
    if (error?.preserveTerminalHost) throw error;
    try {
      fs.unlinkSync(discovery);
    } catch {
      // absent/stale discovery is expected on first launch
    }
    return null;
  }
}

async function startSidecar() {
  const reusable = await readReusableSidecar();
  if (reusable) {
    sidecarConfig = reusable;
    console.log("[sidecar] reusing persistent terminal host", reusable.host, reusable.port);
    return reusable;
  }
  const config = await spawnSidecar();
  config.cloudConfiguration = cloudConfig;
  await waitForSidecarHealth(config);
  try {
    fs.mkdirSync(path.dirname(sidecarDiscoveryPath()), { recursive: true });
    fs.writeFileSync(sidecarDiscoveryPath(), JSON.stringify(config), { mode: 0o600 });
    fs.chmodSync(sidecarDiscoveryPath(), 0o600);
  } catch (error) {
    console.warn("[sidecar] could not write discovery file:", error && error.message);
  }
  return config;
}

function repairInheritedStdio() {
  const devnull = process.platform === "win32" ? "NUL" : "/dev/null";
  for (const fd of [0, 1, 2]) {
    try {
      fs.fstatSync(fd);
    } catch {
      try {
        const opened = fs.openSync(devnull, fd === 0 ? "r" : "a");
        if (opened !== fd) {
          try {
            fs.closeSync(opened);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }
  }
}

function spawnSidecarProcess(command, args, cwd, env) {
  // Electron 43 / Node 24 on macOS throws spawn EBADF when creating stdio
  // pipes (bad inherited fds). Never detach; prefer stdio ignore + launch file.
  repairInheritedStdio();

  const trySpawn = (stdio) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      detached: false,
      stdio,
    });
    if (child.stdin) {
      child.stdin.on("error", () => {});
      try {
        child.stdin.end();
      } catch {
        // stdin may already be closed
      }
    }
    return child;
  };

  const attempts = ["ignore", ["ignore", "ignore", "ignore"]];
  let lastError = null;
  for (const stdio of attempts) {
    try {
      return { child: trySpawn(stdio), detached: false };
    } catch (error) {
      lastError = error;
      if (!error || error.code !== "EBADF") throw error;
      repairInheritedStdio();
    }
  }

  if (process.platform !== "win32") {
    const quoted = [command, ...args].map((part) => `'${String(part).replace(/'/g, `'\\''`)}'`).join(" ");
    try {
      return {
        child: spawn("/bin/sh", ["-c", quoted], {
          cwd,
          env,
          detached: false,
          stdio: "ignore",
        }),
        detached: false,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to spawn sidecar");
}

function spawnSidecar() {
  return new Promise((resolve, reject) => {
    let launch;
    try {
      launch = resolveSidecarLaunch();
    } catch (error) {
      reject(error);
      return;
    }

    const args = [...launch.argsPrefix];
    const launchFile = path.join(os.tmpdir(), `coloride-sidecar-launch-${process.pid}.json`);
    try {
      fs.unlinkSync(launchFile);
    } catch {
      // first launch
    }
    args.push("--launch-file", launchFile);
    args.push("--persistent-log", path.join(app.getPath("userData"), "logs", "terminal-host.log"));
    if (isDev() && launch.mode === "python") {
      args.push("--no-frontend");
    } else if (!isDev() || app.isPackaged) {
      args.push("--frontend-dist", frontendDistPath());
    } else {
      args.push("--no-frontend");
    }

    // Writable cwd: userData when packaged (no monorepo on customer machines).
    const cwd = app.isPackaged
      ? app.getPath("userData")
      : getRepoRoot();

    console.log(
      "[sidecar] spawn:",
      launch.command,
      args.join(" "),
      "cwd=",
      cwd,
      "mode=",
      launch.mode,
    );

    let child;
    let detachedChild = false;
    try {
      const spawned = spawnSidecarProcess(launch.command, args, cwd, sidecarEnv(launch.mode));
      child = spawned.child;
      detachedChild = spawned.detached;
    } catch (error) {
      reject(error);
      return;
    }

    sidecar = child;
    let stderrBuf = "";
    let settled = false;

    const failHint = () =>
      launch.mode === "python" &&
      (stderrBuf.includes("uvicorn") || stderrBuf.includes("ModuleNotFoundError"))
        ? "\n\nDev: install backend deps — tooling/dev/setup-backend-windows.ps1 (Windows) or core/ide-host .venv\n"
        : launch.mode === "bundled"
          ? "\n\nThe embedded backend failed to start. Rebuild the desktop app.\n"
          : "";

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(
        `Python sidecar did not emit launch config within 8 seconds.${failHint()}\nstderr:\n${stderrBuf.slice(-2000)}`,
      ));
    }, 8000);

    const acceptLine = (line) => {
      if (settled) return;
      const trimmed = String(line || "").trim();
      if (!trimmed.startsWith("{")) return;
      settled = true;
      clearTimeout(timeout);
      try {
        sidecarConfig = JSON.parse(trimmed);
        if (detachedChild && process.platform !== "win32") child.unref();
        resolve(sidecarConfig);
      } catch {
        reject(new Error(`Invalid sidecar launch JSON: ${trimmed}`));
      }
    };

    if (child.stdout) {
      const stdout = readline.createInterface({ input: child.stdout });
      stdout.on("line", acceptLine);
    }
    const pollLaunchFile = setInterval(() => {
      if (settled) {
        clearInterval(pollLaunchFile);
        return;
      }
      try {
        const text = fs.readFileSync(launchFile, "utf8");
        for (const line of text.split(/\r?\n/)) acceptLine(line);
      } catch {
        // file may not exist yet
      }
    }, 50);

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderrBuf += text;
        process.stderr.write(`[sidecar] ${text}`);
      });
    }

    child.on("exit", (code, signal) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("sidecar:exit", { code, signal });
      }
      sidecar = null;
      if (code && code !== 0 && !sidecarConfig) {
        clearTimeout(timeout);
        const hint =
          launch.mode === "python" && stderrBuf.includes("ModuleNotFoundError")
            ? "\n\nDev: tooling/dev/setup-backend-windows.ps1 or core/ide-host .venv\n"
            : launch.mode === "bundled"
              ? "\n\nEmbedded backend crashed. Rebuild the desktop app.\n"
              : "";
        reject(new Error(
          `Python sidecar exited with code ${code}.${hint}\nstderr:\n${stderrBuf.slice(-2000)}`,
        ));
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function stopSidecar() {
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
  }
}

/**
 * Ask the Python sidecar to drop the SSH/VPS session before we kill it.
 * Best-effort — timed so quit never hangs if the backend is wedged.
 */
function requestSidecarShutdown(pathname, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const config = sidecarConfig;
    if (!config || !config.host || !config.port || !config.token) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try {
        request.destroy();
      } catch {
        // ignore
      }
      finish(false);
    }, timeoutMs);

    const request = http.request(
      {
        hostname: config.host,
        port: config.port,
        path: pathname,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength("{}"),
        },
      },
      (response) => {
        response.resume();
        clearTimeout(timer);
        finish(response.statusCode >= 200 && response.statusCode < 300);
      },
    );

    request.on("timeout", () => {
      request.destroy();
      clearTimeout(timer);
      finish(false);
    });
    request.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    request.write("{}");
    request.end();
  });
}

function suspendSidecar(timeoutMs = 2500) {
  return requestSidecarShutdown("/api/term/suspend", timeoutMs);
}

let quitting = false;

async function gracefulQuit() {
  if (quitting) return;
  quitting = true;
  try {
    destroyAllBrowserEmbeds();
  } catch {
    // ignore
  }
  try {
    await suspendSidecar();
  } catch (error) {
    console.warn("[quit] terminal suspend failed:", error && error.message);
  }
}

function sendMenuAction(action) {
  if (action === "new-window") {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  // Always route app-menu actions to the main workspace window.
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("coloride:menuAction", action);
}

function accelerator(id, fallback) {
  return toElectronAccelerator(keyboardShortcuts[id] || fallback);
}

/** @type {Array<{ id: string; label: string }>} */
let menuRecents = [];

function recentMenuItems() {
  if (!menuRecents.length) {
    return [{ label: "No Recent Workspaces", enabled: false }];
  }
  return menuRecents.slice(0, 8).map((item) => ({
    label: item.label,
    click: () => sendMenuAction(`open-recent:${item.id}`),
  }));
}

function configureMenu() {
  const isMac = process.platform === "darwin";
  app.setName("Coloride");
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: "Coloride",
      submenu: [
        { role: "about", label: "About Coloride" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: accelerator("navigation.settings", "mod+,"),
          click: () => sendMenuAction("open-settings"),
        },
        {
          label: "Check for Updates…",
          click: () => sendMenuAction("check-for-updates"),
        },
        { type: "separator" },
        {
          label: "Sign Out",
          click: () => sendMenuAction("sign-out"),
        },
        { type: "separator" },
        { role: "services", submenu: [] },
        { type: "separator" },
        { role: "hide", label: "Hide Coloride" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit Coloride" },
      ],
    });
  }

  template.push({
    label: "File",
    submenu: [
      {
        label: "New File",
        accelerator: accelerator("files.new-file", "mod+n"),
        click: () => sendMenuAction("new-file"),
      },
      {
        label: "New Folder",
        click: () => sendMenuAction("new-folder"),
      },
      {
        label: "New Window",
        accelerator: toElectronAccelerator("mod+shift+n"),
        click: () => sendMenuAction("new-window"),
      },
      { type: "separator" },
      {
        label: "Open…",
        accelerator: accelerator("files.open-browser", "mod+o"),
        click: () => sendMenuAction("open-file"),
      },
      {
        label: "Open Folder…",
        click: () => sendMenuAction("open-local-folder"),
      },
      {
        label: "Open Recent",
        submenu: recentMenuItems(),
      },
      { type: "separator" },
      {
        label: "Save",
        accelerator: accelerator("files.save", "mod+s"),
        click: () => sendMenuAction("save-file"),
      },
      {
        label: "Save All",
        accelerator: toElectronAccelerator("alt+mod+s"),
        click: () => sendMenuAction("save-all-files"),
      },
      { type: "separator" },
      {
        label: "Auto Save",
        click: () => sendMenuAction("toggle-auto-save"),
      },
      {
        label: "Revert File",
        click: () => sendMenuAction("revert-file"),
      },
      {
        label: "Close Editor",
        accelerator: toElectronAccelerator("mod+w"),
        click: () => sendMenuAction("close-editor"),
      },
      {
        label: "Close Workspace",
        click: () => sendMenuAction("close-workspace"),
      },
      {
        label: "Close Window",
        accelerator: toElectronAccelerator("mod+shift+w"),
        click: () => sendMenuAction("window-close"),
      },
      ...(!isMac
        ? [
            { type: "separator" },
            { role: "quit", label: "Quit Coloride" },
          ]
        : []),
    ],
  });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      {
        label: "Find",
        accelerator: toElectronAccelerator("mod+f"),
        click: () => sendMenuAction("edit-find"),
      },
      {
        label: "Replace",
        accelerator: toElectronAccelerator("mod+alt+f"),
        click: () => sendMenuAction("edit-replace"),
      },
    ],
  });

  template.push({
    label: "View",
    submenu: [
      {
        label: "Command Palette",
        accelerator: toElectronAccelerator("mod+shift+p"),
        click: () => sendMenuAction("command-palette"),
      },
      { type: "separator" },
      {
        label: "Explorer",
        accelerator: accelerator("navigation.explorer", "mod+shift+e"),
        click: () => sendMenuAction("open-explorer"),
      },
      {
        label: "Agents",
        click: () => sendMenuAction("open-agents"),
      },
      {
        label: "Terminal",
        accelerator: accelerator("terminal.toggle", "mod+j"),
        click: () => sendMenuAction("toggle-terminal"),
      },
      {
        label: "Browser",
        click: () => sendMenuAction("open-browser"),
      },
      { type: "separator" },
      {
        label: "Toggle Sidebar",
        accelerator: accelerator("layout.toggle-sidebar", "mod+b"),
        click: () => sendMenuAction("toggle-side-panel"),
      },
      { type: "separator" },
      { role: "zoom" },
      ...(allowDevTools()
        ? [
            { type: "separator" },
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
          ]
        : []),
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  });

  template.push({
    label: "Agent",
    submenu: [
      {
        label: "New Task",
        accelerator: accelerator("agents.new-task", "mod+t"),
        click: () => sendMenuAction("new-agent-task"),
      },
      { type: "separator" },
      { label: "Ask", click: () => sendMenuAction("agent-mode-ask") },
      { label: "Plan", click: () => sendMenuAction("agent-mode-plan") },
      { label: "Debug", click: () => sendMenuAction("agent-mode-debug") },
      { type: "separator" },
      {
        label: "Select Model",
        click: () => sendMenuAction("agent-select-model"),
      },
      {
        label: "Access Mode",
        submenu: [
          { label: "Request Approval", click: () => sendMenuAction("agent-access-request") },
          { label: "Agent Decides", click: () => sendMenuAction("agent-access-agent") },
          { label: "Full Access", click: () => sendMenuAction("agent-access-full") },
        ],
      },
      { type: "separator" },
      { label: "Stop Agent", click: () => sendMenuAction("stop-agent") },
      { label: "New Agent", click: () => sendMenuAction("new-agent-task") },
    ],
  });

  template.push({
    label: "Terminal",
    submenu: [
      {
        label: "New Terminal",
        accelerator: accelerator("terminal.new", "ctrl+shift+`"),
        click: () => sendMenuAction("new-terminal"),
      },
      {
        label: "Split Terminal",
        click: () => sendMenuAction("split-terminal"),
      },
      { type: "separator" },
      {
        label: "Clear",
        accelerator: accelerator("terminal.clear", "mod+k"),
        click: () => sendMenuAction("clear-terminal"),
      },
      {
        label: "Restart Terminal",
        click: () => sendMenuAction("restart-terminal"),
      },
      {
        label: "Kill Terminal",
        click: () => sendMenuAction("kill-terminal"),
      },
    ],
  });



  template.push({
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac
        ? [
            { type: "separator" },
            { role: "front", label: "Bring All to Front" },
          ]
        : [{ role: "close" }]),
    ],
  });

  template.push({
    label: "Help",
    role: "help",
    submenu: [
      {
        label: "Keyboard Shortcuts",
        click: () => sendMenuAction("open-shortcuts"),
      },
      {
        label: "Report a Bug",
        click: () => sendMenuAction("help-report-bug"),
      },
      {
        label: "Show Logs",
        click: async () => {
          try {
            await shell.openPath(app.getPath("logs"));
          } catch {
            sendMenuAction("open-diagnostics");
          }
        },
      },
      ...(!isMac
        ? [
            { type: "separator" },
            { role: "about", label: "About Coloride" },
          ]
        : []),
    ],
  });

  // macOS owns the application menu bar above the window.
  if (isMac) {
    const original = (label) => template.find(item => item.label === label);
    const separator = {type:"separator"};
    const action = (label, command, accelerator, enabled = true) => ({
      label, enabled, ...(accelerator ? {accelerator} : {}),
      click: () => sendMenuAction(command),
    });
    const editor = (label, command, accelerator) => action(label, `editor-command:${command}`, accelerator);
    const unavailable = (label, accelerator) => action(label, "", accelerator, false);
    const localDocument = (label, filename) => {
      const file = path.join(getRepoRoot(), filename);
      return {label, enabled:fs.existsSync(file), click:() => void shell.openPath(file)};
    };
    const file = {label:"File", submenu:[
      action("New", "new-file", "Command+N"),
      unavailable("New Window", "Shift+Command+N"),
      separator,
      action("Open…", "open-file", "Command+O"),
      {label:"Open Recent…", accelerator:"Alt+Command+O", submenu:recentMenuItems()},

      unavailable("Add Folder to Project…", "Shift+Command+A"),
      separator,
      action("Save", "save-file", "Command+S"),
      unavailable("Save As…", "Shift+Command+S"),
      action("Save All", "save-all-files", "Alt+Command+S"),
      separator,
      action("Close Editor", "close-editor"),
      action("Close Project", "close-workspace"),
      action("Close Window", "window-close", "Shift+Command+W"),
    ]};
    const edit = {label:"Edit", role:"editMenu", submenu:[
      {role:"undo"}, {role:"redo"}, separator,
      {role:"cut"}, {role:"copy"},
      {label:"Copy and Trim", click:() => {
        const contents = mainWindow?.webContents;
        if (!contents || contents.isDestroyed()) return;
        void contents.executeJavaScript(`(() => {const node = document.activeElement; return node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') ? node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0) : window.getSelection()?.toString() || '';})()`).then(text => {if(text) clipboard.writeText(text.trim());}).catch(() => {});
      }},
      {role:"paste"}, separator,
      action("Find", "edit-find", "Command+F"),
      unavailable("Find in Project", "Shift+Command+F"), separator,
      editor("Toggle Line Comment", "toggleComment", "Command+/"), separator,
      {label:"AutoFill",submenu:[unavailable("Contact Info"),unavailable("Passwords")]},
      {label:"Emoji & Symbols",click:() => app.showEmojiPanel()},
    ]};
    const selection = {label:"Selection", submenu:[
      {role:"selectAll"},
      editor("Expand Selection", "expandSelection", "Control+Command+Right"),
      editor("Shrink Selection", "shrinkSelection", "Control+Command+Left"),
      editor("Select Next Sibling", "selectNextSibling", "Control+Command+Down"),
      editor("Select Previous Sibling", "selectPreviousSibling", "Control+Command+Up"), separator,
      editor("Add Cursor Above", "addCursorAbove", "Alt+Command+Up"),
      editor("Add Cursor Below", "addCursorBelow", "Alt+Command+Down"),
      editor("Select Next Occurrence", "selectNext", "Command+D"),
      editor("Select Previous Occurrence", "selectPrevious", "Control+Shift+Command+D"),
      editor("Select All Occurrences", "selectAllOccurrences", "Shift+Command+L"), separator,
      editor("Move Line Up", "moveLineUp", "Alt+Up"),
      editor("Move Line Down", "moveLineDown", "Alt+Down"),
      editor("Duplicate Selection", "duplicateSelection", "Alt+Shift+Down"),
    ]};
    const view = {label:"View", submenu:[
      action("Zoom In", "editor-zoom-in", "Command+="),
      action("Zoom Out", "editor-zoom-out", "Command+-"),
      action("Reset Zoom", "editor-zoom-reset", "Command+0"),
      action("Reset All Zoom", "editor-zoom-reset-all"), separator,
      action("Toggle Left Dock", "toggle-side-panel", "Command+B"),
      action("Toggle Right Dock", "toggle-right-dock", "Alt+Command+B"),
      action("Toggle Bottom Dock", "toggle-terminal", "Command+J"),
      action("Toggle All Docks", "toggle-all-docks", "Alt+Command+Y"),
      {label:"Editor Layout", submenu:[{label:"Single Pane",type:"radio",checked:true},unavailable("Split Right"),unavailable("Split Down")]}, separator,
      action("Project Panel", "open-explorer", "Shift+Command+E"),
      unavailable("Outline Panel", "Shift+Command+B"),
      unavailable("Collab Panel", "Shift+Command+C"),
      action("Terminal Panel", "toggle-terminal", "Control+`"),
      unavailable("Debugger Panel", "Shift+Command+D"),
      action("Agent Panel", "toggle-right-dock"),
      unavailable("Git Panel", "Control+Shift+G"), separator,
      action("Diagnostics", "toggle-problems", "Shift+Command+M"), separator,
      {role:"togglefullscreen",label:"Enter Full Screen"},
    ]};
    const go = {label:"Go", submenu:[
      action("Back", "navigation-back", "Control+-"),
      action("Forward", "navigation-forward", "Control+Shift+-"), separator,
      action("Command Palette…", "command-palette", "Shift+Command+P"), separator,
      action("Go to File…", "open-file", "Command+P"),
      editor("Go to Symbol in Editor…", "goToSymbol", "Shift+Command+O"),
      editor("Go to Line/Column…", "goToLine", "Control+G"), separator,
      editor("Go to Definition", "goToDefinition", "F12"),
      unavailable("Go to Declaration", "Control+F12"),
      unavailable("Go to Type Definition", "Command+F12"),
      editor("Find All References", "findReferences", "Alt+Shift+F12"),
      unavailable("Show Incoming Calls"), unavailable("Show Outgoing Calls"), separator,
      editor("Next Problem", "nextProblem", "F8"),
      editor("Previous Problem", "previousProblem", "Shift+F8"),
    ]};
    const run = {label:"Run", submenu:[
      action("Spawn Task", "new-terminal", "Shift+Command+R"),
      unavailable("Start Debugger", "F4"), separator,
      unavailable("Edit tasks.json…"), unavailable("Edit debug.json…"), separator,
      unavailable("Continue", "F5"), unavailable("Step Over", "F7"),
      unavailable("Step Into", "F11"), unavailable("Step Out", "Shift+F11"), separator,
      editor("Toggle Breakpoint", "toggleBreakpoint", "F9"),
      unavailable("Edit Breakpoint", "Shift+F9"),
      unavailable("Clear All Breakpoints"),
    ]};
    const windowMenu = {...original("Window"),role:"windowMenu"};
    const help = {label:"Help",role:"help",submenu:[
      localDocument("View Release Notes Locally", "CHANGELOG.md"),
      unavailable("View Telemetry"),
      localDocument("View Dependency Licenses", "THIRD_PARTY_NOTICES.md"),

      action("File Bug Report…", "help-report-bug"),
      unavailable("Request Feature…"),
      unavailable("Email Us…"), separator,
      ...original("Help").submenu.filter(item => item.label === "Documentation"),
      unavailable("Coloride Repository"), unavailable("Coloride Twitter"), unavailable("Join the Team"),
    ]};
    Menu.setApplicationMenu(Menu.buildFromTemplate([original("Coloride"),file,edit,selection,view,go,run,windowMenu,help]));
  } else {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

/** Startup is translucent; normal app/login surfaces restore the opaque plate. */
let windowBackdropMode = "opaque";
let startupBackdropActive = false;
let pendingBackdropOptions = {};
const startupSplashes = new WeakMap();

/** Keep one loading document alive while the real renderer navigates/paints. */
function createStartupSplash(win, appearance) {
  const view = new WebContentsView({
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [`--coloride-startup-theme=${appearance}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: allowDevTools(),
    },
  });
  view.setBackgroundColor("rgba(0, 0, 0, 0)");
  win.contentView.addChildView(view);
  lockDownDevTools(view.webContents);
  lockPageZoom(view.webContents);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let disposed = false;
  const resize = () => {
    if (disposed || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  const resizeEvents = ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const event of resizeEvents) win.removeListener(event, resize);
    win.removeListener("closed", dispose);
    startupSplashes.delete(win);
    try { if (!win.isDestroyed()) win.contentView.removeChildView(view); } catch { /* Window teardown. */ }
    if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  };
  const state = { view, dispose, ready: null, finishing: null };
  startupSplashes.set(win, state);
  for (const event of resizeEvents) win.on(event, resize);
  win.once("closed", dispose);
  resize();
  state.ready = view.webContents.loadFile(splashHtmlPath, { query: { theme: appearance } }).then(() => {
    if (disposed || win.isDestroyed()) return;
    // The primary webContents stays the production app; its first document is
    // never replaced by a second loading SVG with a restarted animation.
    win.maximize();
    resize();
    ensureMacTrafficLights(win);
    win.show();
  }).catch((error) => {
    console.error("[Electron] splash failed", error);
    dispose();
  });
  return state.ready;
}

function keepStartupSplashOnTop(win) {
  const view = startupSplashes.get(win)?.view;
  if (view && !view.webContents.isDestroyed()) {
    // Re-adding an existing child only moves it to the top. A restored browser
    // pane must not cover the loading mark while its app shell is still fading.
    win.contentView.addChildView(view);
  }
}

async function finishStartupSplash(win) {
  if (!win || win.isDestroyed()) return false;
  const state = startupSplashes.get(win);
  if (state?.finishing) return state.finishing;
  const finish = async () => {
    if (state) {
      await state.ready;
      try {
        if (!state.view.webContents.isDestroyed()) {
          // The renderer starts its matching crossfade before this IPC. The
          // splash waits for its last transparent frame before releasing it.
          await state.view.webContents.executeJavaScript("window.finishColorideSplash?.()");
        }
        if (!win.webContents.isDestroyed()) {
          await win.webContents.executeJavaScript(`(async () => {
            const root = document.getElementById("root");
            if (root) {
              const fades = root.getAnimations().filter(animation =>
                animation.effect?.getKeyframes().some(frame => frame.opacity !== undefined));
              await Promise.all(fades.map(animation => animation.finished.catch(() => {})));
            }
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          })()`);
        }
      } catch (error) {
        console.warn("[Electron] splash fade failed:", error && error.message);
      }
    }
    if (win.isDestroyed()) return false;
    startupBackdropActive = false;
    const applied = applyWindowBackdrop(win, windowBackdropMode, pendingBackdropOptions);
    const restoreFocus = win.isFocused() && state && !state.view.webContents.isDestroyed()
      && state.view.webContents.isFocused();
    state?.dispose();
    if (restoreFocus && !win.webContents.isDestroyed()) win.webContents.focus();
    return applied;
  };
  const finishing = finish();
  if (state) state.finishing = finishing;
  return finishing;
}

const startupAppearancePath = () => path.join(app.getPath("userData"), "window-appearance.json");
function readStartupAppearance() {
  try {
    const appearance = JSON.parse(fs.readFileSync(startupAppearancePath(), "utf8")).appearance;
    if (appearance === "light" || appearance === "dark") return appearance;
  } catch { /* First run follows macOS. */ }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}
function rememberWindowAppearance(appearance) {
  if (appearance !== "light" && appearance !== "dark") return;
  try {
    const value = JSON.stringify({ appearance });
    try { if (fs.readFileSync(startupAppearancePath(), "utf8") === value) return; } catch {}
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(startupAppearancePath(), value);
  } catch { /* A read-only profile must not block startup. */ }
}

const WINDOW_BACKGROUND_DARK = "#171717";
const WINDOW_BACKGROUND_LIGHT = "#ffffff";

function nativeWindowBackground() {
  try {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
  } catch {
    return WINDOW_BACKGROUND_DARK;
  }
}

function appUrlFromSidecar(config) {
  if (!isDev()) {
    return `http://${config.host}:${config.port}/`;
  }
  // Dev: prefer Vite (better DX + assets). Override with a file:// static build if needed:
  // COLORIDE_WEB_DEV_URL="file:///absolute/path/to/dist/index.html"
  return process.env.COLORIDE_WEB_DEV_URL || "http://127.0.0.1:5173";
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const startupAppearance = readStartupAppearance();
  nativeTheme.themeSource = startupAppearance;
  applyAppIcon();
  const appIconPath = resolveAppIconPath();

  // VS Code pattern: macOS keeps native NSWindow (do NOT set frame:false).
  // Keep native traffic lights and resizing. The compositor must be transparent
  // from construction for the startup material to sample the desktop.
  /** @type {import('electron').BrowserWindowConstructorOptions} */
  const windowOptions = {
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "Coloride",
    show: false,
    // Native plate shown for the few frames Chromium cannot repaint while the
    // OS window is moved/resized. Keep it aligned with the current OS theme;
    // the renderer updates it to the saved Coloride theme after mounting.
    backgroundColor: isMac ? "rgba(255, 255, 255, 0)" : (startupAppearance === "light" ? WINDOW_BACKGROUND_LIGHT : WINDOW_BACKGROUND_DARK),
    // Win/Linux window icon; macOS Dock uses applyAppIcon() above.
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      additionalArguments: [`--coloride-startup-theme=${startupAppearance}`, "--coloride-native-startup-splash"],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
      // Users must not open Chromium DevTools in release builds.
      devTools: allowDevTools(),
    },
  };

  if (isMac) {
    windowOptions.titleBarStyle = "hidden";
    windowOptions.transparent = true;
    windowOptions.vibrancy = "hud";
    windowOptions.visualEffectState = "active";
    // Native size comes from Electron/SDK; position only.
    windowOptions.trafficLightPosition = { x: 13.2, y: 12.5 };
  } else {
    windowOptions.frame = false;
    if (isWin) windowOptions.backgroundMaterial = "none";
  }

  mainWindow = new BrowserWindow(windowOptions);

  windowBackdropMode = "opaque";
  pendingBackdropOptions = { appearance: startupAppearance };
  startupBackdropActive = true;
  wireWindowMaximizeEvents(mainWindow);
  lockDownDevTools(mainWindow.webContents);
  lockPageZoom(mainWindow.webContents);

  // Keep lights visible when unfocused (another app on top) and after theme flips.
  mainWindow.on("focus", () => {
    ensureMacTrafficLights(mainWindow);
  });
  mainWindow.on("blur", () => {
    // Unfocused light windows were the repro: lights gone until click-back.
    ensureMacTrafficLights(mainWindow);
  });
  mainWindow.on("show", () => {
    ensureMacTrafficLights(mainWindow);
  });
  mainWindow.on("restore", () => {
    ensureMacTrafficLights(mainWindow);
  });

  mainWindow.webContents.on("dom-ready", () => {
    // Solid chrome (opaque native window).
    void mainWindow.webContents.insertCSS(`
      html.login-gate-active,
      html.login-gate-active body,
      html.login-gate-active #root,
      body.login-gate-active,
      body.login-gate-active #root {
        background: #171717 !important;
        background-color: #171717 !important;
      }
    `).catch(() => undefined);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Close Without Saving", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "You have unsaved file changes.",
      detail: "Close Coloride without saving them?",
    });
    if (choice === 0) event.preventDefault();
  });

  const sidecarReady = startSidecar();
  // Initialize the primary renderer before creating auxiliary views. It owns
  // the app page for the whole window lifetime, including the loading phase.
  await mainWindow.loadURL("about:blank");
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.webContents.executeJavaScript(`
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  `);
  // A transparent child view keeps the same SVG/animation throughout startup;
  // navigating the app below it cannot clear or restart the loading artwork.
  const splashReady = createStartupSplash(mainWindow, startupAppearance);

  await splashReady;
  autoUpdate.setMainWindow(mainWindow);

  const config = await sidecarReady;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const url = appUrlFromSidecar(config);
  const sidecarReadyMs = elapsedSinceBootMs();
  console.log(`[Electron] sidecar ready in ${formatBootDuration(sidecarReadyMs)}`);
  console.log("[Electron] loading:", url);
  // This is deliberately registered after the splash has finished. It tracks
  // the real React/Vite page, not the instant native splash screen.
  mainWindow.webContents.once("did-finish-load", () => {
    // If the loading view failed, the real app must still become visible.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.maximize();
      ensureMacTrafficLights(mainWindow);
      mainWindow.show();
    }
    const totalMs = elapsedSinceBootMs();
    console.log(
      `[Electron] app loaded in ${formatBootDuration(totalMs)} ` +
      `(sidecar: ${formatBootDuration(sidecarReadyMs)}, renderer: ${formatBootDuration(totalMs - sidecarReadyMs)})`,
    );
  });
  await mainWindow.loadURL(url);
}

ipcMain.handle("coloride:getRuntime", () => sidecarConfig);

ipcMain.handle("coloride:getAppInfo", () => ({
  version: getColorideVersion(),
  platform: process.platform,
  arch: process.arch,
  packaged: app.isPackaged,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome,
  nodeVersion: process.versions.node
}));

/**
 * Backdrop mode after sign-in / login.
 * After the startup overlay fades, restore an opaque native plate for the IDE
 * and login. "glass" retains the legacy login API without enabling vibrancy.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {"glass"|"opaque"} mode
 * @param {{ appearance?: "dark"|"light"|"system" }} [options]
 */
function applyWindowBackdrop(win, mode, options = {}) {
  if (!win || win.isDestroyed()) return false;
  const glass = mode === "glass";
  windowBackdropMode = glass ? "glass" : "opaque";
  pendingBackdropOptions = options;
  rememberWindowAppearance(options.appearance);
  // Renderer mounts underneath the frosted overlay. Keep native vibrancy until
  // its fade has finished instead of switching the entire window in one frame.
  if (startupBackdropActive) return true;
  const appearance = options.appearance === "light" || options.appearance === "dark" || options.appearance === "system"
    ? options.appearance
    : glass
      ? "dark"
      : "system";
  try {
    try {
      nativeTheme.themeSource = appearance;
    } catch {
      // ignore
    }
    // Startup is finished: normal IDE/login windows use an opaque native plate.
    if (process.platform === "darwin" && typeof win.setVibrancy === "function") {
      try { win.setVibrancy(null); } catch { /* ignore */ }
    }
    if (process.platform === "win32" && typeof win.setBackgroundMaterial === "function") {
      try { win.setBackgroundMaterial("none"); } catch { /* ignore */ }
    }
    // Only the startup compositor uses a transparent plate.
    let bg = WINDOW_BACKGROUND_DARK;
    if (appearance === "light") {
      bg = WINDOW_BACKGROUND_LIGHT;
    } else if (appearance === "system") {
      bg = nativeWindowBackground();
    }
    win.setBackgroundColor(bg);
    ensureMacTrafficLights(win);
    return true;
  } catch (error) {
    console.error("[window] applyWindowBackdrop failed:", error);
    return false;
  }
}

/** macOS: keep native traffic lights visible and at the title-bar offset. */
function ensureMacTrafficLights(win) {
  if (!win || win.isDestroyed() || process.platform !== "darwin") return;
  try {
    if (typeof win.setWindowButtonVisibility === "function") {
      win.setWindowButtonVisibility(true);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof win.setWindowButtonPosition === "function") {
      win.setWindowButtonPosition({ x: 13.2, y: 12.5 });
    }
  } catch {
    // ignore
  }
}

ipcMain.on("coloride:hasStartupSplash", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = Boolean(win && startupSplashes.has(win));
});

ipcMain.handle("coloride:finishStartup", async (event) => {
  const win = mainWindow;
  if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  return await finishStartupSplash(win);
});

ipcMain.handle("coloride:setWindowBackdrop", (_event, mode, options) => {
  const next = mode === "glass" ? "glass" : "opaque";
  const appearance =
    options && typeof options === "object" && typeof options.appearance === "string"
      ? options.appearance
      : undefined;
  return applyWindowBackdrop(mainWindow, next, appearance ? { appearance } : {});
});

/** Renderer can re-show traffic lights after selection / layout glitches. */
ipcMain.handle("coloride:ensureTrafficLights", () => {
  ensureMacTrafficLights(mainWindow);
  return true;
});

ipcMain.handle("coloride:openExternal", async (_event, externalUrl) => {
  const safeUrl = validateHttpsUrl(externalUrl, "External URL");
  await shell.openExternal(safeUrl);
  return true;
});

/**
 * Bring the desktop window forward after browser device-login Approve.
 * Website does not open the app — desktop polls until approved, then calls this.
 * No custom protocol / deep link.
 */
ipcMain.handle("coloride:focusMainWindow", async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return false;
  try {
    if (process.platform === "darwin" && app.dock) {
      try {
        app.dock.show();
      } catch {
        // ignore
      }
    }
    if (win.isMinimized()) win.restore();
    if (typeof win.isVisible === "function" && !win.isVisible()) win.show();
    else win.show();
    // Brief always-on-top helps steal focus from Chrome on macOS after Approve.
    try {
      win.setAlwaysOnTop(true, "screen-saver");
    } catch {
      try {
        win.setAlwaysOnTop(true);
      } catch {
        // ignore
      }
    }
    win.moveTop();
    win.focus();
    if (process.platform === "darwin") {
      try {
        app.focus({ steal: true });
      } catch {
        try {
          app.focus();
        } catch {
          // ignore
        }
      }
    }
    setTimeout(() => {
      try {
        if (!win.isDestroyed()) {
          win.setAlwaysOnTop(false);
          win.focus();
        }
      } catch {
        // ignore
      }
    }, 800);
    return true;
  } catch (error) {
    console.error("[coloride] focusMainWindow failed", error);
    return false;
  }
});

/** Frameless Windows/Linux chrome — minimize / maximize / close. */
function windowFromEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}

function wireWindowMaximizeEvents(win) {
  if (!win || win.isDestroyed()) return;
  const push = () => {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      win.webContents.send("coloride:window:maximized", win.isMaximized());
    } catch {
      // ignore
    }
  };
  win.on("maximize", push);
  win.on("unmaximize", push);
}

ipcMain.handle("coloride:window:minimize", (event) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  win.minimize();
  return true;
});

ipcMain.handle("coloride:window:toggleMaximize", (event) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle("coloride:window:isMaximized", (event) => {
  const win = windowFromEvent(event);
  return Boolean(win && win.isMaximized());
});

ipcMain.handle("coloride:window:close", (event) => {
  const win = windowFromEvent(event);
  if (!win) return false;
  win.close();
  return true;
});

/** Cloud account refresh token — OS-encrypted and never exposed to the renderer. */
const CLOUD_REFRESH_TOKEN_FILE = "cloud-auth-refresh.v1";
/** After Sign Out, refuse to persist or refresh until a new device-login succeeds. */
let cloudAuthSignedOut = false;
/** One in-flight /auth/refresh so boot + keep-alive cannot stampede a dead token. */
let cloudAuthRefreshInFlight = null;
/**
 * A transient outage must not make every renderer retry wait for the full
 * network timeout. Keep the last offline result briefly and answer IPC calls
 * immediately while the cloud is unavailable.
 */
const CLOUD_AUTH_TRANSIENT_COOLDOWN_MS = 30_000;
let cloudAuthRefreshCooldownUntil = 0;
let cloudAuthLastTransientResult = null;

function clearCloudAuthRefreshCooldown() {
  cloudAuthRefreshCooldownUntil = 0;
  cloudAuthLastTransientResult = null;
}

function cloudAuthTransientResult(error) {
  const status = Number(error && error.status) || 0;
  const message = String(
    (error && error.message) || "Coloride Cloud is temporarily unavailable.",
  );
  return {
    ok: false,
    transient: true,
    retryAfterMs: CLOUD_AUTH_TRANSIENT_COOLDOWN_MS,
    error: {
      code: status === 0 ? "cloud_unavailable" : "cloud_refresh_failed",
      message,
      status,
    },
  };
}

function isCloudRefreshRevoked(error) {
  const status = Number(error && error.status);
  if (status === 401 || status === 403) return true;
  const message = String((error && error.message) || "").toLowerCase();
  const payload = error && error.payload && typeof error.payload === "object" ? error.payload : null;
  const nested = payload && payload.error && typeof payload.error === "object" ? payload.error : null;
  const detail = String(
    (nested && nested.message) || (payload && payload.message) || "",
  ).toLowerCase();
  return (
    message.includes("invalid or expired refresh")
    || detail.includes("invalid or expired refresh")
    || detail.includes("invalid_grant")
    || (detail.includes("refresh token") && detail.includes("invalid"))
  );
}

function cloudRefreshTokenPath() {
  const suffix = cloudConfig.apiBase ? `.${require("node:crypto").createHash("sha256").update(cloudConfig.apiBase).digest("hex").slice(0, 16)}` : "";
  return path.join(app.getPath("userData"), CLOUD_REFRESH_TOKEN_FILE + suffix);
}

/**
 * OS encryption is usable only when Electron can encrypt and the Linux backend
 * is a real secret store. `basic_text` still reports encryption available, but
 * it wraps the token with a hardcoded key, so the file is effectively plaintext.
 * When this is false the refresh token stays in main-process memory only.
 */
function cloudRefreshTokenEncryptionAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
  } catch {
    return false;
  }
  if (process.platform !== "linux") return true;
  try {
    return safeStorage.getSelectedStorageBackend() !== "basic_text";
  } catch {
    return false;
  }
}

/** In-process session used only while OS encryption cannot protect the token. */
let cloudRefreshTokenMemory = null;

function readCloudRefreshToken() {
  if (!cloudConfig.enabled) return null;
  if (!cloudRefreshTokenEncryptionAvailable()) {
    return cloudRefreshTokenMemory;
  }
  try {
    const filePath = cloudRefreshTokenPath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath);
    if (!raw.length) return null;
    return safeStorage.decryptString(raw);
  } catch (error) {
    console.error("[cloudAuth] failed to read refresh token:", error);
    return null;
  }
}

function writeCloudRefreshToken(token) {
  if (cloudAuthSignedOut) return false;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Refresh token must be a non-empty string.");
  }
  const value = token.trim();
  if (!cloudRefreshTokenEncryptionAvailable()) {
    // Never persist a token that cannot be encrypted. Drop any earlier plaintext file.
    cloudRefreshTokenMemory = value;
    clearCloudRefreshTokenFile();
    console.warn("[cloudAuth] OS encryption unavailable; refresh token kept in memory for this session only.");
    return true;
  }
  cloudRefreshTokenMemory = null;
  const filePath = cloudRefreshTokenPath();
  fs.writeFileSync(filePath, safeStorage.encryptString(value), { mode: 0o600 });
  return true;
}

function clearCloudRefreshTokenFile() {
  try {
    const filePath = cloudRefreshTokenPath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error("[cloudAuth] failed to clear refresh token:", error);
  }
}

function clearCloudRefreshToken() {
  cloudRefreshTokenMemory = null;
  clearCloudRefreshTokenFile();
  return true;
}

/**
 * A previous build wrote the refresh token in plaintext when safeStorage was
 * unavailable. Do not load that file into memory — delete it. The user signs
 * in again, and the new token stays in memory until encryption is available.
 */
function discardUnprotectedCloudRefreshToken() {
  if (!cloudConfig.enabled || cloudRefreshTokenEncryptionAvailable()) return;
  try {
    const filePath = cloudRefreshTokenPath();
    if (!fs.existsSync(filePath)) return;
    fs.unlinkSync(filePath);
    console.warn("[cloudAuth] removed an unprotected refresh token file; sign in again to restore the session.");
  } catch (error) {
    console.error("[cloudAuth] failed to remove unprotected refresh token:", error);
  }
}

function cloudAuthPayloadBag(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["tokens", "data", "session"]) {
    const nested = payload[key];
    if (nested && typeof nested === "object") return nested;
  }
  return payload;
}

function authTokenFromPayload(payload, names) {
  const bag = cloudAuthPayloadBag(payload);
  for (const source of [bag, payload]) {
    if (!source || typeof source !== "object") continue;
    for (const name of names) {
      const value = source[name];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function withoutRefreshTokens(value) {
  if (Array.isArray(value)) return value.map(withoutRefreshTokens);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "refresh_token" || key === "refreshToken") continue;
    clean[key] = withoutRefreshTokens(nested);
  }
  return clean;
}

async function cloudAuthRequest(pathname, options = {}) {
  if (!cloudConfig.enabled) throw new Error("Cloud services are disabled in this distribution.");
  const base = cloudConfig.apiBase;
  const apiKey = String(process.env.COLORIDE_CLOUD_API_KEY || process.env.COLORIDE_API_KEY || "").trim();
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${base}${pathname}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && (error.name === "AbortError" || /abort/i.test(String(error.message || "")))) {
      const timeout = new Error("Cloud authentication timed out.");
      timeout.status = 0;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const error = new Error(`Cloud authentication failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

ipcMain.handle("coloride:cloudAuth:hasSession", () => {
  if (cloudAuthSignedOut) return false;
  return Boolean(readCloudRefreshToken());
});

ipcMain.handle("coloride:cloudAuth:requestDeviceCode", () =>
  cloudAuthRequest("/auth/device/code", { method: "POST", body: {} }));

ipcMain.handle("coloride:cloudAuth:pollDeviceCode", async (_event, deviceCode) => {
  if (typeof deviceCode !== "string" || !deviceCode.trim()) {
    throw new Error("Device code is required.");
  }
  const code = encodeURIComponent(deviceCode.trim());
  const payload = await cloudAuthRequest(
    `/auth/device/poll?device_code=${code}&challenge=${code}`,
  );
  const refresh = authTokenFromPayload(payload, ["refresh_token", "refreshToken"]);
  // A completed browser-link login is a new sign-in — lift the Sign Out latch.
  if (refresh) {
    cloudAuthSignedOut = false;
    clearCloudAuthRefreshCooldown();
    writeCloudRefreshToken(refresh);
  }
  return withoutRefreshTokens(payload);
});

ipcMain.handle("coloride:cloudAuth:refreshSession", async () => {
  if (cloudAuthSignedOut) {
    return { ok: false, revoked: true, error: { code: "signed_out", message: "Signed out.", status: 401 } };
  }
  if (
    cloudAuthLastTransientResult
    && Date.now() < cloudAuthRefreshCooldownUntil
  ) {
    return {
      ...cloudAuthLastTransientResult,
      retryAfterMs: Math.max(0, cloudAuthRefreshCooldownUntil - Date.now()),
    };
  }
  if (cloudAuthRefreshInFlight) return cloudAuthRefreshInFlight;
  cloudAuthRefreshInFlight = (async () => {
    try {
      const refresh = readCloudRefreshToken();
      if (!refresh) return null;
      const payload = await cloudAuthRequest("/auth/refresh", {
        method: "POST",
        body: { refresh_token: refresh },
      });
      if (cloudAuthSignedOut) {
        return { ok: false, revoked: true, error: { code: "signed_out", message: "Signed out.", status: 401 } };
      }
      const rotated = authTokenFromPayload(payload, ["refresh_token", "refreshToken"]);
      if (rotated) writeCloudRefreshToken(rotated);
      clearCloudAuthRefreshCooldown();
      return withoutRefreshTokens(payload);
    } catch (error) {
      if (isCloudRefreshRevoked(error)) {
        clearCloudAuthRefreshCooldown();
        clearCloudRefreshToken();
        const payload = error && error.payload && typeof error.payload === "object" ? error.payload : null;
        const nested = payload && payload.error && typeof payload.error === "object" ? payload.error : null;
        return {
          ok: false,
          revoked: true,
          error: {
            code: "http_error",
            message: (nested && nested.message) || "Invalid or expired refresh token",
            status: Number(error && error.status) || 401,
          },
        };
      }
      const result = cloudAuthTransientResult(error);
      cloudAuthLastTransientResult = result;
      cloudAuthRefreshCooldownUntil = Date.now() + CLOUD_AUTH_TRANSIENT_COOLDOWN_MS;
      console.warn(
        "[cloudAuth] refresh unavailable; continuing with the cached account:",
        result.error.message,
      );
      return result;
    } finally {
      cloudAuthRefreshInFlight = null;
    }
  })();
  return cloudAuthRefreshInFlight;
});

ipcMain.handle("coloride:cloudAuth:logout", async (_event, remote = true) => {
  const refresh = readCloudRefreshToken();
  // Latch + drop the stored session first so a hung remote revoke cannot keep
  // hasSession() true and bounce the renderer back into the app.
  cloudAuthSignedOut = true;
  clearCloudAuthRefreshCooldown();
  clearCloudRefreshToken();
  if (remote && refresh) {
    try {
      await cloudAuthRequest("/auth/logout", {
        method: "POST",
        body: { refresh_token: refresh },
      });
    } catch {
      // Local session is already gone.
    }
  }
  return true;
});

ipcMain.handle("coloride:checkForUpdates", (_event, channel) => checkForUpdates(channel));

ipcMain.handle("coloride:getUpdateState", () => {
  if (autoUpdate.isAutoUpdateSupported()) {
    return snapshotToLegacyResult(autoUpdate.getSnapshot());
  }
  return {
    available: false,
    channel: "stable",
    currentVersion: getColorideVersion(),
    latestVersion: getColorideVersion(),
    status: "idle",
    progress: 0,
    canInstall: false,
    autoUpdateEnabled: false,
    error: null,
    checkedAt: null,
    hasChecksum: false,
    hasSignature: false,
  };
});

ipcMain.handle("coloride:downloadUpdate", async () => {
  const snap = await autoUpdate.downloadUpdate();
  return snapshotToLegacyResult(snap);
});

ipcMain.handle("coloride:quitAndInstallUpdate", () => autoUpdate.quitAndInstall());

ipcMain.handle("coloride:openUpdateDownload", async (_event, downloadUrl) => {
  const safeUrl = validateHttpsUrl(downloadUrl, "Update download URL");
  await shell.openExternal(safeUrl);
  return true;
});

ipcMain.on("coloride:setKeyboardShortcuts", (_event, nextBindings) => {
  if (!nextBindings || typeof nextBindings !== "object") return;
  keyboardShortcuts = {
    ...keyboardShortcuts,
    ...Object.fromEntries(Object.entries(nextBindings).filter(([, value]) => typeof value === "string"))
  };
  configureMenu();
});

ipcMain.on("coloride:setMenuRecents", (_event, recents) => {
  if (!Array.isArray(recents)) return;
  menuRecents = recents
    .filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
    .slice(0, 8);
  configureMenu();
});

ipcMain.handle("coloride:localPathAction", async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Unavailable outside the workspace window.");
  const target = payload?.path;
  if (typeof target !== "string" || target.includes("\0") || !path.isAbsolute(target) || !fs.existsSync(target)) throw new Error("Choose an existing local path.");
  if (payload.action === "reveal") {shell.showItemInFolder(target); return;}
  if (payload.action !== "open") throw new Error("Unsupported local path action.");
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});

ipcMain.handle("coloride:openFolder", async () => {
  const options = {
    title: "Open Folder",
    properties: ["openDirectory", "createDirectory"],
  };
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = target
    ? await dialog.showOpenDialog(target, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

const CLIPBOARD_FILE_MAX_BYTES = 50 * 1024 * 1024;

const CLIPBOARD_EXT_MIME = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  css: "text/css",
  html: "text/html",
  js: "text/javascript",
  ts: "text/typescript",
  py: "text/x-python",
};

function mimeFromFilePath(filePath) {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return CLIPBOARD_EXT_MIME[ext] || "application/octet-stream";
}

/**
 * Real file paths from the OS clipboard (Finder copy, etc.).
 * macOS often ALSO puts a Quick Look PNG thumbnail when you copy a .ttf/.pdf —
 * callers must prefer these paths over readImage().
 */
function readOsClipboardFilePaths() {
  const paths = [];
  const { fileURLToPath } = require("node:url");
  const { execFileSync } = require("node:child_process");

  const pushCandidate = (value) => {
    const raw = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    if (!raw) return;
    try {
      let filePath = raw;
      if (/^file:/i.test(raw)) {
        filePath = fileURLToPath(raw);
      } else if (raw.startsWith("file://")) {
        filePath = decodeURIComponent(raw.replace(/^file:\/\/(localhost)?/i, ""));
      } else if (raw.includes("%") && raw.startsWith("/")) {
        try { filePath = decodeURIComponent(raw); } catch { /* keep */ }
      }
      // Strip trailing nulls / whitespace from pasteboard blobs
      filePath = filePath.replace(/\0/g, "").trim();
      if (!filePath.startsWith("/")) return;
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;
      paths.push(filePath);
    } catch {
      // ignore bad entries
    }
  };

  const formatsToTry = [
    "public.file-url",
    "text/uri-list",
    "com.apple.pasteboard.promised-file-url",
  ];

  for (const format of formatsToTry) {
    try {
      const raw = clipboard.read(format);
      if (raw) {
        for (const line of String(raw).split(/[\r\n\0]+/)) pushCandidate(line);
      }
    } catch {
      // format not available
    }
  }

  // Some builds only expose the URL as a raw buffer.
  for (const format of ["public.file-url", "public.url"]) {
    try {
      const buf = clipboard.readBuffer(format);
      if (buf && buf.length > 0) {
        for (const line of buf.toString("utf8").split(/[\r\n\0]+/)) pushCandidate(line);
      }
    } catch {
      // ignore
    }
  }

  try {
    for (const format of clipboard.availableFormats()) {
      if (!/file-url|uri-list|filename|public\.url/i.test(format)) continue;
      if (formatsToTry.includes(format)) continue;
      try {
        const raw = clipboard.read(format);
        if (raw) {
          for (const line of String(raw).split(/[\r\n\0]+/)) pushCandidate(line);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // macOS fallback: AppleScript resolves Finder file copies reliably
  // (Electron pasteboard formats are inconsistent across OS versions).
  if (paths.length === 0 && process.platform === "darwin") {
    try {
      const script = [
        'try',
        '  set out to ""',
        '  set theClip to the clipboard',
        '  try',
        '    set f to the clipboard as «class furl»',
        '    set out to POSIX path of f',
        '  end try',
        '  if out is "" then',
        '    try',
        '      set theList to the clipboard as list',
        '      repeat with anItem in theList',
        '        try',
        '          set out to out & (POSIX path of (anItem as alias)) & linefeed',
        '        end try',
        '      end repeat',
        '    end try',
        '  end if',
        '  return out',
        'on error',
        '  return ""',
        'end try',
      ].join("\n");
      const out = execFileSync("osascript", ["-e", script], {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      });
      for (const line of String(out || "").split(/[\r\n]+/)) pushCandidate(line);
    } catch {
      // osascript unavailable / denied
    }
  }

  return [...new Set(paths)];
}

/**
 * Read real clipboard files as base64 payloads (any type: ttf, zip, pdf…).
 * Empty array when the clipboard has no file paths (e.g. pure screenshot).
 */
function readOsClipboardFilesPayload() {
  const filePaths = readOsClipboardFilePaths();
  const files = [];
  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > CLIPBOARD_FILE_MAX_BYTES) continue;
      const buffer = fs.readFileSync(filePath);
      files.push({
        name: path.basename(filePath),
        mime: mimeFromFilePath(filePath),
        dataBase64: buffer.toString("base64"),
        byteLength: buffer.length,
      });
    } catch (error) {
      console.warn("[coloride] clipboard file read failed:", filePath, error);
    }
  }
  return files;
}

/**
 * Read image bytes from the OS clipboard (screenshots, Discord, Figma, etc.).
 * Renderer `paste` events often omit image files in Electron/macOS.
 * removeHandler first so reloads / double-require never leave a missing channel.
 *
 * IMPORTANT: When Finder file paths are on the pasteboard, return null so a
 * Quick Look thumbnail PNG does not replace the real .ttf / .pdf / etc.
 */
function readOsClipboardImagePayload() {
  // Prefer the standard bitmap read first.
  let image = clipboard.readImage();

  // macOS sometimes exposes PNG/TIFF bytes without populating readImage().
  if (!image || image.isEmpty()) {
    try {
      const png = clipboard.readBuffer("public.png");
      if (png && png.length > 0) image = nativeImage.createFromBuffer(png);
    } catch {
      // ignore format probe failures
    }
  }
  if (!image || image.isEmpty()) {
    try {
      const tiff = clipboard.readBuffer("public.tiff");
      if (tiff && tiff.length > 0) image = nativeImage.createFromBuffer(tiff);
    } catch {
      // ignore
    }
  }
  if (!image || image.isEmpty()) return null;

  // Prefer PNG for lossless previews; fall back to JPEG if PNG is empty.
  let buffer = image.toPNG();
  let mime = "image/png";
  let extension = "png";
  if (!buffer || buffer.length === 0) {
    buffer = image.toJPEG(92);
    mime = "image/jpeg";
    extension = "jpg";
  }
  if (!buffer || buffer.length === 0) return null;

  const size = image.getSize();
  return {
    mime,
    extension,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
    // Base64 is fine for clipboard images; attachments are capped in the UI.
    dataBase64: buffer.toString("base64"),
    byteLength: buffer.length,
  };
}

try {
  ipcMain.removeHandler("coloride:clipboard:readText");
} catch {
  // ignore — channel may not exist yet
}
/** Plain text from the OS pasteboard (reliable for terminal Cmd/Ctrl+V). */
ipcMain.handle("coloride:clipboard:readText", async () => {
  try {
    return clipboard.readText() || "";
  } catch (error) {
    console.error("[coloride] clipboard:readText failed", error);
    return "";
  }
});

try {
  ipcMain.removeHandler("coloride:clipboard:readImage");
} catch {
  // ignore — channel may not exist yet
}
ipcMain.handle("coloride:clipboard:readImage", async () => {
  try {
    // Finder copy of a real file → ignore thumbnail image.
    if (readOsClipboardFilePaths().length > 0) return null;
    return readOsClipboardImagePayload();
  } catch (error) {
    console.error("[coloride] clipboard:readImage failed", error);
    return null;
  }
});

try {
  ipcMain.removeHandler("coloride:clipboard:readFiles");
} catch {
  // ignore
}
ipcMain.handle("coloride:clipboard:readFiles", async () => {
  try {
    return readOsClipboardFilesPayload();
  } catch (error) {
    console.error("[coloride] clipboard:readFiles failed", error);
    return [];
  }
});

const COLORIDE_CODE_REF_CLIP_FORMAT = "application/x-coloride-code-ref";
const COLORIDE_CODE_REF_HTML_MARKER = "coloride-code-ref:";

function escapeClipboardHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function codeRefClipboardHtml(text, codeRef) {
  const visible = escapeClipboardHtml(text).replaceAll("\n", "<br>");
  const encoded = Buffer.from(codeRef, "utf8").toString("base64");
  return `<div>${visible}</div><!--${COLORIDE_CODE_REF_HTML_MARKER}${encoded}-->`;
}

function codeRefFromClipboardHtml(html) {
  if (typeof html !== "string" || !html) return null;
  const match = html.match(/<!--coloride-code-ref:([A-Za-z0-9+/=]+)-->/);
  if (!match) return null;
  try {
    const value = Buffer.from(match[1], "base64").toString("utf8");
    return value.trim() ? value : null;
  } catch {
    return null;
  }
}

try {
  ipcMain.removeHandler("coloride:clipboard:writeCodeRef");
} catch {
  // ignore
}
/** Write plain text + custom Coloride code-ref format (editor/terminal → agent chips). */
ipcMain.handle("coloride:clipboard:writeCodeRef", async (_event, payload) => {
  try {
    const text = typeof payload?.text === "string" ? payload.text : "";
    const codeRef = typeof payload?.codeRef === "string" ? payload.codeRef : "";
    if (!text) return false;
    // A second writeBuffer call replaces the plain-text representation on
    // some platforms. Store both representations atomically instead: normal
    // apps receive text, while Coloride recovers its metadata from HTML.
    if (codeRef) {
      clipboard.write({ text, html: codeRefClipboardHtml(text, codeRef) });
    } else {
      clipboard.writeText(text);
    }
    return true;
  } catch (error) {
    console.error("[coloride] clipboard:writeCodeRef failed", error);
    return false;
  }
});

try {
  ipcMain.removeHandler("coloride:clipboard:readCodeRef");
} catch {
  // ignore
}
ipcMain.handle("coloride:clipboard:readCodeRef", async () => {
  // Keep compatibility with code references copied by older builds or by a
  // browser copy event that was able to expose the custom MIME directly.
  try {
    const buf = clipboard.readBuffer(COLORIDE_CODE_REF_CLIP_FORMAT);
    if (buf?.length) {
      const raw = buf.toString("utf8");
      if (raw.trim()) return raw;
    }
  } catch {
    // The custom format may not exist; continue with the atomic HTML carrier.
  }
  try {
    return codeRefFromClipboardHtml(clipboard.readHTML());
  } catch {
    return null;
  }
});

ipcMain.handle("coloride:saveFile", async (_event, suggestedName) => {
  const win = mainWindow || BrowserWindow.getFocusedWindow();
  const name = typeof suggestedName === "string" && suggestedName.trim()
    ? path.basename(suggestedName.trim())
    : "Untitled.txt";
  const result = await dialog.showSaveDialog(win, {
    title: "Save File",
    defaultPath: name,
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  return result.canceled ? null : result.filePath ?? null;
});

ipcMain.handle("coloride:selectFile", async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Select SSH Private Key",
    properties: ["openFile"],
    filters: [
      { name: "All Files", extensions: ["*"] },
      { name: "SSH Keys", extensions: ["pem", "key", "pub", "ppk"] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

/**
 * Floating always-on-top popup window (real BrowserWindow).
 * HTML portals cannot paint above WebContentsView; this can.
 * Returns the chosen item id, or null if dismissed.
 */
ipcMain.handle("coloride:popupMenu", async (event, payload) => {
  const { screen } = require("electron");
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map((item) => ({
      id: String(item?.id ?? "").trim(),
      label: String(item?.label ?? "").trim(),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => item.id && item.label);
  if (!items.length) return null;

  const parent = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
  if (!parent || parent.isDestroyed()) return null;

  const itemH = 28;
  const padY = 4;
  const width = Math.max(160, Math.round(Number(payload?.width) || 160));
  const height = padY * 2 + items.length * itemH + 2;
  const content = parent.getContentBounds();
  const dipX = Number(payload?.x);
  const dipY = Number(payload?.y);
  const hasPoint = Number.isFinite(dipX) && Number.isFinite(dipY);
  // Renderer getBoundingClientRect is content-relative DIP.
  let screenX = Math.round(content.x + (hasPoint ? dipX : 12));
  let screenY = Math.round(content.y + (hasPoint ? dipY : 48));
  const area = screen.getDisplayMatching(content).workArea;
  if (screenX + width > area.x + area.width - 4) {
    screenX = Math.max(area.x + 4, area.x + area.width - width - 4);
  }
  if (screenY + height > area.y + area.height - 4) {
    screenY = Math.max(area.y + 4, screenY - height - 28);
  }
  if (screenX < area.x + 4) screenX = area.x + 4;
  if (screenY < area.y + 4) screenY = area.y + 4;

  const buttonsHtml = items
    .map((item) => {
      const disabled = item.enabled ? "" : " disabled";
      const safeLabel = String(item.label)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const safeId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "");
      return `<button type="button" data-id="${safeId}"${disabled}><span>${safeLabel}</span></button>`;
    })
    .join("");

  const html =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "html,body{width:100%;height:100%;background:transparent;overflow:hidden;" +
    "font:12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color-scheme:dark;-webkit-user-select:none}" +
    ".menu{margin:0;padding:4px;width:100%;height:100%;border-radius:12px;" +
    "background:#272727;box-shadow:0 12px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35);" +
    "display:flex;flex-direction:column}" +
    "button{appearance:none;border:0;background:transparent;color:#d4d4d7;" +
    "height:28px;padding:0 10px;border-radius:8px;text-align:left;cursor:default;" +
    "display:flex;align-items:center;width:100%;font:inherit}" +
    "button:hover:not(:disabled),button:focus-visible:not(:disabled){background:rgba(255,255,255,.06);color:#fff;outline:none}" +
    "button:disabled{opacity:.4}" +
    "button span{pointer-events:none}" +
    "</style></head><body><div class=\"menu\" role=\"menu\">" +
    buttonsHtml +
    "</div></body></html>";

  const popup = new BrowserWindow({
    parent,
    modal: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    width,
    height,
    x: screenX,
    y: screenY,
    backgroundColor: "#00000000",
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: allowDevTools(),
    },
  });

  // Stay above the main window + native WebContentsView embeds.
  try {
    popup.setAlwaysOnTop(true, "pop-up-menu");
  } catch {
    popup.setAlwaysOnTop(true);
  }

  let settled = false;
  const finish = (value) => {
    if (settled) return value;
    settled = true;
    try {
      if (!popup.isDestroyed()) popup.close();
    } catch {
      // ignore
    }
    return value || null;
  };

  try {
    await popup.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    if (popup.isDestroyed()) return null;

    // Install pick handlers BEFORE show so the first focus/blur tick cannot race.
    await popup.webContents.executeJavaScript(
      `(() => {
        let done = false;
        window.__menuPick = new Promise((resolve) => {
          window.__resolveMenuPick = (v) => {
            if (done) return;
            done = true;
            resolve(v || "");
          };
        });
        document.querySelectorAll("button[data-id]").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.__resolveMenuPick(btn.getAttribute("data-id") || "");
          });
        });
        window.addEventListener("keydown", (e) => {
          if (e.key === "Escape") window.__resolveMenuPick("");
        });
        true;
      })()`,
      true,
    );

    popup.show();
    popup.focus();

    // Outside click: dismiss only after the popup has been up briefly.
    const blurTimer = setTimeout(() => {
      if (popup.isDestroyed() || settled) return;
      const onBlur = () => {
        try {
          void popup.webContents.executeJavaScript(
            `window.__resolveMenuPick && window.__resolveMenuPick("")`,
            true,
          );
        } catch {
          // ignore
        }
      };
      popup.on("blur", onBlur);
    }, 180);

    const chosen = await popup.webContents.executeJavaScript(
      `window.__menuPick`,
      true,
    );
    clearTimeout(blurTimer);

    return finish(typeof chosen === "string" && chosen ? chosen : null);
  } catch {
    return finish(null);
  }
});

function getMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return BrowserWindow.getFocusedWindow();
}

// Idle embed surface: about:blank paints white; use a dark data document instead.
const COLORIDE_IDLE_MARK_PATH =
  "M423.363 189.706C426.959 185.783 423.709 183.236 419.942 186.994C419.065 187.87 418.202 188.732 417.331 189.452C409.88 195.611 402.164 201.32 393.883 206.337C372.695 219.185 348.463 226.681 323.942 229.576C248.961 238.422 174.384 190.098 150.186 119.043C144.881 103.45 142.09 87.9953 140.856 71.5953C140.187 62.634 140.014 53.5113 146.276 46.3723C153.081 38.6221 171.42 31.3216 181.051 26.9621C215.744 11.254 254.878 1.56614 293.009 0.72422C309.017 0.378226 337.932 -3.85443 343.999 16.3285C347.875 29.2572 339.19 40.3059 332.915 50.8472C325.153 63.9027 317.979 77.3272 310.194 90.3596C304.658 99.6323 297.587 109.389 294.831 119.942C289.537 140.206 300.644 163.964 320.989 170.838C325.695 172.441 330.724 173.548 335.683 173.571C365.314 173.698 374.725 148.798 387.332 127.127C397.227 110.104 407.123 93.0699 416.996 76.024C425.993 60.4773 436.062 32.3596 459.613 42.6817C468.264 46.4646 476.453 53.0961 484.03 58.6666C510.581 78.2037 533.625 101.42 553.002 128.096C562.194 140.748 576.923 158.428 564.213 173.721C557.523 181.771 539.646 189.452 530.188 194.988C513.176 204.941 496.002 214.617 479.048 224.663C471.574 229.092 463.685 232.955 456.395 237.695C437.33 250.093 430.052 276.343 442.544 296.134C453.178 312.972 473.581 320.134 492.531 314.264C500.835 311.692 508.447 306.237 515.886 301.831C529.208 293.954 542.76 286.388 556.162 278.626C571.075 269.988 591.34 254.418 605.192 274.221C611.836 283.712 610.059 309.005 609.437 320.572C607.349 359.992 598.064 400.197 580.51 435.684C575.354 446.11 570.383 461.968 559.08 467.204C551.526 470.71 543.221 469.511 535.217 468.957C518.839 467.816 503.015 464.506 487.652 458.705C410.906 429.722 366.928 350.443 382.557 269.85C386.986 247.014 396.916 224.49 410.537 205.656C414.551 200.12 418.749 194.757 423.363 189.706ZM186.944 420.38C183.427 424.228 186.436 426.863 190.156 423.21C190.881 422.498 191.609 421.792 192.365 421.164C198.928 415.721 205.641 410.473 212.918 405.998C233.587 393.323 256.297 384.8 280.333 381.317C355.706 370.418 432.821 415.709 458.829 487.549C464.954 504.456 468.321 521.422 469.463 539.356C470.017 548.167 470.121 556.655 464.112 563.714C457.595 571.395 438.795 578.949 429.337 583.182C394.229 598.947 355.718 608.22 317.229 609.454C301.013 609.984 272.306 613.998 266.17 593.746C262.26 580.84 271.118 569.688 277.369 559.181C286.284 544.2 294.808 528.976 303.493 513.867C308.487 505.16 314.634 496.51 316.203 486.372C319.236 466.616 307.864 445.153 288.234 439.029C283.528 437.564 278.349 436.388 273.401 436.515C244.302 437.264 235.617 461.807 222.987 482.959C212.907 499.855 203.149 516.993 193.369 534.085C184.591 549.447 173.715 578.407 150.429 567.473C142.078 563.552 134.131 557.428 126.727 551.961C100.165 532.378 77.1548 509.346 57.6743 482.693C48.2397 469.776 33.1997 451.992 46.0713 436.33C51.8959 429.26 71.4571 420.022 80.142 415.075C103.382 401.846 126.277 388.041 149.575 374.916C171.305 362.68 181.431 337.388 168.029 314.644C157.753 297.218 136.807 290.252 117.753 295.88C109.426 298.348 101.895 303.999 94.4323 308.29C80.3035 316.432 66.2784 324.828 51.9997 332.717C37.225 340.894 18.6441 355.691 4.90745 335.877C-1.55144 326.581 0.224754 301.9 0.743772 290.586C2.54303 251.201 11.9315 210.616 29.3936 175.163C34.4107 164.956 40.4429 147.875 51.2961 142.928C58.1702 139.802 65.448 140.713 72.7143 141.082C90.0264 141.97 107.223 145.396 123.37 151.774C199.297 181.771 243.563 259.285 227.728 340.167C223.229 363.141 213.322 385.377 199.839 404.476C195.918 410.035 191.546 415.375 186.944 420.38Z";
const NEW_TAB_TITLE = "New tab";
const DARK_BLANK_HTML =
  "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + NEW_TAB_TITLE + "</title><style>" +
  "html,body{margin:0;height:100%;background:#1e1e1e;color-scheme:dark}" +
  ".mark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}" +
  ".mark svg{width:148px;height:148px;opacity:.16;color:#f5f4f0}" +
  "</style></head><body><div class=\"mark\" aria-hidden=\"true\">" +
  "<svg viewBox=\"0 0 611 611\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">" +
  "<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\" d=\"" +
  COLORIDE_IDLE_MARK_PATH +
  "\"/></svg></div></body></html>";
const DARK_BLANK_URL =
  "data:text/html;charset=utf-8," + encodeURIComponent(DARK_BLANK_HTML);

function isBlankBrowserUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (lower === "about:blank" || lower === "about:blank/") return true;
  // Our idle dark document (exact or re-encoded by Chromium).
  if (raw === DARK_BLANK_URL) return true;
  if (!lower.startsWith("data:text/html")) return false;
  // Match both plain and percent-encoded CSS background.
  return (
    lower.includes("background:#1e1e1e") ||
    lower.includes("background%3a%231e1e1e") ||
    lower.includes("background%3a%20%231e1e1e")
  );
}

function blankBrowserLoadUrl() {
  return DARK_BLANK_URL;
}

function isSafeBrowserUrl(value) {
  // Empty / dark blank is the idle embedded surface (no real page loaded yet).
  if (isBlankBrowserUrl(value)) return true;
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return true;
    // Allow our dark idle data document only.
    if (parsed.protocol === "data:" && isBlankBrowserUrl(value)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Rewrite localhost / ::1 → 127.0.0.1 so Chromium does not prefer IPv6
 * (often broken through SOCKS). Force http on loopback — local dev servers
 * of any stack rarely use TLS. Intent: any http://localhost:PORT on the VPS.
 */
function rewriteLoopbackUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || isBlankBrowserUrl(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === "localhost" || host === "[::1]" || host === "::1" || host === "127.0.0.1";
    if (!isLoopback) return raw;
    if (host !== "127.0.0.1") {
      parsed.hostname = "127.0.0.1";
    }
    if (parsed.protocol === "https:") {
      parsed.protocol = "http:";
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function normalizeEmbedBounds(bounds) {
  const x = Math.max(0, Math.round(Number(bounds?.x) || 0));
  const y = Math.max(0, Math.round(Number(bounds?.y) || 0));
  const width = Math.max(1, Math.round(Number(bounds?.width) || 1));
  const height = Math.max(1, Math.round(Number(bounds?.height) || 1));
  return { x, y, width, height };
}

async function applySocksProxy(socksPort) {
  const browserSession = session.fromPartition(BROWSER_PARTITION);
  if (!socksPort || !Number.isFinite(socksPort) || socksPort <= 0) {
    await browserSession.setProxy({ mode: "direct" });
    return { ok: false, reason: "no-socks" };
  }
  // Route ALL traffic for the embedded Chromium through the VPS SSH SOCKS hop.
  // Product rule: localhost / 127.0.0.1 in this browser = VPS loopback, not the Mac.
  // Do NOT set proxyBypassRules to "<local>" — that would hit the Mac loopback.
  // "<-loopback>" removes Chromium's implicit bypass so 127.0.0.1 goes via SOCKS.
  // (Also set globally via --proxy-bypass-list=<-loopback> before ready.)
  // SOCKS5 dynamic forward resolves 127.0.0.1 on the remote SSH host (VPS).
  await browserSession.setProxy({
    proxyRules: `socks5://127.0.0.1:${socksPort}`,
    proxyBypassRules: "<-loopback>"
  });
  // Drop sticky sockets that may still be direct from a previous session/proxy.
  try {
    if (typeof browserSession.closeAllConnections === "function") {
      browserSession.closeAllConnections();
    }
  } catch {
    // older Electron — ignore
  }
  return { ok: true, socksPort };
}

// Tiny helper so destroy paths stay quiet if the view is already gone.
function suppress(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function emitBrowserEmbedEvent(tabId, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("coloride:browserEmbed:event", { tabId, ...payload });
}

function isEmbedPoppedOut(entry) {
  return Boolean(entry?.hostWin && !entry.hostWin.isDestroyed());
}

function navigationHistory(webContents) {
  return webContents.navigationHistory || webContents;
}

/** URL shown in the pop-out address bar (hide blank/idle documents). */
function displayBrowserUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/^about:blank\/?$/i.test(trimmed)) return "";
  if (
    /^data:text\/html/i.test(trimmed) &&
    (/background:\s*#1e1e1e/i.test(trimmed) || /background%3a(%20)?%231e1e1e/i.test(trimmed))
  ) {
    return "";
  }
  return trimmed;
}

/**
 * Normalize address-bar input in the pop-out chrome (same rules as BrowserPane).
 */
function normalizePopoutNavigateUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  let withScheme = trimmed;
  if (!/^https?:\/\//i.test(withScheme)) {
    if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(withScheme)) {
      withScheme = `http://${withScheme}`;
    } else {
      withScheme = `https://${withScheme}`;
    }
  }
  try {
    const parsed = new URL(withScheme);
    const host = parsed.hostname.toLowerCase();
    if (
      (host === "localhost" || host === "127.0.0.1" || host === "::1") &&
      parsed.protocol === "https:"
    ) {
      parsed.protocol = "http:";
      return parsed.toString();
    }
  } catch {
    // keep withScheme
  }
  return withScheme;
}

function looksLikeDataUrlTitle(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw.startsWith("data:") || raw.startsWith("about:blank");
}

function idleBrowserTabTitle(rawTitle, rawUrl) {
  const title = String(rawTitle || "").trim();
  if (isBlankBrowserUrl(rawUrl) || looksLikeDataUrlTitle(title) || looksLikeDataUrlTitle(rawUrl)) {
    return NEW_TAB_TITLE;
  }
  return title || NEW_TAB_TITLE;
}

function getBrowserEmbedNavState(tabId) {
  const entry = browserEmbeds.get(tabId);
  if (!entry || entry.view.webContents.isDestroyed()) {
    return {
      tabId,
      url: "",
      title: NEW_TAB_TITLE,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
  }
  const wc = entry.view.webContents;
  const nav = navigationHistory(wc);
  const rawUrl = suppress(() => wc.getURL()) || entry.lastUrl || "";
  const rawTitle = suppress(() => wc.getTitle()) || "";
  return {
    tabId,
    url: displayBrowserUrl(rawUrl),
    title: idleBrowserTabTitle(rawTitle, rawUrl),
    loading: Boolean(suppress(() => wc.isLoading())),
    canGoBack: Boolean(suppress(() => nav.canGoBack && nav.canGoBack())),
    canGoForward: Boolean(suppress(() => nav.canGoForward && nav.canGoForward())),
  };
}

function listPopoutTabIds(win) {
  if (!win || win.isDestroyed()) return [];
  const ids = [];
  for (const [id, entry] of browserEmbeds) {
    if (entry.hostWin === win) ids.push(id);
  }
  return ids;
}

function getSharedPopoutWindow() {
  const seen = new Set();
  for (const win of browserPopouts.values()) {
    if (!win || win.isDestroyed() || seen.has(win)) continue;
    seen.add(win);
    return win;
  }
  return null;
}

function getPopoutActiveTabId(win) {
  if (!win || win.isDestroyed()) return "";
  const current = String(win.__colorideActiveTabId || "").trim();
  const ids = listPopoutTabIds(win);
  if (current && ids.includes(current)) return current;
  return ids[0] || "";
}

function getPopoutWindowState(win, activeTabId) {
  const tabId = activeTabId || getPopoutActiveTabId(win);
  const nav = getBrowserEmbedNavState(tabId);
  const tabs = listPopoutTabIds(win).map((id) => {
    const item = getBrowserEmbedNavState(id);
    const title = idleBrowserTabTitle(item.title, item.url);
    return {
      tabId: id,
      title,
      url: item.url,
      loading: item.loading,
      active: id === tabId,
    };
  });
  return {
    ...nav,
    tabId,
    tabs,
    maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()),
    platform: process.platform,
  };
}

function setPopoutActiveTab(win, tabId) {
  if (!win || win.isDestroyed()) return;
  win.__colorideActiveTabId = tabId;
  for (const [id, entry] of browserEmbeds) {
    if (entry.hostWin !== win) continue;
    if (id === tabId) {
      layoutPopoutEmbed(id);
      continue;
    }
    entry.wantVisible = false;
    suppress(() => entry.view.setVisible(false));
  }
  pushPopoutChromeState(tabId);
}

function pushPopoutChromeState(tabId) {
  const entry = browserEmbeds.get(tabId);
  const win = entry?.hostWin && !entry.hostWin.isDestroyed()
    ? entry.hostWin
    : getSharedPopoutWindow();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const activeId = getPopoutActiveTabId(win) || tabId;
  const state = getPopoutWindowState(win, activeId);
  suppress(() => win.webContents.send("coloride:browserPopout:state", state));
  if (state.title) {
    suppress(() => win.setTitle(state.title));
  }
}

function detachEmbedView(entry) {
  if (!entry) return;
  const hosts = [];
  if (entry.hostWin && !entry.hostWin.isDestroyed()) hosts.push(entry.hostWin);
  const main = getMainWindow();
  if (main && !main.isDestroyed() && main !== entry.hostWin) hosts.push(main);
  for (const host of hosts) {
    suppress(() => host.contentView.removeChildView(entry.view));
  }
  entry.visible = false;
  suppress(() => entry.view.setVisible(false));
}

function layoutPopoutEmbed(tabId) {
  const entry = browserEmbeds.get(tabId);
  if (!entry || !isEmbedPoppedOut(entry)) return false;
  const win = entry.hostWin;
  const [width, height] = win.getContentSize();
  // Leave room for the HTML chrome (back / forward / reload / URL / dock).
  const chromeH = BROWSER_POPOUT_CHROME_HEIGHT;
  const rect = normalizeEmbedBounds({
    x: 0,
    y: chromeH,
    width,
    height: Math.max(1, height - chromeH),
  });
  if (rect.width < 2 || rect.height < 2) return false;
  if (!entry.visible) {
    suppress(() => win.contentView.addChildView(entry.view));
    keepStartupSplashOnTop(win);
    entry.visible = true;
  }
  entry.view.setBounds(rect);
  suppress(() => {
    if (typeof entry.view.setBorderRadius === "function") {
      entry.view.setBorderRadius(0);
    }
  });
  entry.view.setVisible(true);
  entry.wantVisible = true;
  return true;
}

function closeBrowserPopoutWindow(tabId, { destroyWindow = true } = {}) {
  const entry = browserEmbeds.get(tabId);
  const win = browserPopouts.get(tabId) || entry?.hostWin || null;
  browserPopouts.delete(tabId);
  if (entry) entry.hostWin = null;
  if (!win || win.isDestroyed()) return;
  const remaining = listPopoutTabIds(win);
  if (remaining.length > 0) {
    const next = remaining.includes(win.__colorideActiveTabId)
      ? win.__colorideActiveTabId
      : remaining[remaining.length - 1];
    setPopoutActiveTab(win, next);
    return;
  }
  // Avoid recursive closed → dock while we are tearing down.
  win.removeAllListeners("closed");
  win.removeAllListeners("resize");
  if (destroyWindow) {
    suppress(() => {
      if (!win.isDestroyed()) win.close();
    });
  }
}

function destroyBrowserEmbed(tabId) {
  const entry = browserEmbeds.get(tabId);
  if (!entry) {
    closeBrowserPopoutWindow(tabId);
    return;
  }
  browserEmbeds.delete(tabId);
  detachEmbedView(entry);
  closeBrowserPopoutWindow(tabId);
  suppress(() => {
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close({ waitForBeforeUnload: false });
    }
  });
}

function destroyAllBrowserEmbeds() {
  for (const tabId of [...browserEmbeds.keys()]) {
    destroyBrowserEmbed(tabId);
  }
  for (const tabId of [...browserPopouts.keys()]) {
    closeBrowserPopoutWindow(tabId);
  }
}

/**
 * Move embed into its own OS window (same Chromium session + VPS SOCKS).
 * Closing the window docks the browser back into Coloride.
 */
function attachEmbedToPopoutWindow(tabId, popout, entry) {
  entry.hostWin = popout;
  entry.wantVisible = true;
  browserPopouts.set(tabId, popout);
}

function popOutBrowserEmbed(tabId, options = {}) {
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");

  if (isEmbedPoppedOut(entry)) {
    const existing = entry.hostWin;
    if (existing && !existing.isDestroyed()) {
      setPopoutActiveTab(existing, tabId);
      existing.show();
      existing.focus();
    }
    return { ok: true, poppedOut: true, tabId };
  }

  detachEmbedView(entry);

  const titleRaw = String(options.title || options.url || "Browser").trim() || "Browser";
  const title = titleRaw.length > 80 ? `${titleRaw.slice(0, 77)}…` : titleRaw;
  const shared = getSharedPopoutWindow();
  if (shared) {
    attachEmbedToPopoutWindow(tabId, shared, entry);
    setPopoutActiveTab(shared, tabId);
    shared.show();
    shared.focus();
    emitBrowserEmbedEvent(tabId, {
      type: "popout",
      poppedOut: true,
      url: suppress(() => entry.view.webContents.getURL()) || entry.lastUrl || "",
      title: suppress(() => entry.view.webContents.getTitle()) || title,
    });
    return { ok: true, poppedOut: true, tabId };
  }

  const main = getMainWindow();
  const mainBounds = main && !main.isDestroyed() ? main.getBounds() : { x: 120, y: 80, width: 1280, height: 820 };
  const width = Math.max(720, Math.min(1280, Math.round(mainBounds.width * 0.72)));
  const height = Math.max(520, Math.min(900, Math.round(mainBounds.height * 0.82)));
  const x = Math.round(mainBounds.x + Math.max(24, (mainBounds.width - width) / 2));
  const y = Math.round(mainBounds.y + Math.max(24, (mainBounds.height - height) / 2));

  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  const appIconPath = resolveAppIconPath();
  /** @type {import('electron').BrowserWindowConstructorOptions} */
  const popoutOptions = {
    width,
    height,
    x,
    y,
    minWidth: 480,
    minHeight: 360,
    title,
    backgroundColor: "#1e1e1e",
    show: false,
    autoHideMenuBar: true,
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: browserPopoutPreloadPath,
      additionalArguments: [`--coloride-popout-tab=${tabId}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: allowDevTools(),
    },
  };
  if (isMac) {
    popoutOptions.titleBarStyle = "hiddenInset";
    popoutOptions.trafficLightPosition = { x: 14, y: 10 };
  } else if (isWin) {
    popoutOptions.frame = false;
  } else {
    popoutOptions.frame = false;
  }

  const popout = new BrowserWindow(popoutOptions);

  browserPopouts.set(tabId, popout);
  lockDownDevTools(popout.webContents);
  wireWindowMaximizeEvents(popout);
  entry.hostWin = popout;
  entry.wantVisible = true;
  popout.__colorideActiveTabId = tabId;

  void popout.loadFile(browserPopoutHtmlPath).catch((error) => {
    console.error("[coloride] failed to load browser popout chrome", error);
  });

  const onResize = () => {
    const active = getPopoutActiveTabId(popout);
    if (active) layoutPopoutEmbed(active);
  };
  popout.on("resize", onResize);

  popout.webContents.on("did-finish-load", () => {
    if (popout.isDestroyed()) return;
    const active = getPopoutActiveTabId(popout);
    if (active) {
      layoutPopoutEmbed(active);
      pushPopoutChromeState(active);
    }
  });

  popout.once("ready-to-show", () => {
    if (popout.isDestroyed()) return;
    const active = getPopoutActiveTabId(popout);
    if (active) {
      layoutPopoutEmbed(active);
      pushPopoutChromeState(active);
    }
    popout.show();
    popout.focus();
  });

  popout.on("closed", () => {
    const hosted = [...browserEmbeds.entries()].filter(([, item]) => item.hostWin === popout);
    for (const [id, current] of hosted) {
      browserPopouts.delete(id);
      current.hostWin = null;
      detachEmbedView(current);
      current.wantVisible = false;
      current.visible = false;
      emitBrowserEmbedEvent(id, { type: "dock", poppedOut: false });
    }
  });

  layoutPopoutEmbed(tabId);
  pushPopoutChromeState(tabId);
  if (!popout.isVisible()) {
    popout.show();
    popout.focus();
  }

  emitBrowserEmbedEvent(tabId, {
    type: "popout",
    poppedOut: true,
    url: suppress(() => entry.view.webContents.getURL()) || entry.lastUrl || "",
    title: suppress(() => entry.view.webContents.getTitle()) || title,
  });

  return { ok: true, poppedOut: true, tabId };
}

/** Bring a popped-out embed back into the main Coloride window. */
function dockBrowserEmbed(tabId) {
  const entry = browserEmbeds.get(tabId);
  if (!entry) return { ok: false, poppedOut: false };

  if (!isEmbedPoppedOut(entry)) {
    return { ok: true, poppedOut: false, tabId };
  }

  detachEmbedView(entry);
  closeBrowserPopoutWindow(tabId);
  entry.hostWin = null;
  // Stay hidden until the main BrowserPane pushes bounds again.
  entry.wantVisible = false;
  entry.visible = false;

  emitBrowserEmbedEvent(tabId, { type: "dock", poppedOut: false });
  return { ok: true, poppedOut: false, tabId };
}

/**
 * Dark thin scrollbars for embedded Chromium pages (match Coloride editor chrome).
 * Injected into every loaded document — color-scheme covers native overlay bars;
 * webkit rules cover classic scrollbars on Linux/Windows and forced dark pages.
 */
const BROWSER_EMBED_DARK_SCROLLBAR_CSS = `
:root, html {
  color-scheme: dark;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  width: 10px;
  height: 10px;
  background: transparent;
}
html::-webkit-scrollbar-track,
body::-webkit-scrollbar-track,
html::-webkit-scrollbar-corner,
body::-webkit-scrollbar-corner {
  background: transparent;
}
html::-webkit-scrollbar-thumb,
body::-webkit-scrollbar-thumb {
  background: #555555;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
html::-webkit-scrollbar-thumb:hover,
body::-webkit-scrollbar-thumb:hover {
  background: #6a6a6a;
  border: 2px solid transparent;
  background-clip: padding-box;
}
/* Nested scrollers (common on dashboards / docs) */
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: #555555;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
*::-webkit-scrollbar-thumb:hover {
  background: #6a6a6a;
  border: 2px solid transparent;
  background-clip: padding-box;
}
`.trim();

function injectBrowserEmbedDarkScrollbars(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  void webContents.insertCSS(BROWSER_EMBED_DARK_SCROLLBAR_CSS).catch(() => undefined);
}

function createBrowserEmbed(tabId) {
  const existing = browserEmbeds.get(tabId);
  if (existing) return existing;

  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Real browsing session — no Node bridge inside the page.
      javascript: true,
      devTools: allowDevTools(),
    }
  });
  lockDownDevTools(view.webContents);
  // Match app dark editor surface while blank / before paint.
  suppress(() => view.setBackgroundColor("#1e1e1e"));
  suppress(() => {
    if (typeof view.setBorderRadius === "function") {
      view.setBorderRadius(0);
    }
  });

  // Keep popups inside the embed or open externally instead of spawning OS windows.
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeBrowserUrl(url)) {
      // Navigate the same embed so multi-window sites stay SBS.
      void view.webContents.loadURL(rewriteLoopbackUrl(url));
    }
    return { action: "deny" };
  });

  // Any in-page / redirect navigation to localhost → 127.0.0.1 for SOCKS reliability.
  view.webContents.on("will-navigate", (event, url) => {
    const rewritten = rewriteLoopbackUrl(url);
    if (rewritten && rewritten !== url && isSafeBrowserUrl(rewritten)) {
      event.preventDefault();
      void view.webContents.loadURL(rewritten);
    }
  });

  const entry = {
    view,
    socksPort: null,
    visible: false,
    /** When false, open/setBounds must not resurface the overlay (tab switch race). */
    wantVisible: false,
    lastUrl: "",
    /** When set, embed lives in a separate BrowserWindow instead of the main app. */
    hostWin: null,
  };
  browserEmbeds.set(tabId, entry);

  const emit = (payload) => emitBrowserEmbedEvent(tabId, payload);

  // Dark scrollbars as early as possible (before first paint when possible).
  view.webContents.on("dom-ready", () => {
    injectBrowserEmbedDarkScrollbars(view.webContents);
  });
  view.webContents.on("did-finish-load", () => {
    injectBrowserEmbedDarkScrollbars(view.webContents);
  });
  // SPA navigations / soft-document updates that skip a full load.
  view.webContents.on("did-frame-navigate", (_event, _url, _httpCode, _status, isMainFrame) => {
    if (!isMainFrame) return;
    injectBrowserEmbedDarkScrollbars(view.webContents);
  });

  view.webContents.on("did-start-loading", () => {
    emit({ type: "loading", loading: true });
    pushPopoutChromeState(tabId);
  });
  view.webContents.on("did-stop-loading", () => {
    emit({
      type: "loading",
      loading: false,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle()
    });
    pushPopoutChromeState(tabId);
    injectBrowserEmbedDarkScrollbars(view.webContents);
  });
  view.webContents.on("page-title-updated", (_event, title) => {
    emit({
      type: "title",
      title,
      url: view.webContents.getURL()
    });
    pushPopoutChromeState(tabId);
  });
  view.webContents.on("did-navigate", (_event, url) => {
    entry.lastUrl = url;
    emit({
      type: "navigate",
      url,
      title: view.webContents.getTitle()
    });
    pushPopoutChromeState(tabId);
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    entry.lastUrl = url;
    emit({
      type: "navigate",
      url,
      title: view.webContents.getTitle()
    });
    pushPopoutChromeState(tabId);
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = aborted
    emit({
      type: "error",
      message: errorDescription || `Load failed (${errorCode})`,
      url: validatedURL
    });
    pushPopoutChromeState(tabId);
  });
  view.webContents.on("destroyed", () => {
    browserEmbeds.delete(tabId);
    closeBrowserPopoutWindow(tabId);
  });

  return entry;
}

function showBrowserEmbed(tabId, bounds) {
  const entry = browserEmbeds.get(tabId);
  if (!entry) return false;
  // Popped-out embeds fill their own window — ignore main-window DIP bounds.
  if (isEmbedPoppedOut(entry)) {
    return layoutPopoutEmbed(tabId);
  }
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return false;
  // Honour hide() that raced ahead of an in-flight open/setBounds.
  if (entry.wantVisible === false) return false;

  const rect = normalizeEmbedBounds(bounds);
  // Ignore unsettled 1×1 placeholders from first paint.
  if (rect.width < 2 || rect.height < 2) return false;

  if (!entry.visible) {
    win.contentView.addChildView(entry.view);
    keepStartupSplashOnTop(win);
    entry.visible = true;
  }
  // Flush to HTML browser-surface bounds.
  entry.view.setBounds(rect);
  suppress(() => {
    if (typeof entry.view.setBorderRadius === "function") {
      entry.view.setBorderRadius(0);
    }
  });
  entry.view.setVisible(true);
  return true;
}

function hideBrowserEmbed(tabId) {
  const entry = browserEmbeds.get(tabId);
  if (!entry) return false;
  // Never hide a popped-out browser when the main UI suspends overlays
  // (tab switch / menus) — the separate window should keep painting.
  if (isEmbedPoppedOut(entry)) {
    return false;
  }
  const win = getMainWindow();
  entry.wantVisible = false;
  entry.visible = false;
  suppress(() => entry.view.setVisible(false));
  suppress(() => {
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(entry.view);
    }
  });
  return true;
}

function hideAllBrowserEmbeds() {
  for (const tabId of [...browserEmbeds.keys()]) {
    hideBrowserEmbed(tabId);
  }
}

ipcMain.handle("coloride:browserEmbed:open", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const rawUrl = String(payload?.url ?? "").trim();
  const idle = isBlankBrowserUrl(rawUrl);
  // Idle: keep native dark surface (no about:blank white flash, no data: URL quirks).
  // Real pages: http(s) only. localhost → 127.0.0.1 for reliable VPS SOCKS.
  const url = idle ? "" : rewriteLoopbackUrl(rawUrl);
  const socksPort = payload?.socksPort != null ? Number(payload.socksPort) : null;
  const bounds = payload?.bounds || { x: 0, y: 0, width: 1, height: 1 };

  if (!tabId) throw new Error("tabId is required");
  if (!idle && !isSafeBrowserUrl(url)) {
    throw new Error("Only http(s) URLs can be opened in the embedded browser.");
  }

  const proxy = await applySocksProxy(socksPort);
  const entry = createBrowserEmbed(tabId);
  entry.socksPort = proxy.ok ? proxy.socksPort : null;
  const poppedOut = isEmbedPoppedOut(entry);
  // Mark desired visibility before any await so a concurrent hide wins the race.
  // Popped-out embeds always stay visible in their own window.
  if (poppedOut) {
    entry.wantVisible = true;
  } else {
    entry.wantVisible = true;
  }

  if (poppedOut) {
    layoutPopoutEmbed(tabId);
  } else {
    showBrowserEmbed(tabId, bounds);
  }
  suppress(() => entry.view.setBackgroundColor("#1e1e1e"));

  if (!idle && entry.lastUrl !== url) {
    entry.lastUrl = url;
    await entry.view.webContents.loadURL(url);
  } else if (idle) {
    // Ensure we are not showing a previous page if this embed was reused.
    entry.lastUrl = "";
    const current = suppress(() => entry.view.webContents.getURL()) || "";
    if (current && !isBlankBrowserUrl(current)) {
      try {
        await entry.view.webContents.loadURL(blankBrowserLoadUrl());
      } catch {
        // Dark view background is enough if load fails.
      }
    }
  }

  // If hide() ran during loadURL, do not leave the overlay up (main window only).
  if (isEmbedPoppedOut(entry)) {
    layoutPopoutEmbed(tabId);
  } else if (entry.wantVisible) {
    showBrowserEmbed(tabId, bounds);
  } else {
    hideBrowserEmbed(tabId);
  }

  const loadedUrl = idle ? "" : (entry.view.webContents.getURL() || url);
  return {
    ok: true,
    tabId,
    // Never surface blank/idle into the React URL bar.
    url: isBlankBrowserUrl(loadedUrl) ? "" : loadedUrl,
    title: isBlankBrowserUrl(loadedUrl) ? "" : (entry.view.webContents.getTitle() || ""),
    socks: Boolean(proxy.ok),
    socksPort: entry.socksPort,
    poppedOut: isEmbedPoppedOut(entry),
  };
});

ipcMain.handle("coloride:browserEmbed:navigate", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const rawUrl = String(payload?.url ?? "").trim();
  const idle = isBlankBrowserUrl(rawUrl);
  const url = idle ? blankBrowserLoadUrl() : rewriteLoopbackUrl(rawUrl);
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  if (!idle && !isSafeBrowserUrl(url)) {
    throw new Error("Only http(s) URLs can be opened in the embedded browser.");
  }
  entry.lastUrl = idle ? "" : url;
  suppress(() => entry.view.setBackgroundColor("#1e1e1e"));
  try {
    await entry.view.webContents.loadURL(url);
  } catch (error) {
    if (!idle) throw error;
  }
  pushPopoutChromeState(tabId);
  return { ok: true, url: idle ? "" : url };
});

ipcMain.handle("coloride:browserEmbed:reload", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  entry.view.webContents.reload();
  pushPopoutChromeState(tabId);
  return { ok: true };
});

ipcMain.handle("coloride:browserEmbed:goBack", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  const nav = navigationHistory(entry.view.webContents);
  if (nav.canGoBack()) nav.goBack();
  pushPopoutChromeState(tabId);
  return { ok: true, canGoBack: nav.canGoBack() };
});

ipcMain.handle("coloride:browserEmbed:goForward", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  const nav = navigationHistory(entry.view.webContents);
  if (nav.canGoForward()) nav.goForward();
  pushPopoutChromeState(tabId);
  return { ok: true, canGoForward: nav.canGoForward() };
});

// ── Pop-out window chrome (back / forward / reload / URL / dock) ──────────
function popoutTabIdFromEvent(event, payload) {
  const fromPayload = String(payload?.tabId || "").trim();
  if (fromPayload) return fromPayload;
  const win = windowFromEvent(event);
  return win ? getPopoutActiveTabId(win) : "";
}

ipcMain.handle("coloride:browserPopout:getState", async (event, payload) => {
  const win = windowFromEvent(event);
  if (!win) {
    const tabId = String(payload?.tabId || "").trim();
    return getBrowserEmbedNavState(tabId);
  }
  return getPopoutWindowState(win, popoutTabIdFromEvent(event, payload));
});

ipcMain.handle("coloride:browserPopout:selectTab", async (event, payload) => {
  const win = windowFromEvent(event);
  const tabId = String(payload?.tabId || "").trim();
  if (!win || !tabId) return { ok: false };
  setPopoutActiveTab(win, tabId);
  return { ok: true, tabId };
});

ipcMain.handle("coloride:browserPopout:newTab", async (event) => {
  const win = windowFromEvent(event);
  if (!win) return { ok: false };
  const tabId = `coloride-popout-${Date.now().toString(36)}`;
  const created = createBrowserEmbed(tabId);
  attachEmbedToPopoutWindow(tabId, win, created);
  created.lastUrl = "";
  suppress(() => created.view.setBackgroundColor("#1e1e1e"));
  try {
    await created.view.webContents.loadURL(blankBrowserLoadUrl());
  } catch {
    // dark surface is enough
  }
  setPopoutActiveTab(win, tabId);
  emitBrowserEmbedEvent(tabId, { type: "popout", poppedOut: true, url: "", title: NEW_TAB_TITLE });
  return { ok: true, tabId };
});

ipcMain.handle("coloride:browserPopout:closeTab", async (event, payload) => {
  const win = windowFromEvent(event);
  const tabId = String(payload?.tabId || "").trim() || (win ? getPopoutActiveTabId(win) : "");
  if (!tabId) return { ok: false };
  const remaining = win ? listPopoutTabIds(win).filter((id) => id !== tabId) : [];
  if (remaining.length === 0 && win && !win.isDestroyed()) {
    win.close();
    return { ok: true, closedWindow: true };
  }
  destroyBrowserEmbed(tabId);
  return { ok: true, tabId };
});

ipcMain.handle("coloride:browserPopout:goBack", async (event, payload) => {
  const tabId = popoutTabIdFromEvent(event, payload);
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  const nav = navigationHistory(entry.view.webContents);
  if (nav.canGoBack()) nav.goBack();
  pushPopoutChromeState(tabId);
  return { ok: true, ...getBrowserEmbedNavState(tabId) };
});

ipcMain.handle("coloride:browserPopout:goForward", async (event, payload) => {
  const tabId = popoutTabIdFromEvent(event, payload);
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  const nav = navigationHistory(entry.view.webContents);
  if (nav.canGoForward()) nav.goForward();
  pushPopoutChromeState(tabId);
  return { ok: true, ...getBrowserEmbedNavState(tabId) };
});

ipcMain.handle("coloride:browserPopout:reload", async (event, payload) => {
  const tabId = popoutTabIdFromEvent(event, payload);
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  entry.view.webContents.reload();
  pushPopoutChromeState(tabId);
  return { ok: true };
});

ipcMain.handle("coloride:browserPopout:navigate", async (event, payload) => {
  const tabId = popoutTabIdFromEvent(event, payload);
  const entry = browserEmbeds.get(tabId);
  if (!entry) throw new Error("Browser embed not found");
  const raw = normalizePopoutNavigateUrl(payload?.url);
  if (!raw) return { ok: false, reason: "empty-url" };
  const idle = isBlankBrowserUrl(raw);
  const url = idle ? blankBrowserLoadUrl() : rewriteLoopbackUrl(raw);
  if (!idle && !isSafeBrowserUrl(url)) {
    throw new Error("Only http(s) URLs can be opened in the embedded browser.");
  }
  entry.lastUrl = idle ? "" : url;
  suppress(() => entry.view.setBackgroundColor("#1e1e1e"));
  try {
    await entry.view.webContents.loadURL(url);
  } catch (error) {
    if (!idle) throw error;
  }
  pushPopoutChromeState(tabId);
  // Keep the main app address bar in sync.
  emitBrowserEmbedEvent(tabId, {
    type: "navigate",
    url: idle ? "" : url,
    title: suppress(() => entry.view.webContents.getTitle()) || "",
  });
  return { ok: true, url: idle ? "" : url };
});

ipcMain.handle("coloride:browserPopout:dock", async (event, payload) => {
  const tabId = popoutTabIdFromEvent(event, payload);
  if (!tabId) throw new Error("tabId is required");
  return dockBrowserEmbed(tabId);
});

ipcMain.handle("coloride:browserEmbed:setBounds", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const entry = browserEmbeds.get(tabId);
  if (!entry) return { ok: false };
  if (payload?.visible === false) {
    hideBrowserEmbed(tabId);
    return { ok: true, visible: false };
  }
  entry.wantVisible = true;
  const shown = showBrowserEmbed(tabId, payload?.bounds || {});
  return { ok: true, visible: shown };
});

ipcMain.handle("coloride:browserEmbed:hide", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  if (tabId) {
    hideBrowserEmbed(tabId);
  } else {
    hideAllBrowserEmbeds();
  }
  return { ok: true };
});

ipcMain.handle("coloride:browserEmbed:hideAll", async () => {
  hideAllBrowserEmbeds();
  return { ok: true };
});

ipcMain.handle("coloride:browserEmbed:close", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  destroyBrowserEmbed(tabId);
  return { ok: true };
});

ipcMain.handle("coloride:browserEmbed:setSocks", async (_event, payload) => {
  const socksPort = payload?.socksPort != null ? Number(payload.socksPort) : null;
  return applySocksProxy(socksPort);
});

ipcMain.handle("coloride:browserEmbed:popOut", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  if (!tabId) throw new Error("tabId is required");
  // Ensure embed exists so pop-out works even before first paint finished.
  const entry = browserEmbeds.get(tabId) || createBrowserEmbed(tabId);
  if (payload?.url) {
    const rawUrl = String(payload.url || "").trim();
    if (!isBlankBrowserUrl(rawUrl) && isSafeBrowserUrl(rawUrl)) {
      const url = rewriteLoopbackUrl(rawUrl);
      if (entry.lastUrl !== url) {
        entry.lastUrl = url;
        try {
          await entry.view.webContents.loadURL(url);
        } catch {
          // still open the window
        }
      }
    }
  }
  return popOutBrowserEmbed(tabId, {
    title: payload?.title,
    url: payload?.url,
  });
});

ipcMain.handle("coloride:browserEmbed:dock", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  if (!tabId) throw new Error("tabId is required");
  return dockBrowserEmbed(tabId);
});

ipcMain.handle("coloride:browserEmbed:isPoppedOut", async (_event, payload) => {
  const tabId = String(payload?.tabId || "").trim();
  const entry = browserEmbeds.get(tabId);
  return { ok: true, poppedOut: Boolean(entry && isEmbedPoppedOut(entry)) };
});

app.whenReady().then(async () => {
  discardUnprotectedCloudRefreshToken();
  // Diagnose traffic-light metrics (macOS SDK / Electron build).
  try {
    const os = require("node:os");
    console.log("[Electron] runtime", {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
    });
  } catch {
    // ignore
  }

  // Dock / taskbar icon (dev + packaged). Must run after ready on macOS.
  applyAppIcon();

  // Quiet startup update check (packaged only) — stable channel by default.
  if (autoUpdate.isAutoUpdateSupported() && process.env.COLORIDE_SKIP_UPDATE_CHECK !== "1") {
    autoUpdate.scheduleStartupCheck("stable");
  }

  // Re-assert clipboard IPC after ready (covers hot-reload / partial main restarts).
  try {
    ipcMain.removeHandler("coloride:clipboard:readText");
  } catch {
    // ignore
  }
  ipcMain.handle("coloride:clipboard:readText", async () => {
    try {
      return clipboard.readText() || "";
    } catch (error) {
      console.error("[coloride] clipboard:readText failed", error);
      return "";
    }
  });
  try {
    ipcMain.removeHandler("coloride:clipboard:readImage");
  } catch {
    // ignore
  }
  ipcMain.handle("coloride:clipboard:readImage", async () => {
    try {
      return readOsClipboardImagePayload();
    } catch (error) {
      console.error("[coloride] clipboard:readImage failed", error);
      return null;
    }
  });

  configureMenu();
  try {
    await createWindow();
  } catch (error) {
    try {
      Sentry.captureException(error);
      await Sentry.flush(2000);
    } catch {
      // ignore telemetry failures
    }
    dialog.showErrorBox("Coloride failed to start", String(error.stack || error));
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Normal app quit is non-destructive: the detached authenticated sidecar keeps
// local PTYs and SSH/tmux transports available for the next Coloride launch.
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void gracefulQuit().finally(() => {
    app.exit(0);
  });
});

app.on("will-quit", () => {
  // Fallback if something quit without before-quit completing.
  if (!quitting) {
    destroyAllBrowserEmbeds();
    stopSidecar();
  }
});

app.on("window-all-closed", () => {
  destroyAllBrowserEmbeds();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
