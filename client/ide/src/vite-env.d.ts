/// <reference types="vite/client" />

type ColorideCloudConfig = { enabled: boolean; appBase: string; apiBase: string };
declare const __COLORIDE_CLOUD_CONFIG__: ColorideCloudConfig;

type ColorideRuntimeConfig = {
  host?: string;
  port: number;
  token: string;
};

type ColorideAppInfo = {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
};

type ColorideUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

type ColorideUpdateResult = {
  available: boolean;
  channel: "stable" | "beta";
  currentVersion: string;
  latestVersion: string;
  publishedAt?: string;
  notes?: string;
  downloadUrl?: string;
  hasChecksum: boolean;
  hasSignature: boolean;
  /** electron-updater lifecycle (packaged builds). */
  status?: ColorideUpdateStatus;
  /** 0–100 while downloading (not shown in UI; kept for diagnostics). */
  progress?: number;
  /** True when quitAndInstallUpdate can run. */
  canInstall?: boolean;
  /** False in dev / unpackaged builds. */
  autoUpdateEnabled?: boolean;
  /** Main process is about to quitAndInstall. */
  autoInstalling?: boolean;
  error?: string | null;
  checkedAt?: string | null;
};

type ColorideMenuAction =
  | "open-explorer"
  | "open-server"
  | "open-agents"
  | "open-settings"
  | "connect-server"
  | "open-file"
  | "open-folder"
  | "open-local-folder"
  | "open-ssh-workspace"
  | "new-file"
  | "new-folder"
  | "save-file"
  | "refresh-files"
  | "toggle-side-panel"
  | "toggle-terminal";

type ColorideBrowserEmbedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ColorideBrowserEmbedOpenResult = {
  ok: boolean;
  tabId: string;
  url: string;
  title: string;
  socks: boolean;
  socksPort: number | null;
  poppedOut?: boolean;
};

type ColorideBrowserEmbedEvent = {
  tabId: string;
  type: string;
  loading?: boolean;
  url?: string;
  title?: string;
  message?: string;
  poppedOut?: boolean;
};

type ColorideBrowserEmbedApi = {
  open: (payload: {
    tabId: string;
    url: string;
    socksPort?: number | null;
    bounds?: ColorideBrowserEmbedBounds;
  }) => Promise<ColorideBrowserEmbedOpenResult>;
  navigate: (payload: { tabId: string; url: string }) => Promise<{ ok: boolean; url: string }>;
  reload: (payload: { tabId: string }) => Promise<{ ok: boolean }>;
  goBack: (payload: { tabId: string }) => Promise<{ ok: boolean; canGoBack?: boolean }>;
  goForward: (payload: { tabId: string }) => Promise<{ ok: boolean; canGoForward?: boolean }>;
  setBounds: (payload: {
    tabId: string;
    bounds?: ColorideBrowserEmbedBounds;
    visible?: boolean;
  }) => Promise<{ ok: boolean; visible?: boolean }>;
  hide: (payload: { tabId: string }) => Promise<{ ok: boolean }>;
  hideAll: () => Promise<{ ok: boolean }>;
  close: (payload: { tabId: string }) => Promise<{ ok: boolean }>;
  setSocks: (payload: { socksPort?: number | null }) => Promise<{ ok: boolean; socksPort?: number; reason?: string }>;
  /** Separate OS window with the same SOCKS/VPS browser session. */
  popOut: (payload: {
    tabId: string;
    url?: string;
    title?: string;
  }) => Promise<{ ok: boolean; poppedOut: boolean; tabId: string }>;
  dock: (payload: { tabId: string }) => Promise<{ ok: boolean; poppedOut: boolean; tabId?: string }>;
  isPoppedOut: (payload: { tabId: string }) => Promise<{ ok: boolean; poppedOut: boolean }>;
  onEvent: (callback: (event: ColorideBrowserEmbedEvent) => void) => () => void;
};

