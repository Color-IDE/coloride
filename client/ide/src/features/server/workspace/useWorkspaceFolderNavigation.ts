import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  isAbsoluteWorkspacePath,
  trimTrailingSeparators,
} from "../../../shared/lib/workspacePath";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  normalizeRemoteRoot
} from "./connectionValidation";
import {
  getAncestorDirsUnderRoot,
  getItemPath,
  getParentPath,
  isUnderWorkspace,
  itemDepthUnderRoot
} from "./treeModel";
import {
  type ConnectionState
} from "./types";

interface Dependencies {
  connectionState: ConnectionState;
  setExplorerError: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  setEditorError: Dispatch<SetStateAction<string>>;
  activateWorkspace: (rootPath: string, options?: { persist?: boolean; forceReload?: boolean; skipAccessSetup?: boolean; }) => Promise<boolean>;
  username: string;
  workspacePath: string;
  treeItemsRef: RefObject<FileTreeItem[]>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
  requestRevealInTree: (path: string) => void;
  activateEditorFile: (path: string, rememberCurrent?: boolean, options?: { reveal?: boolean; }) => Promise<boolean | undefined>;
  connectionStateRef: RefObject<ConnectionState>;
  activateWorkspaceRef: RefObject<(path: string, options?: { persist?: boolean; forceReload?: boolean; skipAccessSetup?: boolean; }) => Promise<boolean>>;
}

export function useWorkspaceFolderNavigation({
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
}: Dependencies) {

  const handleOpenWorkspaceRoot = async () => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return;
    }

    setEditorError("");
    await activateWorkspace("/");
  };

  const handleOpenHomeFolder = async () => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return;
    }

    const homePath = normalizeRemoteRoot(
      "",
      username && username !== "root" ? username : "coloride",
    );
    setEditorError("");
    await activateWorkspace(homePath);
  };

  const handleOpenRemotePath = async () => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return;
    }

    const rawPath = window.prompt("Remote path to open", workspacePath || "/");
    if (!rawPath) return;

    const path = rawPath.trim();
    if (!path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
      setExplorerError("Remote path must be an absolute path.");
      return;
    }

    setExplorerError("");
    setEditorError("");

    // Inside current workspace: open file (or expand dir) without resetting the explorer root.
    if (workspacePath && isUnderWorkspace(path, workspacePath)) {
      const known = treeItemsRef.current.find(
        (item) => getItemPath(item) === path,
      );
      if (known?.kind === "dir" || path === workspacePath) {
        setExpandedIds((current) => {
          const next = new Set(current);
          for (const dir of getAncestorDirsUnderRoot(path, workspacePath))
            next.add(dir);
          next.add(path);
          expandedIdsRef.current = next;
          return next;
        });
        if (path === workspacePath) {
          await loadDirectory(path, 0, true, false, { quiet: true });
        } else {
          await loadDirectory(
            path,
            itemDepthUnderRoot(path, workspacePath) + 1,
            false,
            false,
            { quiet: true },
          );
        }
        requestRevealInTree(path);
        return;
      }
      await activateEditorFile(path, true, { reveal: true });
      return;
    }

    const openedAsDirectory = await loadDirectory(path, 0, true);
    if (openedAsDirectory) {
      await activateWorkspace(path, { persist: true, forceReload: true });
      return;
    }

    const parent = getParentPath(path);
    const loadedParent = await activateWorkspace(parent, {
      persist: true,
      forceReload: true,
    });
    if (!loadedParent) return;
    await activateEditorFile(path, true, { reveal: true });
  };

  const openRemoteDirectory = async (path: string) => {
    if (connectionStateRef.current !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const normalized = trimTrailingSeparators(path.trim()) || "/";
    if (!isAbsoluteWorkspacePath(normalized)) {
      setExplorerError("Workspace path must be absolute.");
      return false;
    }

    setExplorerError("");
    setEditorError("");
    return activateWorkspaceRef.current(normalized, {
      persist: true,
      forceReload: true,
    });
  };
  return { handleOpenWorkspaceRoot, handleOpenHomeFolder, handleOpenRemotePath, openRemoteDirectory };
}
