import { useSyncExternalStore } from "react";
import type { UpdateChannel } from "./preferences";

export type UpdateCheckResult = ColorideUpdateResult;

export type UpdateUiStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

interface UpdateState {
  checking: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  result: UpdateCheckResult | null;
  /** Live download percent (packaged auto-update). */
  progress: number;
  canInstall: boolean;
  autoUpdateEnabled: boolean;
  status: UpdateUiStatus;
}

const STORAGE_KEY = "coloride.update-state.v1";
const isElectronOwnVersion = (version: string | null | undefined) =>
  /^v?43\./.test(String(version || "").trim());
/** Re-check at most every 4 hours in the background (the app checks at startup). */
const AUTOMATIC_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

const emptyState = (): UpdateState => ({
  checking: false,
  error: null,
  lastCheckedAt: null,
  result: null,
  progress: 0,
  canInstall: false,
  autoUpdateEnabled: false,
  status: "idle",
});

const readState = (): UpdateState => {
  if (typeof window === "undefined") return emptyState();
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<UpdateState> | null;
    const storedResult = stored?.result && !isElectronOwnVersion(stored.result.currentVersion)
      ? stored.result
      : null;
    return {
      ...emptyState(),
      lastCheckedAt: storedResult ? stored?.lastCheckedAt ?? null : null,
      result: storedResult,
      autoUpdateEnabled: Boolean(stored?.result?.autoUpdateEnabled),
      status: (stored?.result?.status as UpdateState["status"]) || "idle",
      canInstall: Boolean(stored?.result?.canInstall),
      progress: typeof stored?.result?.progress === "number" ? stored.result.progress : 0,
    };
  } catch {
    return emptyState();
  }
};

let state = readState();
const serverState = emptyState();
const listeners = new Set<() => void>();
let eventBridgeAttached = false;

const emit = () => listeners.forEach((listener) => listener());

const setState = (next: UpdateState) => {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      lastCheckedAt: state.lastCheckedAt,
      result: state.result,
    }));
  } catch {
    // ignore
  }
  emit();
};

function applyResult(result: UpdateCheckResult | null, extra?: Partial<UpdateState>) {
  setState({
    ...state,
    checking: result?.status === "checking",
    error: result?.error ?? null,
    lastCheckedAt: result?.checkedAt ?? state.lastCheckedAt,
    result,
    progress: typeof result?.progress === "number" ? result.progress : 0,
    canInstall: Boolean(result?.canInstall),
    autoUpdateEnabled: Boolean(result?.autoUpdateEnabled),
    status: (result?.status as UpdateState["status"]) || state.status,
    ...extra,
  });
}

function ensureEventBridge() {
  if (eventBridgeAttached || typeof window === "undefined") return;
  const bridge = window.colorideDesktop;
  if (!bridge?.onUpdateEvent) return;
  eventBridgeAttached = true;
  bridge.onUpdateEvent((payload) => {
    applyResult(payload, {
      checking: payload.status === "checking",
    });
  });
}

export function useUpdateState() {
  ensureEventBridge();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => serverState,
  );
}

export async function checkForUpdates(channel: UpdateChannel) {
  ensureEventBridge();
  const bridge = window.colorideDesktop;
  if (!bridge?.checkForUpdates) {
    setState({
      ...state,
      checking: false,
      error: "Update checks are available in the Coloride desktop app.",
      status: "error",
    });
    return null;
  }

  setState({ ...state, checking: true, error: null, status: "checking" });
  try {
    const result = await bridge.checkForUpdates(channel);
    const lastCheckedAt = result.checkedAt || new Date().toISOString();
    applyResult({ ...result, checkedAt: lastCheckedAt }, { checking: false, lastCheckedAt });
    return result;
  } catch (error) {
    setState({
      ...state,
      checking: false,
      error: error instanceof Error ? error.message : String(error),
      status: "error",
    });
    return null;
  }
}

export async function downloadUpdate() {
  ensureEventBridge();
  const bridge = window.colorideDesktop;
  if (!bridge?.downloadUpdate) {
    throw new Error("In-app download is only available in the installed desktop app.");
  }
  setState({ ...state, checking: false, status: "downloading", error: null, progress: Math.max(state.progress, 1) });
  try {
    const result = await bridge.downloadUpdate();
    applyResult(result, { checking: false });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setState({ ...state, status: "error", error: message });
    throw error;
  }
}

export async function quitAndInstallUpdate() {
  const bridge = window.colorideDesktop;
  if (!bridge?.quitAndInstallUpdate) {
    throw new Error("Restart to update is only available in the installed desktop app.");
  }
  await bridge.quitAndInstallUpdate();
}

export async function maybeCheckForUpdates(channel: UpdateChannel) {
  if (!window.colorideDesktop?.checkForUpdates || state.checking) return;
  const lastCheck = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;
  const sameChannel = state.result?.channel === channel;
  if (sameChannel && Number.isFinite(lastCheck) && Date.now() - lastCheck < AUTOMATIC_CHECK_INTERVAL) return;
  // Skip download-in-progress / ready-to-install.
  if (state.status === "downloading" || state.status === "downloaded") return;
  await checkForUpdates(channel);
}

export async function openUpdateDownload(downloadUrl: string) {
  if (!window.colorideDesktop?.openUpdateDownload) {
    throw new Error("The update download is only available in the desktop app.");
  }
  await window.colorideDesktop.openUpdateDownload(downloadUrl);
}

/** Hydrate from main on Settings mount (packaged builds). */
export async function refreshUpdateStateFromMain() {
  ensureEventBridge();
  const bridge = window.colorideDesktop;
  if (!bridge?.getUpdateState) return;
  try {
    const result = await bridge.getUpdateState();
    applyResult(result);
  } catch {
    // ignore
  }
}
