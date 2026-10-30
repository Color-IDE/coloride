import { useEffect, useRef, useState } from "react";
import {
  api,
  decodeBase64ToText,
  encodeTextToBase64,
  hydrateRuntimeFromDesktop,
} from "../../../shared/api/client";
import {
  isAbsoluteWorkspacePath
} from "../../../shared/lib/workspacePath";
import {
  getAllAgentEditReviews,
  hydrateAgentEditReviews,
  subscribeAgentEditReviews
} from "../../editor/agentEditBridge";
import { agentLogTabKey, isAgentLogTabKey } from "../../editor/agentLogTab";
import { lspSyncChange } from "../../editor/lsp/documentSync";
import { lspSessionManager } from "../../editor/lsp/LspSessionManager";
import { applyLineEdits, type LineTextEdit } from "../../editor/lsp/textEdits";
import {
  isBrowserTabKey
} from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  readLastSession,
  writeLastSession,
  writeTreeSession
} from "../../settings/lastSession";
import { useAppPreferences } from "../../settings/preferences";
import {
  messageFromError
} from "./connectionValidation";
import {
  editorSessionStorageKey,
  isKnownBinaryPath
} from "./editorFiles";
import { isUntitledPath, openBlankFile } from "./untitledFile";
import {
  getItemPath,
  isDirectoryEditorPath,
  isUnderWorkspace,
  normalizeRemotePath
} from "./treeModel";
import { useWorkspaceAgentBaseline } from "./useWorkspaceAgentBaseline";
import { useWorkspaceAgentReview } from "./useWorkspaceAgentReview";
import { useWorkspaceAgentStream } from "./useWorkspaceAgentStream";
import { useWorkspaceBufferState } from "./useWorkspaceBufferState";
import { useWorkspaceConnection } from "./useWorkspaceConnection";
import { useWorkspaceConnectionState } from "./useWorkspaceConnectionState";
import { useWorkspaceEditorBuffers } from "./useWorkspaceEditorBuffers";
import { useWorkspaceEditorTabs } from "./useWorkspaceEditorTabs";
import { useWorkspaceFileOperations } from "./useWorkspaceFileOperations";
import { useWorkspaceFolderNavigation } from "./useWorkspaceFolderNavigation";
import { useWorkspaceProfiles } from "./useWorkspaceProfiles";
import { useWorkspaceRefresh } from "./useWorkspaceRefresh";
import { useWorkspaceSaving } from "./useWorkspaceSaving";
import { useWorkspaceTreeLoading } from "./useWorkspaceTreeLoading";
import { useWorkspaceTreeNavigation } from "./useWorkspaceTreeNavigation";
import { useWorkspaceTreeState } from "./useWorkspaceTreeState";

