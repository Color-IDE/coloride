import { useSyncExternalStore } from "react";

export type PermissionMode = "read-only" | "confirm-changes" | "read-write";
export type StartupBehavior = "welcome" | "restore-session" | "connect-server";
export type AfterConnectBehavior = "file-browser" | "server-health";
export type MotionPreference = "system" | "reduce" | "full";
export type ThemePreference = "system" | "light" | "dark";
export type InterfaceFontFamily = "system" | "rounded" | "classic";
export type CodeFontFamily = "jetbrains" | "system-mono" | "menlo";
export type EditorCursorStyle = "line" | "block" | "underline";
export type EditorLineNumbers = "on" | "relative" | "off";
export type EditorRenderWhitespace = "none" | "selection" | "all";
export type EditorWordWrap = "off" | "on" | "bounded";
export type TerminalCursorStyle = "bar" | "block" | "underline";
export type UpdateChannel = "stable" | "beta";
export type AgentActivityDetail = "minimal" | "normal" | "verbose";

export interface AppPreferences {
  afterConnectBehavior: AfterConnectBehavior;
  /** How much internal agent work appears in the chat. */
  agentActivityDetail: AgentActivityDetail;
  accentColor: string;
  codeFontFamily: CodeFontFamily;
  codeFontSize: number;
  checkForUpdatesAutomatically: boolean;
  confirmDangerousActions: boolean;
  editorAutoSave: boolean;
  editorBracketPairColorization: boolean;
  editorCursorStyle: EditorCursorStyle;
  editorFontLigatures: boolean;
  editorInlayHints: boolean;
  editorInsertSpaces: boolean;
  editorLineNumbers: EditorLineNumbers;
  editorMinimap: boolean;
  editorRenderWhitespace: EditorRenderWhitespace;
  editorSmoothScrolling: boolean;
  editorStickyScroll: boolean;
  editorTabSize: number;
  editorWordWrap: EditorWordWrap;
  fontSmoothing: boolean;
  interfaceFontFamily: InterfaceFontFamily;
  interfaceFontSize: number;
  includeDiagnosticsInReports: boolean;
  motionPreference: MotionPreference;
  notifyConnectionChanges: boolean;
  permissionMode: PermissionMode;
  pointerCursors: boolean;
  recordLocalActivity: boolean;
  rememberPanelSizes: boolean;
  restoreOpenFiles: boolean;
  startupBehavior: StartupBehavior;
  terminalCopyOnSelect: boolean;
  terminalCursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  terminalMacOptionIsMeta: boolean;
  terminalMinimumContrastRatio: number;
  terminalRequireLinkModifier: boolean;
  terminalScrollback: number;
  terminalSmoothScrolling: boolean;
  theme: ThemePreference;
  updateChannel: UpdateChannel;
}

const STORAGE_KEY = "coloride.app-preferences.v1";

export const defaultAppPreferences: AppPreferences = {
  afterConnectBehavior: "file-browser",
  agentActivityDetail: "normal",
  accentColor: "#4ebdff",
  codeFontFamily: "jetbrains",
  codeFontSize: 13,
  checkForUpdatesAutomatically: true,
  confirmDangerousActions: true,
  editorAutoSave: false,
  editorBracketPairColorization: true,
  editorCursorStyle: "line",
  editorFontLigatures: false,
  editorInlayHints: false,
  editorInsertSpaces: true,
  editorLineNumbers: "on",
  editorMinimap: true,
  editorRenderWhitespace: "selection",
  editorSmoothScrolling: true,
  editorStickyScroll: false,
  editorTabSize: 2,
  editorWordWrap: "off",
  fontSmoothing: true,
  interfaceFontFamily: "system",
  interfaceFontSize: 13,
  includeDiagnosticsInReports: true,
  motionPreference: "system",
  notifyConnectionChanges: false,
  permissionMode: "confirm-changes",
  pointerCursors: true,
  recordLocalActivity: true,
  rememberPanelSizes: true,
  restoreOpenFiles: true,
  startupBehavior: "restore-session",
  terminalCopyOnSelect: false,
  terminalCursorBlink: true,
  terminalCursorStyle: "bar",
  terminalMacOptionIsMeta: true,
  terminalMinimumContrastRatio: 1,
  terminalRequireLinkModifier: true,
  terminalScrollback: 5000,
  terminalSmoothScrolling: true,
  theme: "dark",
  updateChannel: "stable",
};

