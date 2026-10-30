import type { Dispatch, RefObject, SetStateAction } from "react";
import { useRef } from "react";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  getItemPath,
  itemDepthUnderRoot
} from "./treeModel";
import {
  type ConnectionState
} from "./types";

interface Dependencies {
  workspacePathRef: RefObject<string>;
  workspacePath: string;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  treeItems: FileTreeItem[];
  connectionState: ConnectionState;
  setExplorerError: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  expandedIds: Set<string>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  loadedDirs: Set<string>;
  activeProfileIdRef: RefObject<string | null>;
  loadedDirsRef: RefObject<Set<string>>;
  expandedIdsRef: RefObject<Set<string>>;
}

export function useWorkspaceTreeNavigation({
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
  activeProfileIdRef,
  loadedDirsRef,
  expandedIdsRef,
}: Dependencies) {

  const refreshDirectory = async (path: string) => {
    const root = workspacePathRef.current || workspacePath;
    if (path === root) {
      await loadDirectory(root, 0, true, false, { quiet: true });
      return;
    }

    const item =
      treeItemsRef.current.find(
        (candidate) => getItemPath(candidate) === path,
      ) ?? treeItems.find((candidate) => getItemPath(candidate) === path);
    const depth = item
      ? item.depth + 1
      : root
        ? itemDepthUnderRoot(path, root) + 1
        : 0;
    await loadDirectory(path, depth, false, false, { quiet: true });
  };

  const pendingExpansions = useRef(new Map<string, Promise<boolean>>());

  const handleToggleDir = (item: FileTreeItem) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return;
    }

    const path = getItemPath(item);
    const isExpanded = expandedIds.has(path);

    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

    // Cached children are already in the flat tree: expanding needs no I/O.
    // The workspace watcher refreshes changes in the background.
    if (!isExpanded && !loadedDirsRef.current.has(path)) {
      const key = JSON.stringify([activeProfileIdRef.current, workspacePathRef.current, path]);
      if (!pendingExpansions.current.has(key)) {
        const pending = loadDirectory(path, item.depth + 1, false, false);
        pendingExpansions.current.set(key, pending);
        void pending.finally(() => pendingExpansions.current.delete(key));
      }
    }
  };

  const expandTreeGenerationRef = useRef(0);
  const expandAllTreeFolders = async () => {
    const generation = ++expandTreeGenerationRef.current;
    const root = workspacePathRef.current;
    const profile = activeProfileIdRef.current;
    const seen = new Set<string>();
    while (
      root &&
      root === workspacePathRef.current &&
      profile === activeProfileIdRef.current &&
      generation === expandTreeGenerationRef.current
    ) {
      const next = treeItemsRef.current.find(
        (item) => item.kind === "dir" && !seen.has(getItemPath(item)),
      );
      if (!next) break;
      const path = getItemPath(next);
      seen.add(path);
      setExpandedIds((current) => new Set(current).add(path));
      if (!loadedDirsRef.current.has(path))
        await loadDirectory(path, next.depth + 1, false, false, {
          quiet: true,
        });
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    }
  };

  /** Collapse every open folder in the explorer list (header workspace stays). */
  const collapseAllTreeFolders = () => {
    expandTreeGenerationRef.current += 1;
    setExpandedIds(new Set());
    expandedIdsRef.current = new Set();
  };
  return { refreshDirectory, handleToggleDir, expandAllTreeFolders, collapseAllTreeFolders };
}
