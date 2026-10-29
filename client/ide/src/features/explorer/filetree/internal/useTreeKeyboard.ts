import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { workspaceBasename } from "../../../../shared/lib/workspacePath";
import {
  getTreeItemPath,
  isEditableTarget,
  makeWorkspaceRootItem,
  modKey,
} from "./model";
import { type CreateDraft, type FileTreeItem } from "./types";

interface Dependencies {
  workspaceExpanded: boolean;
  renamingItem: FileTreeItem | null;
  createDraft: CreateDraft | null;
  treeRootRef: RefObject<HTMLElement | null>;
  treeInteractionActiveRef: RefObject<boolean>;
  focusedPathRef: RefObject<string | null>;
  selectedPathsRef: RefObject<Set<string>>;
  findItemByPath: (path: string | null | undefined) => FileTreeItem | null;
  selectedPath: string | null | undefined;
  workspacePath: string | null | undefined;
  copyPath: (item: FileTreeItem, relative: boolean) => Promise<void>;
  setWorkspaceExpanded: Dispatch<SetStateAction<boolean>>;
  runAction: (callback: () => unknown | Promise<unknown>) => Promise<void>;
  onExpandAllFolders: (() => void | Promise<void>) | undefined;
  collapseAllFolders: () => void;
  canDelete: boolean;
  isWorkspaceRootItem: (item: FileTreeItem | null | undefined) => boolean;
  resolveSelectedItems: (primary?: FileTreeItem | null) => FileTreeItem[];
  deleteItems: (items: FileTreeItem[]) => Promise<void>;
  onRenameItem:
    ((item: FileTreeItem, newName: string) => Promise<boolean>) | undefined;
  beginRename: (item: FileTreeItem) => void;
  clearMultiSelection: () => void;
  setFocusedPath: Dispatch<SetStateAction<string | null>>;
  selectionAnchorRef: RefObject<string | null>;
  onUndo: (() => Promise<boolean> | boolean) | undefined;
  canUndo: boolean;
  hasClipboardActions: boolean;
  visibleItems: FileTreeItem[];
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  onCopyItem: ((item: FileTreeItem) => boolean | void) | undefined;
  runCopy: (item: FileTreeItem) => void;
  onCutItem: ((item: FileTreeItem) => boolean | void) | undefined;
  runCut: (item: FileTreeItem) => void;
  onDuplicateItem: ((item: FileTreeItem) => Promise<boolean>) | undefined;
  runDuplicate: (item: FileTreeItem) => Promise<void>;
  onPasteItem: ((contextItem?: FileTreeItem) => Promise<boolean>) | undefined;
  runPaste: (contextItem?: FileTreeItem) => Promise<void>;
  canPaste: boolean;
}
export function useTreeKeyboard({
  workspaceExpanded,
  renamingItem,
  createDraft,
  treeRootRef,
  treeInteractionActiveRef,
  focusedPathRef,
  selectedPathsRef,
  findItemByPath,
  selectedPath,
  workspacePath,
  copyPath,
  setWorkspaceExpanded,
  runAction,
  onExpandAllFolders,
  collapseAllFolders,
  canDelete,
  isWorkspaceRootItem,
  resolveSelectedItems,
  deleteItems,
  onRenameItem,
  beginRename,
  clearMultiSelection,
  setFocusedPath,
  selectionAnchorRef,
  onUndo,
  canUndo,
  hasClipboardActions,
  visibleItems,
  setSelectedPaths,
  onCopyItem,
  runCopy,
  onCutItem,
  runCut,
  onDuplicateItem,
  runDuplicate,
  onPasteItem,
  runPaste,
  canPaste,
}: Dependencies) {
  // Tree shortcuts (clipboard + multi-delete + rename).
  // Prefer DOM focus inside the tree, but also honor recent tree interaction /
  // highlighted rows when expand or virtualization drops focus to <body>.
  useEffect(() => {
    if (!workspaceExpanded) return;

    const ownsTreeShortcut = (event: KeyboardEvent) => {
      if (renamingItem || createDraft || isEditableTarget(event.target))
        return false;
      const root = treeRootRef.current;
      if (!root) return false;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return true;

      // Don't steal copy/paste from the editor, terminal, chat, or other inputs.
      if (target instanceof Element) {
        if (
          target.closest(
            ".cm-editor, .xterm, [data-terminal-surface='true'], [contenteditable='true'], .agent-timeline, .agent-timeline-shell, .agent-markdown, .agent-md-pre-wrap, .agent-md-pre, .agent-assistant-message, .agent-user-message, .agent-turn",
          )
        ) {
          return false;
        }
      }

      const selection =
        typeof window !== "undefined" ? window.getSelection() : null;
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        return false;
      }

      // Last click was in the tree (even if focus was later lost to body).
      if (treeInteractionActiveRef.current) return true;

      // Fallback: a tree row is still highlighted.
      return Boolean(
        focusedPathRef.current || selectedPathsRef.current.size > 0,
      );
    };

    const resolveShortcutItem = () => {
      const focused = findItemByPath(focusedPathRef.current);
      if (focused) return focused;
      if (selectedPathsRef.current.size === 1) {
        const only = findItemByPath([...selectedPathsRef.current][0]);
        if (only) return only;
      }
      // Fall back to open editor path as a synthetic file so paste uses its parent folder.
      if (selectedPath) {
        const known = findItemByPath(selectedPath);
        if (known) return known;
        const name = workspaceBasename(selectedPath);
        return {
          id: selectedPath,
          path: selectedPath,
          name,
          kind: "file" as const,
          depth: 0,
        };
      }
      return null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!ownsTreeShortcut(event)) return;
      if (modKey(event) && event.altKey && event.key.toLowerCase() === "c") {
        const item =
          focusedPathRef.current === workspacePath && workspacePath
            ? makeWorkspaceRootItem(workspacePath)
            : resolveShortcutItem();
        if (item) {
          event.preventDefault();
          void copyPath(item, event.shiftKey);
        }
        return;
      }
      if (
        modKey(event) &&
        !event.altKey &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft")
      ) {
        event.preventDefault();
        if (event.key === "ArrowRight") {
          setWorkspaceExpanded(true);
          void runAction(() => onExpandAllFolders?.());
        } else collapseAllFolders();
        return;
      }

      // Delete / Backspace → bulk or single delete of current selection.
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !modKey(event) &&
        !event.altKey
      ) {
        if (!canDelete) return;
        const primary = resolveShortcutItem();
        // Never delete the workspace root via keyboard.
        if (primary && isWorkspaceRootItem(primary)) return;
        const items = resolveSelectedItems(primary).filter(
          (item) => !isWorkspaceRootItem(item),
        );
        if (items.length === 0) return;
        event.preventDefault();
        void deleteItems(items);
        return;
      }

      // Enter / F2 → rename the focused/selected row (not workspace root).
      if (
        (event.key === "Enter" || event.key === "F2") &&
        !modKey(event) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (!onRenameItem) return;
        const item = resolveShortcutItem();
        if (!item || isWorkspaceRootItem(item)) return;
        // Multi-select: only rename when a single item is targeted.
        if (selectedPathsRef.current.size > 1) return;
        event.preventDefault();
        beginRename(item);
        return;
      }

      // Escape clears multi-select and workspace-root card selection.
      if (event.key === "Escape") {
        if (selectedPathsRef.current.size > 0) {
          event.preventDefault();
          clearMultiSelection();
          return;
        }
        if (workspacePath && focusedPathRef.current === workspacePath) {
          event.preventDefault();
          setFocusedPath(null);
          selectionAnchorRef.current = null;
          return;
        }
      }

      // Ctrl/Cmd+Z → undo the last tree operation (paste, move, or delete).
      if (
        modKey(event) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z"
      ) {
        if (!onUndo || !canUndo) return;
        event.preventDefault();
        event.stopPropagation();
        void onUndo();
        return;
      }

      if (!hasClipboardActions) return;
      if (!modKey(event) || event.altKey) return;

      const key = event.key.toLowerCase();
      if (
        key !== "c" &&
        key !== "v" &&
        key !== "d" &&
        key !== "a" &&
        key !== "x"
      )
        return;

      if (key === "a") {
        // Select all visible rows.
        event.preventDefault();
        const paths = visibleItems.map(getTreeItemPath);
        setSelectedPaths(new Set(paths));
        if (paths.length > 0) {
          selectionAnchorRef.current = paths[0] ?? null;
          setFocusedPath(paths[paths.length - 1] ?? null);
        }
        return;
      }

      const item = resolveShortcutItem();
      if (key === "c") {
        const selection =
          typeof window !== "undefined" ? window.getSelection() : null;
        if (selection && !selection.isCollapsed && selection.toString()) {
          return;
        }
        // Don't copy the whole workspace root as a tree clipboard entry.
        if (!onCopyItem || !item || isWorkspaceRootItem(item)) return;
        event.preventDefault();
        runCopy(item);
        return;
      }
      if (
        key === "x" &&
        onCutItem &&
        item &&
        !isWorkspaceRootItem(item) &&
        selectedPathsRef.current.size <= 1
      ) {
        event.preventDefault();
        runCut(item);
        return;
      }
      if (key === "d") {
        if (!onDuplicateItem || !item || isWorkspaceRootItem(item)) return;
        event.preventDefault();
        void runDuplicate(item);
        return;
      }
      if (key === "v") {
        if (!onPasteItem) return;
        event.preventDefault();
        // Folder selected → paste inside it.
        // File selected → paste into that file's parent folder.
        // Root card → paste at workspace root.
        // Also tries OS clipboard images when the internal tree clipboard is empty.
        void runPaste(item ?? undefined);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    hasClipboardActions,
    canDelete,
    canUndo,
    workspaceExpanded,
    renamingItem,
    createDraft,
    selectedPath,
    visibleItems,
    canPaste,
    workspacePath,
    onCopyItem,
    onDuplicateItem,
    onPasteItem,
    onRenameItem,
    onUndo,
    findItemByPath,
    resolveSelectedItems,
    clearMultiSelection,
    runCopy,
    runCut,
    onCutItem,
    onExpandAllFolders,
    runDuplicate,
    runPaste,
    deleteItems,
    isWorkspaceRootItem,
    beginRename,
  ]);
}
