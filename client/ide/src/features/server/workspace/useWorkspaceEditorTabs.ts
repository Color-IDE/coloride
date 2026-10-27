import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { confirmUntitledClose, isUntitledPath } from "./untitledFile";
import { lspSyncClose } from "../../editor/lsp/documentSync";
import {
  browserTabKey,
  closeBrowserEmbed,
  isBrowserTabKey,
  type BrowserTabState,
} from "../../explorer/BrowserPane";
import type { AppPreferences } from "../../settings/preferences";
import {
  editorSessionStorageKey
} from "./editorFiles";
import type { ConnectionState } from "./types";
import {
  type EditorBuffer
} from "./types";

interface Dependencies {
  editorSessionReadyKey: string;
  editorCursorRef: RefObject<{ line: number; column: number; }>;
  appPreferences: AppPreferences;
  connectionStateRef: RefObject<ConnectionState>;
  activeProfileIdRef: RefObject<string | null>;
  workspacePathRef: RefObject<string>;
  selectedFileRef: RefObject<string | null>;
  openFiles: string[];
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setBrowserTabs: Dispatch<SetStateAction<Record<string, BrowserTabState>>>;
  selectedFile: string | null;
  editorLoadRequestRef: RefObject<number>;
  activateEditorFile: (path: string, rememberCurrent?: boolean, options?: { reveal?: boolean; }) => Promise<boolean | undefined>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  rememberActiveEditor: () => void;
  editorDirty: boolean;
  connectionState: ConnectionState;
  setExplorerError: Dispatch<SetStateAction<string>>;
}

export function useWorkspaceEditorTabs({
  editorSessionReadyKey,
  editorCursorRef,
  appPreferences,
  connectionStateRef,
  activeProfileIdRef,
  workspacePathRef,
  selectedFileRef,
  openFiles,
  setOpenFiles,
  editorBuffersRef,
  setDirtyFiles,
  setMissingFiles,
  setBrowserTabs,
  selectedFile,
  editorLoadRequestRef,
  activateEditorFile,
  setSelectedFile,
  setEditorValue,
  setEditorImageUrl,
  setEditorEtag,
  setEditorDirty,
  setEditorTruncated,
  setEditorError,
  setEditorLoading,
  rememberActiveEditor,
  editorDirty,
  connectionState,
  setExplorerError,
}: Dependencies) {

  const editorSessionReadyKeyRef = useRef("");
  useEffect(() => {
    editorSessionReadyKeyRef.current = editorSessionReadyKey;
  }, [editorSessionReadyKey]);
  const cursorPersistTimerRef = useRef<number | null>(null);

  /** Keep last caret so session restore can land on the same line/column. */
  const noteEditorCursor = (line: number, column: number) => {
    if (!Number.isFinite(line) || !Number.isFinite(column)) return;
    editorCursorRef.current = {
      line: Math.max(1, Math.floor(line)),
      column: Math.max(1, Math.floor(column)),
    };
    // Debounced write while session is live (cursor moves often).
    if (cursorPersistTimerRef.current != null) {
      window.clearTimeout(cursorPersistTimerRef.current);
    }
    cursorPersistTimerRef.current = window.setTimeout(() => {
      cursorPersistTimerRef.current = null;
      if (
        !appPreferences.restoreOpenFiles ||
        connectionStateRef.current !== "connected" ||
        !activeProfileIdRef.current ||
        !workspacePathRef.current
      ) {
        return;
      }
      const sessionKey = editorSessionStorageKey(
        activeProfileIdRef.current,
        workspacePathRef.current,
      );
      if (editorSessionReadyKeyRef.current !== sessionKey) return;
      const active = selectedFileRef.current;
      if (!active || isBrowserTabKey(active)) return;
      try {
        const raw = window.localStorage.getItem(sessionKey);
        const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        window.localStorage.setItem(
          sessionKey,
          JSON.stringify({
            ...prev,
            activeFile: active,
            cursor: {
              line: editorCursorRef.current.line,
              column: editorCursorRef.current.column,
            },
          }),
        );
      } catch {
        // ignore quota
      }
    }, 250);
  };

  const closeEditorFileImmediately = (
    path: string,
    options?: { keepUnsaved?: boolean },
  ) => {
    const index = openFiles.indexOf(path);
    const remaining = openFiles.filter((file) => file !== path);
    setOpenFiles(remaining);
    const keepUnsaved = Boolean(options?.keepUnsaved) && !isBrowserTabKey(path);
    if (!keepUnsaved) {
      editorBuffersRef.current.delete(path);
      setDirtyFiles((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      setMissingFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
    if (!isBrowserTabKey(path)) {
      void lspSyncClose(path);
    }
    if (isBrowserTabKey(path)) {
      let browserIdToClose = "";
      setBrowserTabs((current) => {
        browserIdToClose = current[path]?.browserId ?? "";
        const next = { ...current };
        delete next[path];
        return next;
      });
      // Destroy native Chromium WebContentsView for this tab.
      if (browserIdToClose) {
        void closeBrowserEmbed(browserIdToClose);
      }
    }
    if (selectedFile !== path) return;

    editorLoadRequestRef.current += 1;
    const nextPath =
      remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null;
    if (nextPath) {
      void activateEditorFile(nextPath, false);
      return;
    }

    setSelectedFile(null);
    setEditorValue("");
    setEditorImageUrl(null);
    setEditorEtag(null);
    setEditorDirty(false);
    setEditorTruncated(false);
    setEditorError("");
    setEditorLoading(false);
  };

  const closeEditorFile = (path: string) => {
    if (isBrowserTabKey(path)) {
      closeEditorFileImmediately(path);
      return;
    }
    if (path === selectedFile) rememberActiveEditor();
    const buffer =
      path === selectedFile
        ? {
            dirty: editorDirty,
            error: "",
            etag: null,
            truncated: false,
            imageUrl: null,
            value: editorBuffersRef.current.get(path)?.value ?? "",
          }
        : editorBuffersRef.current.get(path);
    if (isUntitledPath(path) && buffer?.dirty) {
      void confirmUntitledClose(buffer.value).then((close) => {
        if (close) closeEditorFileImmediately(path);
      });
      return;
    }
    closeEditorFileImmediately(path, { keepUnsaved: Boolean(buffer?.dirty) });
  };

  const updateBrowserTab = (tabKey: string, next: Partial<BrowserTabState>) => {
    setBrowserTabs((current) => {
      const existing = current[tabKey];
      if (!existing) return current;
      return { ...current, [tabKey]: { ...existing, ...next } };
    });
  };

  const openBrowserUrl = async (rawUrl: string) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Real Chromium embed (Electron WebContentsView + SSH SOCKS) — no remote JPEG session.
    const browserId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tabKey = browserTabKey(browserId);
    const tab: BrowserTabState = {
      browserId,
      url,
      title: "",
      loading: true,
      error: "",
    };

    if (selectedFile && !isBrowserTabKey(selectedFile)) {
      rememberActiveEditor();
    }
    setOpenFiles((current) =>
      current.includes(tabKey) ? current : [...current, tabKey],
    );
    setBrowserTabs((current) => ({ ...current, [tabKey]: tab }));
    setSelectedFile(tabKey);
    setEditorLoading(false);
    setEditorError("");
    setEditorDirty(false);
    setEditorImageUrl(null);
    setEditorValue("");
    setEditorEtag(null);
    setEditorTruncated(false);
    setExplorerError("");
    return true;
  };
  return { noteEditorCursor, closeEditorFile, updateBrowserTab, openBrowserUrl };
}
