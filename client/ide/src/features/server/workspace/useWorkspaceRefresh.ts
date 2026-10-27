import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import {
  api
} from "../../../shared/api/client";
import {
  isAbsoluteWorkspacePath
} from "../../../shared/lib/workspacePath";
import { lspSessionManager } from "../../editor/lsp/LspSessionManager";
import {
  isBrowserTabKey
} from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  isConnectionNotOpen
} from "./connectionValidation";
import { createWorkspaceEditorReload } from "./createWorkspaceEditorReload";
import {
  fingerprintEntries,
  getItemPath,
  pathDepth
} from "./treeModel";
import type { ConnectionState } from "./types";
import {
  type EditorBuffer
} from "./types";

interface Dependencies {
  connectionStateRef: RefObject<ConnectionState>;
  workspacePathRef: RefObject<string>;
  setExplorerError: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  treeRefreshInFlightRef: RefObject<boolean>;
  setTreeRefreshing: Dispatch<SetStateAction<boolean>>;
  expandedIdsRef: RefObject<Set<string>>;
  loadedDirsRef: RefObject<Set<string>>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  dirFingerprintsRef: RefObject<Map<string, string>>;
  refreshExpandedTreeRef: RefObject<(options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  selectedFileRef: RefObject<string | null>;
  editorDirtyRef: RefObject<boolean>;
  setEditorError: Dispatch<SetStateAction<string>>;
  editorLoadRequestRef: RefObject<number>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  handleConnectionUnavailable: (message?: string) => void;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
  reloadEditorFromRemoteRef: RefObject<(path: string, options?: { force?: boolean; }) => Promise<boolean>>;
  connectionState: ConnectionState;
  workspacePath: string;
  autoRefreshTimerRef: RefObject<number | null>;
  remoteWatchCursorRef: RefObject<number>;
  remoteWatchInFlightRef: RefObject<boolean>;
  suppressEditorWatchUntilRef: RefObject<number>;
  loadDirectoryRef: RefObject<(path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>>;
  openFilesRef: RefObject<string[]>;
  editorEtagRef: RefObject<string | null>;
}

export function useWorkspaceRefresh({
  connectionStateRef,
  workspacePathRef,
  setExplorerError,
  clearRemoteWorkspace,
  treeRefreshInFlightRef,
  setTreeRefreshing,
  expandedIdsRef,
  loadedDirsRef,
  treeItemsRef,
  loadDirectory,
  setExpandedIds,
  setLoadedDirs,
  dirFingerprintsRef,
  refreshExpandedTreeRef,
  editorBuffersRef,
  selectedFileRef,
  editorDirtyRef,
  setEditorError,
  editorLoadRequestRef,
  setEditorValue,
  setEditorImageUrl,
  setEditorEtag,
  setEditorDirty,
  setEditorTruncated,
  setEditorLoading,
  setDirtyFiles,
  handleConnectionUnavailable,
  setMissingFiles,
  reloadEditorFromRemoteRef,
  connectionState,
  workspacePath,
  autoRefreshTimerRef,
  remoteWatchCursorRef,
  remoteWatchInFlightRef,
  suppressEditorWatchUntilRef,
  loadDirectoryRef,
  openFilesRef,
  editorEtagRef,
}: Dependencies) {
  const refreshExpandedTree = async (options?: {
    quiet?: boolean;
    force?: boolean;
  }) => {
    const connected = connectionStateRef.current === "connected";
    const rootPath = workspacePathRef.current;
    if (!connected || !rootPath) {
      if (!options?.quiet) {
        setExplorerError(
          connected
            ? "Select a workspace first."
            : "Connect to a server first.",
        );
        clearRemoteWorkspace();
      }
      return false;
    }
    if (treeRefreshInFlightRef.current) return false;

    treeRefreshInFlightRef.current = true;
    if (!options?.quiet) setTreeRefreshing(true);

    try {
      // Snapshot which directories were expanded/loaded before we wipe root children.
      const previouslyExpanded = new Set(expandedIdsRef.current);
      const previouslyLoaded = new Set(loadedDirsRef.current);
      const previousItems = treeItemsRef.current;
      const depthByPath = new Map<string, number>();
      for (const item of previousItems) {
        depthByPath.set(getItemPath(item), item.depth);
      }

      // Always reload workspace root first.
      const rootOk = await loadDirectory(rootPath, 0, true, false, {
        quiet: options?.quiet,
      });
      if (!rootOk) return false;

      // Reload expanded+previously-loaded dirs in breadth-first order so parents exist first.
      const dirsToReload = [...previouslyLoaded]
        .filter((path) => path !== rootPath && previouslyExpanded.has(path))
        .sort((a, b) => {
          const depthA = depthByPath.get(a) ?? pathDepth(a);
          const depthB = depthByPath.get(b) ?? pathDepth(b);
          return depthA - depthB || a.localeCompare(b);
        });

      for (const path of dirsToReload) {
        // Skip dirs that disappeared after a parent refresh.
        const stillPresent = treeItemsRef.current.some(
          (item) => getItemPath(item) === path,
        );
        if (!stillPresent) {
          setExpandedIds((current) => {
            const next = new Set(current);
            next.delete(path);
            expandedIdsRef.current = next;
            return next;
          });
          setLoadedDirs((current) => {
            const next = new Set(current);
            next.delete(path);
            loadedDirsRef.current = next;
            return next;
          });
          dirFingerprintsRef.current.delete(path);
          continue;
        }

        const item = treeItemsRef.current.find(
          (candidate) => getItemPath(candidate) === path,
        );
        const childDepth =
          (item?.depth ?? depthByPath.get(path) ?? pathDepth(path)) + 1;
        await loadDirectory(path, childDepth, false, false, {
          quiet: options?.quiet,
        });
      }

      // Drop fingerprints for dirs no longer loaded.
      const stillLoaded = loadedDirsRef.current;
      for (const path of [...dirFingerprintsRef.current.keys()]) {
        if (path !== rootPath && !stillLoaded.has(path)) {
          dirFingerprintsRef.current.delete(path);
        }
      }

      if (!options?.quiet) setExplorerError("");
      return true;
    } finally {
      treeRefreshInFlightRef.current = false;
      if (!options?.quiet) setTreeRefreshing(false);
    }
  };
  refreshExpandedTreeRef.current = refreshExpandedTree;

  const handleRefreshTree = () => {
    void refreshExpandedTreeRef.current({ quiet: false, force: true });
  };
  const { reloadEditorFromRemote } = createWorkspaceEditorReload({
    workspacePathRef,
    connectionStateRef,
    editorBuffersRef,
    selectedFileRef,
    editorDirtyRef,
    setEditorError,
    editorLoadRequestRef,
    setEditorValue,
    setEditorImageUrl,
    setEditorEtag,
    setEditorDirty,
    setEditorTruncated,
    setEditorLoading,
    setDirtyFiles,
    handleConnectionUnavailable,
    setMissingFiles,
    reloadEditorFromRemoteRef,
  });

  // Remote watch: poll expanded tree dirs + open editor etags so external VPS changes show up.
  useEffect(() => {
    if (connectionState !== "connected" || !workspacePath) {
      if (autoRefreshTimerRef.current != null) {
        window.clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
      remoteWatchCursorRef.current = 0;
      return;
    }

    const POLL_MS = 3_500;
    const DIR_BATCH = 8;
    const rootPath = workspacePath;

    const watchTick = async () => {
      if (document.hidden) return;
      if (remoteWatchInFlightRef.current || treeRefreshInFlightRef.current)
        return;
      if (
        connectionStateRef.current !== "connected" ||
        workspacePathRef.current !== rootPath
      )
        return;

      // Compilation configuration must refresh even during the post-save quiet window.
      void lspSessionManager.refreshCppConfiguration();

      // After our own save/write, skip remote-watch entirely for a short window.
      // Saves change size/mtime and would otherwise rebuild the whole file tree.
      if (Date.now() < suppressEditorWatchUntilRef.current) return;

      remoteWatchInFlightRef.current = true;
      try {
        // --- Tree: fingerprint expanded/loaded directories (round-robin) ---
        const dirs = [
          rootPath,
          ...[...loadedDirsRef.current]
            .filter(
              (path) => path !== rootPath && expandedIdsRef.current.has(path),
            )
            .sort((a, b) => a.localeCompare(b)),
        ];
        let changedDir: string | null = null;
        if (dirs.length > 0) {
          const start = remoteWatchCursorRef.current % dirs.length;
          const batch: string[] = [];
          for (let i = 0; i < Math.min(DIR_BATCH, dirs.length); i += 1) {
            batch.push(dirs[(start + i) % dirs.length]!);
          }
          remoteWatchCursorRef.current = start + batch.length;

          for (const path of batch) {
            try {
              const response = await api.listFiles(path);
              const nextFingerprint = fingerprintEntries(response.entries);
              const prevFingerprint = dirFingerprintsRef.current.get(path);
              if (prevFingerprint == null) {
                dirFingerprintsRef.current.set(path, nextFingerprint);
                continue;
              }
              if (prevFingerprint !== nextFingerprint) {
                // Keep fingerprint fresh even before reload so we don't thrash.
                dirFingerprintsRef.current.set(path, nextFingerprint);
                changedDir = path;
                break;
              }
            } catch (error) {
              if (isConnectionNotOpen(error)) {
                handleConnectionUnavailable();
                return;
              }
              // Transient list errors: skip this dir this tick.
            }
          }
        }

        // Only reload the directory that actually changed — not the entire tree.
        if (changedDir) {
          const isRoot = changedDir === rootPath;
          const parentRow = isRoot
            ? null
            : treeItemsRef.current.find(
              (item) => getItemPath(item) === changedDir,
            );
          const childDepth = isRoot
            ? 0
            : (parentRow?.depth ?? pathDepth(changedDir)) + 1;
          await loadDirectoryRef.current(
            changedDir,
            childDepth,
            isRoot,
            false,
            { quiet: true },
          );
        }

        // --- Editors: cheap stat of open (non-browser) files ---

        const openRemote = openFilesRef.current.filter(
          (path) => isAbsoluteWorkspacePath(path) && !isBrowserTabKey(path),
        );
        // Always include active file first.
        const active = selectedFileRef.current;
        const watchPaths = [
          ...(active &&
            isAbsoluteWorkspacePath(active) &&
            !isBrowserTabKey(active)
            ? [active]
            : []),
          ...openRemote.filter((path) => path !== active),
        ].slice(0, 24);

        if (watchPaths.length === 0) return;

        let stats;
        try {
          stats = await api.statFiles(watchPaths);
        } catch (error) {
          if (isConnectionNotOpen(error)) {
            handleConnectionUnavailable();
          }
          return;
        }

        for (const entry of stats.entries ?? []) {
          const path = entry.path;
          const cached = editorBuffersRef.current.get(path);
          const isActive = selectedFileRef.current === path;
          const knownEtag = isActive
            ? editorEtagRef.current
            : (cached?.etag ?? null);

          if (!entry.exists) {
            if (isActive && knownEtag) {
              setEditorError((current) =>
                current.includes("no longer exists")
                  ? current
                  : "This file no longer exists on the server.",
              );
            }
            continue;
          }

          if (!entry.etag || !knownEtag) continue;
          if (entry.etag === knownEtag) continue;

          // Remote version diverged from what we last loaded/saved.
          await reloadEditorFromRemoteRef.current(path);
        }
      } finally {
        remoteWatchInFlightRef.current = false;
      }
    };

    autoRefreshTimerRef.current = window.setInterval(() => {
      void watchTick();
    }, POLL_MS);

    // Early check after connect / workspace change.
    const initial = window.setTimeout(() => {
      void watchTick();
    }, 1_200);

    // When the window becomes visible again, check immediately.
    const onVisibility = () => {
      if (!document.hidden) void watchTick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (autoRefreshTimerRef.current != null) {
        window.clearInterval(autoRefreshTimerRef.current);
        autoRefreshTimerRef.current = null;
      }
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // handleConnectionUnavailable is stable enough for disconnect handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState, workspacePath]);
  return { handleRefreshTree, reloadEditorFromRemote };
}