export function useServerWorkspace() {
  const appPreferences = useAppPreferences();
  const {
    showLoadDropdown,
    setShowLoadDropdown,
    showConnectModal,
    setShowConnectModal,
    connectStep,
    setConnectStep,
    isDropdownHiding,
    setIsDropdownHiding,
    showKeyDropdown,
    setShowKeyDropdown,
    authMethod,
    setAuthMethod,
    sshKeyPath,
    setSshKeyPath,
    showPassword,
    setShowPassword,
    serverName,
    setServerName,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    password,
    setPassword,
    keyPassphrase,
    setKeyPassphrase,
    errors,
    setErrors,
    connectionState,
    setConnectionState,
    activeProfileId,
    setActiveProfileId,
    savedProfiles,
    setSavedProfiles,
    localRecentWorkspaces,
    setLocalRecentWorkspaces,
    profilesLoading,
    setProfilesLoading,
    profilesError,
    setProfilesError,
    workspacePath,
    setWorkspacePath,
    workspaceKind,
    setWorkspaceKind,
    hostKeyPrompt,
    hostKeyTrusting,
    loadButtonRef,
    loadDropdownRef,
    keyDropdownRef,
    sshKeyFileInputRef,
    pendingConnectionRef,
    connectionUnavailableRef,
    connectionStateRef,
    workspacePathRef,
    activeProfileIdRef,
    userOwnedConnectionRef,
    lastPersistedWorkspaceRef,
    setHostKeyPrompt,
    setHostKeyTrusting,
  } = useWorkspaceConnectionState();
  const {
    explorerError,
    setExplorerError,
    treeItems,
    setTreeItems,
    expandedIds,
    setExpandedIds,
    loadedDirs,
    setLoadedDirs,
    loadingDirs,
    setLoadingDirs,
    treeSessionReadyKey,
    treeItemsRef,
    expandedIdsRef,
    loadedDirsRef,
    dirFingerprintsRef,
    treeRefreshInFlightRef,
    autoRefreshTimerRef,
    remoteWatchCursorRef,
    remoteWatchInFlightRef,
    revealTokenRef,
    refreshExpandedTreeRef,
    loadDirectoryRef,
    setTreeSessionReadyKey,
    treeClipboardRef, treeClipboard, treeUndoStackRef, treeUndoDepth, setTreeUndoDepth, setTreeClipboard
  } = useWorkspaceTreeState();
  const {
    selectedFile,
    setSelectedFile,
    openFiles,
    setOpenFiles,
    browserTabs,
    setBrowserTabs,
    editorValue,
    setEditorValue,
    editorImageUrl,
    setEditorImageUrl,
    editorEtag,
    setEditorEtag,
    editorDirty,
    setEditorDirty,
    editorTruncated,
    setEditorTruncated,
    editorLoading,
    setEditorLoading,
    editorError,
    setEditorError,
    missingFiles,
    setMissingFiles,
    dirtyFiles,
    setDirtyFiles,
    editorSessionReadyKey,
    editorBuffersRef,
    editorLoadRequestRef,
    suppressEditorWatchUntilRef,
    openFilesRef,
    selectedFileRef,
    editorDirtyRef,
    editorEtagRef,
    editorValueRef,
    editorImageUrlRef,
    editorTruncatedRef,
    autoSaveTimerRef,
    autoSaveInFlightRef,
    autoSavePendingRef,
    saveEditorBufferRef,
    reloadEditorFromRemoteRef,
    editorRevealTokenRef,
    sessionRestoreGenRef,
    editorCursorRef,
    setEditorSessionReadyKey,
  } = useWorkspaceBufferState();
  const {
    agentEditBaseRef,
    captureAgentEditBaseline,
    clearAgentEditBaseline,
    agentStreamingPaths,
    agentEditReviewTick,
    setAgentStreamingPaths,
    setAgentEditReviewTick,
  } = useWorkspaceAgentBaseline({ editorBuffersRef });
  const [treeRefreshing, setTreeRefreshing] = useState(false);
  /** Bumped when the explorer should scroll/focus a path in the tree. */
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    token: number;
  } | null>(null);
  /** One-shot editor navigation (e.g. open search match at line). */
  const [editorReveal, setEditorReveal] = useState<{
    path: string;
    line: number;
    column?: number;
    token: number;
  } | null>(null);
  /** Latest activateWorkspace for agent WS / async callers (avoids stale closures). */
  const activateWorkspaceRef = useRef<
    (
      path: string,
      options?: {
        persist?: boolean;
        forceReload?: boolean;
        skipAccessSetup?: boolean;
      },
    ) => Promise<boolean>
  >(async () => false);

  useEffect(() => {
    // Restore pending Keep/Undo reviews from last session (if any).
    hydrateAgentEditReviews();
    setAgentEditReviewTick((n) => n + 1);
    let prevReviewPaths = new Set(getAllAgentEditReviews().map((r) => r.path));
    return subscribeAgentEditReviews(() => {
      setAgentEditReviewTick((n) => n + 1);
      // When a path leaves review (Keep/Undo/Keep all), drop its baseline so the
      // next agent edit starts from the current buffer, not the old original.
      const nextPaths = new Set(getAllAgentEditReviews().map((r) => r.path));
      for (const p of prevReviewPaths) {
        if (
          !nextPaths.has(p) &&
          !editorBuffersRef.current.get(p)?.agentStreaming
        ) {
          agentEditBaseRef.current.delete(p);
        }
      }
      prevReviewPaths = nextPaths;
    });
  }, []);

  const requestWritePermission = (
    action: string,
    dangerous = false,
    options?: { skipConfirm?: boolean },
  ) => {
    if (appPreferences.permissionMode === "read-only") {
      setExplorerError(`Read-only mode: ${action.toLowerCase()} is disabled.`);
      setEditorError(`Read-only mode: ${action.toLowerCase()} is disabled.`);
      return false;
    }

    // Lightweight actions (new file/folder) never prompt — only real mutations may.
    if (options?.skipConfirm) return true;

    const requiresConfirmation =
      appPreferences.permissionMode === "confirm-changes" ||
      (dangerous && appPreferences.confirmDangerousActions);
    return !requiresConfirmation || window.confirm(`${action}?`);
  };

  useEffect(() => {
    if (authMethod !== "password") {
      setShowPassword(false);
    }
    setErrors((prev) => {
      const { password, sshKey, keyPassphrase, ...rest } = prev;
      return rest;
    });
  }, [authMethod]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyFiles.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyFiles]);

  const clearErrors = (...keys: string[]) => {
    setErrors((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  };

  const closeLoadDropdown = () => {
    if (!showLoadDropdown && !isDropdownHiding) return;
    setIsDropdownHiding(true);
    setTimeout(() => {
      setShowLoadDropdown(false);
      setIsDropdownHiding(false);
    }, 120);
  };

  const openLoadDropdown = () => {
    setShowLoadDropdown(true);
    setIsDropdownHiding(false);
    void loadSavedProfiles();
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        (loadButtonRef.current && loadButtonRef.current.contains(target)) ||
        (loadDropdownRef.current && loadDropdownRef.current.contains(target))
      ) {
        return;
      }
      closeLoadDropdown();
    };
    if (showLoadDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showLoadDropdown]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (keyDropdownRef.current && keyDropdownRef.current.contains(target)) {
        return;
      }
      setShowKeyDropdown(false);
    };
    if (showKeyDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showKeyDropdown]);

  const {
    loadSavedProfiles,
    clearRemoteWorkspace,
    handleConnectionUnavailable,
    completePendingConnection,
    requestHostVerification,
    validateServerStep,
    validateCredentialsStep,
    validateForm,
    cancelWorkspaceSelection,
    cancelHostKeyPrompt,
    trustPendingHostKey,
  } = useWorkspaceConnection({
    sessionRestoreGenRef,
    setTreeSessionReadyKey,
    setEditorSessionReadyKey,
    setBrowserTabs,
    setTreeItems,
    setExpandedIds,
    setLoadedDirs,
    setLoadingDirs,
    setSelectedFile,
    setOpenFiles,
    treeClipboardRef,
    setTreeClipboard,
    dirFingerprintsRef,
    setTreeRefreshing,
    treeRefreshInFlightRef,
    editorBuffersRef,
    treeUndoStackRef,
    setTreeUndoDepth,
    agentEditBaseRef,
    editorLoadRequestRef,
    setEditorValue,
    setEditorImageUrl,
    setEditorEtag,
    setEditorDirty,
    setEditorTruncated,
    setDirtyFiles,
    setExplorerError,
    connectionStateRef,
    connectionUnavailableRef,
    userOwnedConnectionRef,
    setConnectionState,
    setActiveProfileId,
    setWorkspacePath,
    setEditorError,
    setShowConnectModal,
    serverName,
    host,
    port,
    setErrors,
    username,
    authMethod,
    password,
    sshKeyPath,
    setProfilesLoading,
    setProfilesError,
    setSavedProfiles,
    setWorkspaceKind,
    activeProfileIdRef,
    setServerName,
    setHost,
    setPort,
    setUsername,
    activateWorkspaceRef,
    appPreferences,
    openLocalWorkspace: (path) => openLocalWorkspace(path),
    handleLoadSavedProfile: (profile) => handleLoadSavedProfile(profile),
    clearErrors,
    activateWorkspace: (path, options) => activateWorkspace(path, options),
    pendingConnectionRef,
    setHostKeyPrompt,
    setConnectStep,
    hostKeyPrompt,
    setHostKeyTrusting,
  });
  useEffect(() => {
    lspSessionManager.configure({
      connected: connectionState === "connected",
      rootPath: workspacePath || null,
    });
  }, [connectionState, workspacePath]);

  // Persist expanded tree folders for this workspace (last session).
  // Wait until tree restore finishes so a boot-time empty Set never overwrites storage.
  useEffect(() => {
    if (connectionState !== "connected" || !activeProfileId || !workspacePath)
      return;
    const readyKey = `${activeProfileId}:${workspacePath}`;
    if (treeSessionReadyKey !== readyKey) return;
    const paths = [...expandedIds]
      .filter((path) => isAbsoluteWorkspacePath(path))
      .slice(0, 200);
    writeTreeSession(activeProfileId, workspacePath, paths);
    writeLastSession({
      profileId: activeProfileId,
      workspacePath,
      expandedPaths: paths,
    });
  }, [
    activeProfileId,
    connectionState,
    expandedIds,
    treeSessionReadyKey,
    workspacePath,
  ]);

  // Defensive: drop folder / workspace-root tabs if they ever land in openFiles
  // (stale localStorage, race during restore, etc.).
  useEffect(() => {
    if (!workspacePath) return;
    const rootNorm = normalizeRemotePath(workspacePath);
    const isBadTab = (path: string) =>
      !isBrowserTabKey(path) &&
      !isAgentLogTabKey(path) &&
      (normalizeRemotePath(path) === rootNorm ||
        isDirectoryEditorPath(path, workspacePath, treeItems, getItemPath));
    if (openFiles.some(isBadTab)) {
      setOpenFiles((current) => current.filter((path) => !isBadTab(path)));
    }
    if (selectedFile && isBadTab(selectedFile)) {
      setSelectedFile(null);
      setEditorValue("");
      setEditorImageUrl(null);
      setEditorEtag(null);
      setEditorDirty(false);
      setEditorError("");
      setEditorTruncated(false);
      setEditorLoading(false);
    }
  }, [openFiles, selectedFile, treeItems, workspacePath]);

  // Persist the bottom status-bar path across restarts (file or workspace root).
  useEffect(() => {
    if (connectionState !== "connected" || !activeProfileId) return;
    const path =
      (selectedFile && isAbsoluteWorkspacePath(selectedFile)
        ? selectedFile
        : null) ??
      (isAbsoluteWorkspacePath(workspacePath) ? workspacePath : "");
    if (!path) return;
    const patch: Parameters<typeof writeLastSession>[0] = {
      profileId: activeProfileId,
      selectedPath: path,
    };
    if (isAbsoluteWorkspacePath(workspacePath))
      patch.workspacePath = workspacePath;
    writeLastSession(patch);
  }, [activeProfileId, connectionState, selectedFile, workspacePath]);
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, []);

  const { loadDirectory, activateWorkspace } = useWorkspaceTreeLoading({
    connectionState,
    setExplorerError,
    clearRemoteWorkspace,
    setLoadingDirs,
    dirFingerprintsRef,
    setTreeItems,
    workspacePathRef,
    treeItemsRef,
    setLoadedDirs,
    loadedDirsRef,
    handleConnectionUnavailable,
    loadDirectoryRef,
    lastPersistedWorkspaceRef,
    setSavedProfiles,
    setExpandedIds,
    expandedIdsRef,
    setUsername,
    connectionStateRef,
    sessionRestoreGenRef,
    connectionUnavailableRef,
    setWorkspacePath,
    setConnectionState,
    activeProfileIdRef,
    setTreeSessionReadyKey,
    activateWorkspaceRef,
  });
  const {
    handleLoadSavedProfile,
    handleDeleteSavedProfile,
    saveServerName,
    saveDefaultWorkspace,
    prepareAgentWorkspace,
    openLocalWorkspace,
    updateServerPreferences,
    disconnectServer,
    forgetActiveServer,
  } = useWorkspaceProfiles({
    closeLoadDropdown,
    userOwnedConnectionRef,
    activeProfileIdRef,
    connectionStateRef,
    completePendingConnection,
    setShowConnectModal,
    requestHostVerification,
    setProfilesError,
    setSavedProfiles,
    host,
    port,
    username,
    setConnectionState,
    setActiveProfileId,
    setWorkspacePath,
    clearRemoteWorkspace,
    activeProfileId,
    setServerName,
    setUsername,
    activateWorkspace,
    workspaceKind,
    setExplorerError,
    setWorkspaceKind,
    setLocalRecentWorkspaces,
    setEditorError,
  });
  const { refreshDirectory, handleToggleDir, expandAllTreeFolders, collapseAllTreeFolders } = useWorkspaceTreeNavigation({
    workspacePathRef,
    workspacePath,
    loadDirectory,
    treeItemsRef,
    treeItems,
    connectionState,
    setExplorerError,
    clearRemoteWorkspace,
    expandedIds,
    setExpandedIds,
    loadedDirs,
    activeProfileIdRef,
    loadedDirsRef,
    expandedIdsRef,
  });

  const {
    rememberActiveEditor,
    requestRevealInTree,
    revealInTree,
    activateEditorFile,
  } = useWorkspaceEditorBuffers({
    treeUndoStackRef,
    selectedFile,
    editorBuffersRef,
    editorDirtyRef,
    editorError,
    editorEtagRef,
    editorImageUrlRef,
    editorTruncatedRef,
    editorValueRef,
    revealTokenRef,
    setRevealRequest,
    workspacePathRef,
    connectionStateRef,
    setExpandedIds,
    expandedIdsRef,
    loadedDirsRef,
    treeItemsRef,
    loadDirectory,
    setOpenFiles,
    setSelectedFile,
    setEditorLoading,
    setEditorError,
    setEditorDirty,
    setEditorImageUrl,
    setEditorValue,
    setEditorEtag,
    setEditorTruncated,
    selectedFileRef,
    editorLoadRequestRef,
    setAgentEditReviewTick,
    setMissingFiles,
  });
  const handleSelectFile = async (item: FileTreeItem) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return;
    }
    if (item.kind === "dir") return;
    // Clicked from the tree — already visible; no reveal flash/scroll.
    await activateEditorFile(getItemPath(item), true, { reveal: false });
  };

  useEffect(() => {
    if (connectionState !== "connected" || !activeProfileId || !workspacePath)
      return;

    const sessionKey = editorSessionStorageKey(activeProfileId, workspacePath);
    if (!appPreferences.restoreOpenFiles) {
      window.localStorage.removeItem(sessionKey);
      setEditorSessionReadyKey(sessionKey);
      return;
    }

    let cancelled = false;
    setEditorSessionReadyKey("");

    const restoreEditorSession = async () => {
      try {
        const raw = window.localStorage.getItem(sessionKey);
        const stored = raw
          ? (JSON.parse(raw) as {
            activeFile?: string | null;
            openFiles?: string[];
            cursor?: { line?: number; column?: number } | null;
          })
          : null;
        const last = readLastSession();
        const rootNorm = normalizeRemotePath(workspacePath);
        const isRestorableFile = (path: string) =>
          typeof path === "string" &&
          isAbsoluteWorkspacePath(path) &&
          !isBrowserTabKey(path) &&
          !isAgentLogTabKey(path) &&
          // Don't auto-reopen multi‑MB binaries (would re-download / crash).
          // Images are allowed (isKnownBinaryPath is false for them).
          !isKnownBinaryPath(path) &&
          // Workspace root / folders must never become editor tabs (phantom "www").
          !isDirectoryEditorPath(
            path,
            workspacePath,
            treeItemsRef.current,
            getItemPath,
          ) &&
          normalizeRemotePath(path) !== rootNorm;

        const underWorkspace = (path: string) => {
          if (!rootNorm) return false;
          return isUnderWorkspace(path, workspacePath);
        };

        let paths = [
          ...new Set((stored?.openFiles ?? []).filter(isRestorableFile)),
        ].slice(0, 20);

        const preferredFromStored =
          stored?.activeFile && isRestorableFile(stored.activeFile)
            ? stored.activeFile
            : null;
        const preferredFromLast =
          last.selectedPath &&
            last.profileId === activeProfileId &&
            underWorkspace(last.selectedPath) &&
            isRestorableFile(last.selectedPath)
            ? last.selectedPath
            : null;
        const preferredCandidate = preferredFromStored ?? preferredFromLast;

        // Ensure the active file is in the tab strip even if openFiles was incomplete.
        if (preferredCandidate && !paths.includes(preferredCandidate)) {
          paths = [...paths, preferredCandidate].slice(0, 20);
        }

        // Instant tab strip — one React update, not sequential activate per file.
        if (paths.length > 0) {
          setOpenFiles(paths);
          openFilesRef.current = paths;
        }

        const activeToOpen =
          (preferredCandidate && paths.includes(preferredCandidate)
            ? preferredCandidate
            : null) ??
          paths[0] ??
          null;

        // Load only the focused file so the editor lands once (no tab flash).
        if (!cancelled && activeToOpen) {
          await activateEditorFile(activeToOpen, false, { reveal: false });
          if (cancelled) return;

          const cursorLine =
            typeof stored?.cursor?.line === "number" && stored.cursor.line >= 1
              ? stored.cursor.line
              : null;
          const cursorCol =
            typeof stored?.cursor?.column === "number" &&
              stored.cursor.column >= 1
              ? stored.cursor.column
              : 1;
          if (cursorLine != null) {
            editorCursorRef.current = { line: cursorLine, column: cursorCol };
            // After content is in state, jump to prior caret (CodeMirror applies when not loading).
            requestEditorReveal(activeToOpen, cursorLine, cursorCol);
          }

          // One soft tree reveal for the file the user actually had open.
          void revealInTree(activeToOpen);
        }
        // Do not setSelectedFile(workspaceRoot) — status bar already falls back to workspacePath.
      } catch {
        window.localStorage.removeItem(sessionKey);
      } finally {
        if (!cancelled) setEditorSessionReadyKey(sessionKey);
      }
    };

    void restoreEditorSession();
    return () => {
      cancelled = true;
    };
  }, [
    activeProfileId,
    appPreferences.restoreOpenFiles,
    connectionState,
    workspacePath,
  ]);

  useEffect(() => {
    if (
      !appPreferences.restoreOpenFiles ||
      connectionState !== "connected" ||
      !activeProfileId ||
      !workspacePath
    )
      return;

    const sessionKey = editorSessionStorageKey(activeProfileId, workspacePath);
    if (editorSessionReadyKey !== sessionKey) return;
    const rootNorm = normalizeRemotePath(workspacePath);
    const isPersistedEditorFile = (
      path: string | null | undefined,
    ): path is string =>
      Boolean(
        path &&
        isAbsoluteWorkspacePath(path) &&
        !isBrowserTabKey(path) &&
        !isAgentLogTabKey(path) &&
        normalizeRemotePath(path) !== rootNorm &&
        !isDirectoryEditorPath(
          path,
          workspacePath,
          treeItemsRef.current,
          getItemPath,
        ),
      );
    const fileOnlyOpen = openFiles.filter(isPersistedEditorFile);
    const activeFile = isPersistedEditorFile(selectedFile)
      ? selectedFile
      : null;
    const cursor = activeFile
      ? {
        line: Math.max(1, editorCursorRef.current.line || 1),
        column: Math.max(1, editorCursorRef.current.column || 1),
      }
      : null;
    window.localStorage.setItem(
      sessionKey,
      JSON.stringify({
        activeFile,
        openFiles: fileOnlyOpen,
        cursor,
      }),
    );
  }, [
    activeProfileId,
    appPreferences.restoreOpenFiles,
    connectionState,
    editorSessionReadyKey,
    openFiles,
    selectedFile,
    workspacePath,
  ]);
  const { noteEditorCursor, closeEditorFile, updateBrowserTab, openBrowserUrl } = useWorkspaceEditorTabs({
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
  });

  const { saveSelectedFile, saveAllFiles, handleEditorChange } =
    useWorkspaceSaving({
      appPreferences,
      editorBuffersRef,
      selectedFileRef,
      setEditorValue,
      suppressEditorWatchUntilRef,
      editorEtagRef,
      editorValueRef,
      editorDirtyRef,
      autoSavePendingRef,
      setDirtyFiles,
      setEditorEtag,
      setEditorDirty,
      setEditorError,
      dirFingerprintsRef,
      saveEditorBufferRef,
      selectedFile,
      editorDirty,
      editorLoading,
      editorTruncated,
      editorEtag,
      connectionState,
      requestWritePermission,
      setEditorLoading,
      editorTruncatedRef,
      editorImageUrlRef,
      dirtyFiles,
      connectionStateRef,
      autoSaveTimerRef,
      autoSaveInFlightRef,
    });
  const { handleRefreshTree, reloadEditorFromRemote } = useWorkspaceRefresh({
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
    editorValueRef,
    editorImageUrlRef,
    editorTruncatedRef,
  });
  const { handleOpenWorkspaceRoot, handleOpenHomeFolder, handleOpenRemotePath, openRemoteDirectory } = useWorkspaceFolderNavigation({
    connectionState,
    setExplorerError,
    clearRemoteWorkspace,
    setEditorError,
    activateWorkspace,
    username,
    workspacePath,
    treeItemsRef,
    setExpandedIds,
    expandedIdsRef,
    loadDirectory,
    requestRevealInTree,
    activateEditorFile,
    connectionStateRef,
    activateWorkspaceRef,
  });

  const [createRequest, setCreateRequest] = useState<{
    kind: "file" | "folder";
    token: number;
  } | null>(null);
  const createRequestTokenRef = useRef(0);

  const handleNewFile = () => {
    openBlankFile({
      editorBuffersRef,
      setOpenFiles,
      setSelectedFile,
      setEditorValue,
      setEditorImageUrl,
      setEditorEtag,
      setEditorDirty,
      setEditorTruncated,
      setEditorError,
      setEditorLoading,
    });
  };

  const handleNewFolder = () => {
    if (connectionState !== "connected" || !workspacePath) {
      setExplorerError(
        connectionState === "connected"
          ? "Select a workspace first."
          : "Connect to a server first.",
      );
      return;
    }
    createRequestTokenRef.current += 1;
    setCreateRequest({ kind: "folder", token: createRequestTokenRef.current });
  };

  /** Called by FileTree after the user types a name in the inline create row. */
  const {
    acceptAgentEdit,
    commitAgentEditContent,
    rejectAgentEdit,
    getPendingAgentEditReview,
  } = useWorkspaceAgentReview({
    clearAgentEditBaseline,
    selectedFileRef,
    setEditorDirty,
    setDirtyFiles,
    editorBuffersRef,
    setAgentEditReviewTick,
    connectionStateRef,
    setEditorError,
    suppressEditorWatchUntilRef,
    editorEtagRef,
    setEditorValue,
    setEditorEtag,
    setEditorImageUrl,
    setEditorTruncated,
    agentEditReviewTick,
  });
  const {
    createFileAt,
    createFolderAt,
    handleRenameTreeItem,
    handleMoveTreeItem,
    handleCopyTreeItem,
    handleCutTreeItem,
    handleDuplicateTreeItem,
    uploadLocalFiles,
    handlePasteTreeItem,
    applyDeletedPaths,
    undoTreeAction,
    handleDeleteTreeItem,
    handleDeleteTreeItems,
  } = useWorkspaceFileOperations({
    connectionState,
    workspacePath,
    setExplorerError,
    requestWritePermission,
    refreshDirectory,
    setExpandedIds,
    setSelectedFile,
    setOpenFiles,
    setEditorValue,
    setEditorImageUrl,
    setEditorEtag,
    setEditorDirty,
    setEditorTruncated,
    setEditorError,
    editorBuffersRef,
    revealInTree,
    setLoadedDirs,
    setLoadingDirs,
    setDirtyFiles,
    treeItems,
    rememberActiveEditor,
    setTreeItems,
    expandedIds,
    loadedDirs,
    loadDirectory,
    treeClipboardRef,
    setTreeClipboard,
    appPreferences,
    workspacePathRef,
    treeItemsRef,
    openFilesRef,
    expandedIdsRef,
    requestRevealInTree,
    selectedFileRef,
    selectedFile,
    loadedDirsRef,
    connectionStateRef,
    treeClipboard,
    setMissingFiles,
    editorLoadRequestRef,
    activateEditorFile,
    setEditorLoading,
    treeUndoStackRef,
    setTreeUndoDepth,
    suppressEditorWatchUntilRef,
    dirtyFiles,
  });
  const { requestEditorReveal, applyAgentFileStream, openRemoteFile } =
    useWorkspaceAgentStream({
      editorRevealTokenRef,
      setEditorReveal,
      connectionStateRef,
      clearAgentEditBaseline,
      reloadEditorFromRemoteRef,
      setMissingFiles,
      refreshDirectory,
      applyDeletedPaths,
      workspacePathRef,
      dirFingerprintsRef,
      loadDirectory,
      treeItemsRef,
      selectedFileRef,
      setEditorError,
      editorBuffersRef,
      setOpenFiles,
      setDirtyFiles,
      setAgentStreamingPaths,
      setSelectedFile,
      setEditorValue,
      setEditorImageUrl,
      setEditorEtag,
      setEditorDirty,
      setEditorTruncated,
      setEditorLoading,
      editorDirtyRef,
      suppressEditorWatchUntilRef,
      editorEtagRef,
      activateEditorFile,
      openFilesRef,
      rememberActiveEditor,
      captureAgentEditBaseline,
      agentEditBaseRef,
      revealInTree,
      setExplorerError,
      clearRemoteWorkspace,
      activateWorkspaceRef,
    });
  const selectSshKeyFile = async () => {
    try {
      const colorideDesktop = window.colorideDesktop;

      if (colorideDesktop?.selectFile) {
        const selectedPath = await colorideDesktop.selectFile();
        if (selectedPath) {
          setSshKeyPath(selectedPath);
          clearErrors("sshKey");
        }
        return;
      }

      if (sshKeyFileInputRef.current) {
        sshKeyFileInputRef.current.click();
      } else {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pem,.key,.ppk,application/x-pem-file";
        input.onchange = (ev: Event) => {
          const target = ev.target as HTMLInputElement;
          const file = target.files?.[0];
          if (file) {
            setSshKeyPath(`[selected] ${file.name}`);
            clearErrors("sshKey");
          }
        };
        input.click();
      }
    } catch (err) {
      console.error("Failed to select SSH key file", err);
      const path = window.prompt("Path to private key (or filename):");
      if (path) setSshKeyPath(path);
    }
  };

  const handleSshKeyFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      setSshKeyPath(`[selected] ${file.name}`);
      clearErrors("sshKey");
    }
    event.target.value = "";
  };

  const handleServerStepSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateServerStep()) {
      return;
    }
    clearErrors("connect");
    // Server → credentials → connect.
    clearErrors("connect");
    setConnectStep("credentials");
  };

  const handleConnectSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!validateCredentialsStep()) {
      return;
    }
    clearErrors("connect");
    await continueConnectWithAccess();
  };

  const continueConnectWithAccess = async () => {
    if (!validateForm()) {
      setConnectStep("credentials");
      return;
    }
    const trimmedServerName = serverName.trim();
    const trimmedHost = host.trim();
    const trimmedUsername = username.trim();
    const trimmedPort = Number(port.trim() || "22");
    try {
      await hydrateRuntimeFromDesktop();
      await requestHostVerification({
        kind: "direct",
        connection: {
          name: trimmedServerName,
          host: trimmedHost,
          port: trimmedPort,
          username: trimmedUsername,
          password: authMethod === "password" ? password : undefined,
          privateKeyPath: authMethod === "ssh-key" ? sshKeyPath : undefined,
          privateKeyPassphrase:
            authMethod === "ssh-key" && keyPassphrase
              ? keyPassphrase
              : undefined,
        },
      });
    } catch (error) {
      const message = messageFromError(error);
      setConnectionState("failed");
      clearRemoteWorkspace();
      setErrors((current) => ({ ...current, connect: message }));
    }
  };

  const backToServerStep = () => {
    setConnectStep("server");
    clearErrors("connect");
  };

  const backToCredentialsStep = () => {
    setConnectStep("credentials");
    clearErrors("connect");
  };

  return {
    activeProfileId,
    authMethod,
    cancelWorkspaceSelection,
    clearErrors,
    cancelHostKeyPrompt,
    closeEditorFile,
    closeLoadDropdown,
    connectionState,
    dirtyFiles,
    agentStreamingPaths,
    missingFiles,
    disconnectServer,
    editorDirty,
    editorError,
    editorLoading,
    editorImageUrl,
    editorReadOnly:
      (selectedFile != null && isBrowserTabKey(selectedFile)) ||
      (selectedFile != null && isAgentLogTabKey(selectedFile)) ||
      appPreferences.permissionMode === "read-only" ||
      editorImageUrl !== null ||
      editorTruncated ||
      editorLoading ||
      (editorEtag === null && !isUntitledPath(selectedFile)),
    editorTruncated,
    editorValue,
    errors,
    expandedIds,
    explorerError,
    forgetActiveServer,
    handleConnectSubmit,
    handleServerStepSubmit,
    handleEditorChange,
    handleLoadSavedProfile,
    handleDeleteSavedProfile,
    handleConnectionUnavailable,
    handleNewFile,
    handleNewFolder,
    createFileAt,
    createFolderAt,
    createRequest,
    handleRenameTreeItem,
    handleMoveTreeItem,
    handleCutTreeItem,
    handleCopyTreeItem,
    handleDuplicateTreeItem,
    handlePasteTreeItem,
    uploadLocalFiles,
    treeClipboard,
    handleDeleteTreeItem,
    handleDeleteTreeItems,
    undoTreeAction,
    treeCanUndo: treeUndoDepth > 0,
    handleOpenHomeFolder,
    handleOpenRemotePath,
    handleOpenWorkspaceRoot,
    handleRefreshTree,
    treeRefreshing,
    revealInTree,
    revealRequest,
    editorReveal,
    handleSelectFile,
    handleSshKeyFileChange,
    handleToggleDir,
    expandAllTreeFolders,
    collapseAllTreeFolders,
    host,
    hostKeyPrompt,
    hostKeyTrusting,
    isDropdownHiding,
    keyDropdownRef,
    keyPassphrase,
    loadSavedProfiles,
    loadButtonRef,
    loadDropdownRef,
    loadingDirs,
    openLoadDropdown,
    openFiles,
    browserTabs,
    openBrowserUrl,
    openRemoteDirectory,
    applyRenameFiles: async (
      files: { path: string; edits: LineTextEdit[] }[],
    ) => {
      for (const file of files) {
        if (!file.path || !file.edits.length) continue;
        const selected = selectedFileRef.current;
        const openBuf =
          file.path === selected
            ? editorValue
            : editorBuffersRef.current.get(file.path)?.value;
        let text = openBuf;
        if (text == null) {
          try {
            const read = await api.readFile(file.path);
            text = decodeBase64ToText(read.content);
          } catch (error) {
            console.warn("[rename] read failed", file.path, error);
            continue;
          }
        }
        const next = applyLineEdits(text, file.edits);
        if (next === text) continue;
        if (file.path === selected || editorBuffersRef.current.has(file.path)) {
          const prev = editorBuffersRef.current.get(file.path);
          editorBuffersRef.current.set(file.path, {
            dirty: true,
            error: prev?.error ?? "",
            etag: prev?.etag ?? (file.path === selected ? editorEtag : null),
            imageUrl: null,
            truncated: false,
            value: next,
            agentStreaming: false,
          });
          setDirtyFiles((current) => new Set(current).add(file.path));
          lspSyncChange(file.path, next);
          if (file.path === selected) {
            setEditorValue(next);
            setEditorDirty(true);
          }
          continue;
        }
        try {
          await api.writeFile(file.path, encodeTextToBase64(next), null);
          lspSyncChange(file.path, next);
        } catch (error) {
          console.warn("[rename] write failed", file.path, error);
        }
      }
    },
    openAgentLogDump: (fileName: string, content: string) => {
      const path = agentLogTabKey(fileName);
      editorBuffersRef.current.set(path, {
        dirty: false,
        error: "",
        etag: "agent-log",
        imageUrl: null,
        truncated: false,
        value: content,
        agentStreaming: false,
      });
      void activateEditorFile(path, true, { reveal: false });
      return path;
    },
    openRemoteFile,
    openLocalWorkspace,
    applyAgentFileStream,
    acceptAgentEdit,
    rejectAgentEdit,
    commitAgentEditContent,
    getPendingAgentEditReview,
    agentEditReviewTick,
    updateBrowserTab,
    password,
    port,
    profilesError,
    profilesLoading,
    localRecentWorkspaces,
    savedProfiles,
    saveSelectedFile,
    saveAllFiles,
    reloadEditorFromRemote,
    saveDefaultWorkspace,
    prepareAgentWorkspace,
    saveServerName,
    selectEditorFile: activateEditorFile,
    noteEditorCursor,
    selectedFile,
    selectSshKeyFile,
    serverName,
    setAuthMethod,
    setHost,
    setKeyPassphrase,
    setPassword,
    setPort,
    setServerName,
    setShowConnectModal: (open: boolean) => {
      setShowConnectModal(open);
      if (open) {
        setConnectStep("server");
        clearErrors("connect");
      } else {
        setConnectStep("server");
      }
    },
    connectStep,
    setConnectStep,
    continueConnectWithAccess,
    backToServerStep,
    backToCredentialsStep,
    setShowKeyDropdown,
    setShowPassword,
    setSshKeyPath,
    setUsername,
    showConnectModal,
    showKeyDropdown,
    showLoadDropdown,
    showPassword,
    sshKeyFileInputRef,
    sshKeyPath,
    treeItems,
    trustPendingHostKey,
    username,
    updateServerPreferences,
    workspacePath,
    workspaceKind,
  };
}

export type ServerWorkspaceController = ReturnType<typeof useServerWorkspace>;
