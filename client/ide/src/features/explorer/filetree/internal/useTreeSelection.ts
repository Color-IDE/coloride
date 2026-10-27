import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { getTreeItemPath, isPathOrDescendant } from "./model";
import { type FileTreeItem } from "./types";

interface Dependencies {
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  selectionAnchorRef: RefObject<string | null>;
  setFocusedPath: Dispatch<SetStateAction<string | null>>;
  focusedPath: string | null;
  visibleItems: FileTreeItem[];
  selectedPaths: Set<string>;
  sourceItems: FileTreeItem[];
}
export function useTreeSelection({
  setSelectedPaths,
  selectionAnchorRef,
  setFocusedPath,
  focusedPath,
  visibleItems,
  selectedPaths,
  sourceItems,
}: Dependencies) {
  const clearMultiSelection = useCallback(() => {
    setSelectedPaths(new Set());
    selectionAnchorRef.current = null;
  }, []);

  const selectOnlyPath = useCallback((path: string) => {
    setSelectedPaths(new Set([path]));
    selectionAnchorRef.current = path;
    setFocusedPath(path);
  }, []);

  const togglePathInSelection = useCallback((path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    selectionAnchorRef.current = path;
    setFocusedPath(path);
  }, []);

  const selectVisibleRange = useCallback(
    (toPath: string) => {
      const anchor = selectionAnchorRef.current ?? focusedPath ?? toPath;
      const paths = visibleItems.map(getTreeItemPath);
      const fromIndex = paths.indexOf(anchor);
      const toIndex = paths.indexOf(toPath);
      if (fromIndex < 0 || toIndex < 0) {
        selectOnlyPath(toPath);
        return;
      }
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      setSelectedPaths(new Set(paths.slice(start, end + 1)));
      setFocusedPath(toPath);
    },
    [visibleItems, focusedPath, selectOnlyPath],
  );

  /** Resolve multi-select items, collapsing nested paths under selected parents. */
  const resolveSelectedItems = useCallback(
    (primary?: FileTreeItem | null) => {
      const paths = new Set(selectedPaths);
      if (primary) paths.add(getTreeItemPath(primary));
      if (paths.size === 0 && focusedPath) paths.add(focusedPath);

      const ordered = sourceItems.filter((item) =>
        paths.has(getTreeItemPath(item)),
      );
      // Prefer roots: if both a folder and its child are selected, only keep the folder.
      const roots: FileTreeItem[] = [];
      for (const item of ordered) {
        const path = getTreeItemPath(item);
        const covered = roots.some((root) =>
          isPathOrDescendant(path, getTreeItemPath(root)),
        );
        if (!covered) roots.push(item);
      }
      return roots;
    },
    [selectedPaths, focusedPath, sourceItems],
  );

  return {
    clearMultiSelection,
    selectOnlyPath,
    resolveSelectedItems,
    selectVisibleRange,
    togglePathInSelection,
  };
}