export function getInterfaceFontFamily(value: InterfaceFontFamily) {
  if (value === "rounded") return '"SF Pro Rounded", ui-rounded, system-ui, sans-serif';
  if (value === "classic") return '"Helvetica Neue", Helvetica, Arial, sans-serif';
  return 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
}

export function getCodeFontFamily(value: CodeFontFamily) {
  if (value === "menlo") return 'Menlo, Monaco, "Courier New", monospace';
  if (value === "system-mono") return 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, monospace';
  return '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, monospace';
}

const coerceBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

/** One-shot: open on Welcome (saved servers) instead of last tab. */
const STARTUP_RESTORE_MIGRATION_KEY = "coloride.session.restore-startup-v2";

const readPreferences = (): AppPreferences => {
  if (typeof window === "undefined") return defaultAppPreferences;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultAppPreferences;
    const parsed = JSON.parse(stored) as Partial<AppPreferences>;
    const loaded = { ...defaultAppPreferences, ...parsed } as AppPreferences;
    // Guard against corrupted localStorage (string "true"/"false") after restarts.
    loaded.pointerCursors = coerceBoolean(parsed.pointerCursors, defaultAppPreferences.pointerCursors);
    loaded.fontSmoothing = coerceBoolean(parsed.fontSmoothing, defaultAppPreferences.fontSmoothing);
    loaded.editorAutoSave = coerceBoolean(parsed.editorAutoSave, defaultAppPreferences.editorAutoSave);
    loaded.editorInlayHints = coerceBoolean(parsed.editorInlayHints, defaultAppPreferences.editorInlayHints);
    loaded.restoreOpenFiles = coerceBoolean(parsed.restoreOpenFiles, defaultAppPreferences.restoreOpenFiles);
    loaded.rememberPanelSizes = coerceBoolean(parsed.rememberPanelSizes, defaultAppPreferences.rememberPanelSizes);
    if (
      loaded.startupBehavior !== "restore-session"
      && loaded.startupBehavior !== "connect-server"
    ) {
      loaded.startupBehavior = defaultAppPreferences.startupBehavior;
    }
    if (
      loaded.agentActivityDetail !== "minimal"
      && loaded.agentActivityDetail !== "normal"
      && loaded.agentActivityDetail !== "verbose"
    ) {
      loaded.agentActivityDetail = defaultAppPreferences.agentActivityDetail;
    }
    if (!window.localStorage.getItem(STARTUP_RESTORE_MIGRATION_KEY)) {
      if (loaded.startupBehavior === "welcome") loaded.startupBehavior = "restore-session";
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
        window.localStorage.setItem(STARTUP_RESTORE_MIGRATION_KEY, "1");
      } catch {
        // ignore
      }
    }
    if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
      loaded.notifyConnectionChanges = false;
    }
    return loaded;
  } catch {
    return defaultAppPreferences;
  }
};

let preferences = readPreferences();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => preferences;

export function useAppPreferences() {
  return useSyncExternalStore(subscribe, getSnapshot, () => defaultAppPreferences);
}

const systemThemeQuery = () => (
  typeof window === "undefined" ? null : window.matchMedia("(prefers-color-scheme: dark)")
);

const subscribeToSystemTheme = (listener: () => void) => {
  const query = systemThemeQuery();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
};

const getSystemTheme = () => systemThemeQuery()?.matches ?? true;

export function getResolvedTheme(): "light" | "dark" {
  const theme = preferences.theme;
  if (theme === "system") return getSystemTheme() ? "dark" : "light";
  return theme === "light" ? "light" : "dark";
}

/** Paint html/body from saved prefs. Login chrome must call this when it drops dark. */
export function applyResolvedThemeToDocument() {
  if (typeof document === "undefined") return "dark" as const;
  const resolved = getResolvedTheme();
  const html = document.documentElement;
  const body = document.body;
  body.dataset.theme = resolved;
  html.dataset.theme = resolved;
  html.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    resolved === "light" ? "#ffffff" : "#171717",
  );
  return resolved;
}

export function useResolvedTheme(): "light" | "dark" {
  const { theme } = useAppPreferences();
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => true);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

export function updateAppPreference<Key extends keyof AppPreferences>(
  key: Key,
  value: AppPreferences[Key],
) {
  preferences = { ...preferences, [key]: value };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Keep the setting active for the current session if storage is unavailable.
  }

  listeners.forEach((listener) => listener());
}