interface Window {
  __FORGE__?: ColorideRuntimeConfig;
  __COLORIDE__?: ColorideRuntimeConfig;
  colorideDesktop?: {
    cloudConfig?: ColorideCloudConfig;
    dictation?: {
      start: (id: string, locale: string) => Promise<{ url: string; cancelled?: false } | { cancelled: true }>;
      stop: (id: string, abort?: boolean) => Promise<void>;
      onEvent: (callback: (event: { id: string; type: "progress"; text?: string; message?: string }) => void) => () => void;
    };
    getRuntime: () => Promise<ColorideRuntimeConfig>;
    getAppInfo: () => Promise<ColorideAppInfo>;
    openExternal: (externalUrl: string) => Promise<boolean>;
    /** After cloud device login is approved — bring Coloride to the front. */
    focusMainWindow?: () => Promise<boolean>;
    /** Frameless Windows/Linux window chrome (min / max / close). */
    windowControls?: {
      minimize: () => Promise<boolean>;
      toggleMaximize: () => Promise<boolean>;
      isMaximized: () => Promise<boolean>;
      close: () => Promise<boolean>;
      onMaximizedChange?: (callback: (maximized: boolean) => void) => () => void;
    };
    checkForUpdates: (channel: "stable" | "beta") => Promise<ColorideUpdateResult>;
    getUpdateState?: () => Promise<ColorideUpdateResult>;
    downloadUpdate?: () => Promise<ColorideUpdateResult>;
    quitAndInstallUpdate?: () => Promise<boolean>;
    openUpdateDownload: (downloadUrl: string) => Promise<boolean>;
    onUpdateEvent?: (callback: (state: ColorideUpdateResult) => void) => () => void;
    openFolder: () => Promise<string | null>;
    saveFile?: (suggestedName?: string) => Promise<string | null>;
    selectFile: () => Promise<string | null>;
    /** Plain OS clipboard text (Electron). Prefer for terminal paste. */
    readClipboardText?: () => Promise<string>;
    writeClipboardCodeRef?: (payload: { text: string; codeRef: string }) => Promise<boolean>;
    readClipboardCodeRef?: () => Promise<string | null>;
    /** OS clipboard image bytes (Electron). Null when clipboard has no image (or has real files). */
    readClipboardImage?: () => Promise<{
      mime: string;
      extension: string;
      width: number;
      height: number;
      dataBase64: string;
      byteLength: number;
    } | null>;
    /** Real OS clipboard files (Finder). Prefer over readClipboardImage. */
    readClipboardFiles?: () => Promise<Array<{
      name: string;
      mime: string;
      dataBase64: string;
      byteLength: number;
    }>>;
    /** Native OS popup; returns chosen item id or null if dismissed. */
    popupMenu?: (payload: {
      items: Array<{ id: string; label: string; enabled?: boolean }>;
      x?: number;
      y?: number;
      width?: number;
    }) => Promise<string | null>;
    setKeyboardShortcuts: (bindings: Record<string, string>) => void;
    localPathAction?: (payload: {action:"reveal" | "open"; path:string}) => Promise<void>;
    setMenuRecents?: (recents: Array<{ id: string; label: string }>) => void;
    startupAppearance?: "light" | "dark";
    nativeStartupSplash?: boolean;
    finishStartup?: () => Promise<boolean>;
    setWindowBackdrop?: (
      mode: "glass" | "opaque",
      options?: { appearance?: "dark" | "light" | "system" },
    ) => Promise<boolean>;
    /** Re-assert macOS traffic light visibility after selection glitches. */
    ensureTrafficLights?: () => Promise<boolean>;
    cloudAuth?: {
      hasSession: () => Promise<boolean>;
      requestDeviceCode: () => Promise<Record<string, unknown>>;
      pollDeviceCode: (deviceCode: string) => Promise<Record<string, unknown>>;
      refreshSession: () => Promise<Record<string, unknown> | null>;
      logout: (remote?: boolean) => Promise<boolean>;
    };
    onMenuAction: (callback: (action: ColorideMenuAction) => void) => () => void;
    onSidecarExit: (callback: (payload: { code: number | null; signal: string | null }) => void) => () => void;
    browserEmbed?: ColorideBrowserEmbedApi;
  };
}
