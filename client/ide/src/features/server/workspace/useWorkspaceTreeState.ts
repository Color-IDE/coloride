import { useEffect, useRef, useState } from "react";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  type TreeUndoEntry
} from "./types";

export function useWorkspaceTreeState() {
  const [explorerError, setExplorerError] = useState("");
  const [treeItems, setTreeItems] = useState<FileTreeItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(() => new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());

  const treeItemsRef = useRef<FileTreeItem[]>([]);

  const expandedIdsRef = useRef<Set<string>>(new Set());

  const loadedDirsRef = useRef<Set<string>>(new Set());

  const dirFingerprintsRef = useRef(new Map<string, string>());

  const treeRefreshInFlightRef = useRef(false);

  const autoRefreshTimerRef = useRef<number | null>(null);

  const remoteWatchCursorRef = useRef(0);

  const remoteWatchInFlightRef = useRef(false);

  const refreshExpandedTreeRef = useRef<
    (options?: { quiet?: boolean; force?: boolean }) => Promise<boolean>
  >(async () => false);

  const loadDirectoryRef = useRef<
    (
      path: string,
      depth: number,
      replaceRoot?: boolean,
      allowDuringConnect?: boolean,
      options?: { quiet?: boolean; force?: boolean },
    ) => Promise<boolean>
  >(async () => false);

  const revealTokenRef = useRef(0);

  useEffect(() => {
    treeItemsRef.current = treeItems;
  }, [treeItems]);

  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  useEffect(() => {
    loadedDirsRef.current = loadedDirs;
  }, [loadedDirs]);

  /** Gates tree-session writes so empty expandedIds during boot don't wipe last session. */
  const [treeSessionReadyKey, setTreeSessionReadyKey] = useState("");

  const treeUndoStackRef = useRef<TreeUndoEntry[]>([]);

  const [treeUndoDepth, setTreeUndoDepth] = useState(0);

  const treeClipboardRef = useRef<{
    path: string;
    name: string;
    kind: FileTreeItem["kind"];
    mode?: "copy" | "cut";
  } | null>(null);

  const [treeClipboard, setTreeClipboard] = useState<{
    path: string;
    name: string;
    kind: FileTreeItem["kind"];
    mode?: "copy" | "cut";
  } | null>(null);
  return {
    treeClipboardRef, treeClipboard, treeUndoStackRef, treeUndoDepth, setTreeUndoDepth, setTreeClipboard,
    treeSessionReadyKey,
    setTreeSessionReadyKey,
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
  };
}
