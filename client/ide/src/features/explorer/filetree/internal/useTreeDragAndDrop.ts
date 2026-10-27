import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  TREE_DND_MIME,
  externalDropDestination,
  filesFromDataTransfer,
  getParentPath,
  getTreeItemPath,
  isExternalFileDrag,
  resolveDropTarget,
} from "./model";
import { type FileTreeItem } from "./types";

interface Dependencies {
  dragSourceRef: RefObject<FileTreeItem | null>;
  setDraggingPath: Dispatch<SetStateAction<string | null>>;
  setDropTargetPath: Dispatch<SetStateAction<string | null>>;
  setExternalDragOver: Dispatch<SetStateAction<boolean>>;
  externalDragDepthRef: RefObject<number>;
  draggingPath: string | null;
  connected: boolean;
  onUploadFiles:
    ((targetDirPath: string, files: File[]) => Promise<boolean>) | undefined;
  setActionPath: Dispatch<SetStateAction<string | null>>;
  workspacePath: string | null | undefined;
  dropTargetPath: string | null;
  canDrag: boolean;
  renamingItem: FileTreeItem | null;
  actionPath: string | null;
  suppressClickAfterDragRef: RefObject<boolean>;
  setContextMenu: Dispatch<
    SetStateAction<{ item: FileTreeItem; x: number; y: number } | null>
  >;
  onMoveItem:
    | ((item: FileTreeItem, targetDirPath: string) => Promise<boolean>)
    | undefined;
  sourceItems: FileTreeItem[];
  canUpload: boolean;
}
export function useTreeDragAndDrop({
  dragSourceRef,
  setDraggingPath,
  setDropTargetPath,
  setExternalDragOver,
  externalDragDepthRef,
  draggingPath,
  connected,
  onUploadFiles,
  setActionPath,
  workspacePath,
  dropTargetPath,
  canDrag,
  renamingItem,
  actionPath,
  suppressClickAfterDragRef,
  setContextMenu,
  onMoveItem,
  sourceItems,
  canUpload,
}: Dependencies) {
  const clearDragState = () => {
    dragSourceRef.current = null;
    setDraggingPath(null);
    setDropTargetPath(null);
    setExternalDragOver(false);
    externalDragDepthRef.current = 0;
  };

  const handleExternalFilesDrop = (
    event: React.DragEvent,
    targetDirPath: string | null,
  ) => {
    // On drop, always try to read files even if type sniffing was flaky during dragover.
    const files = filesFromDataTransfer(event.dataTransfer);
    const looksExternal =
      isExternalFileDrag(event.dataTransfer, Boolean(draggingPath)) ||
      files.length > 0;
    if (!looksExternal || draggingPath) return false;

    event.preventDefault();
    event.stopPropagation();
    clearDragState();

    if (!connected || !onUploadFiles) {
      // Connected gate — still consume the drop so the OS doesn't open the file elsewhere.
      return true;
    }
    if (!targetDirPath) return true;

    if (!files.length) {
      // Drop fired but browser gave no File objects (rare Electron glitch).
      return true;
    }

    setActionPath(targetDirPath);
    void onUploadFiles(targetDirPath, files).finally(() => {
      setActionPath(null);
    });
    return true;
  };

  const acceptExternalDragOver = (
    event: React.DragEvent,
    destination: string | null,
  ) => {
    if (!onUploadFiles) return false;
    if (!isExternalFileDrag(event.dataTransfer, Boolean(draggingPath)))
      return false;
    // Always preventDefault on external file drag so Electron/Chromium allows drop
    // (otherwise the OS drop is ignored or opens the file in the window).
    event.preventDefault();
    event.stopPropagation();
    const dest = destination || workspacePath || null;
    const canCopy = Boolean(connected && dest);
    try {
      event.dataTransfer.dropEffect = canCopy ? "copy" : "none";
    } catch {
      // ignore
    }
    if (canCopy) {
      setExternalDragOver(true);
      if (dest && dropTargetPath !== dest) setDropTargetPath(dest);
    }
    return true;
  };

  const handleDragStart = (event: React.DragEvent, item: FileTreeItem) => {
    if (!canDrag || renamingItem || actionPath) {
      event.preventDefault();
      return;
    }
    const path = getTreeItemPath(item);
    dragSourceRef.current = item;
    suppressClickAfterDragRef.current = true;
    setDraggingPath(path);
    setDropTargetPath(null);
    setExternalDragOver(false);
    setContextMenu(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TREE_DND_MIME, path);
    // Some Electron/WebKit builds only fire drop if a text payload is present.
    event.dataTransfer.setData("text/plain", path);
  };

  const handleDragEnd = () => {
    clearDragState();
    // Click fires after dragend in some browsers — swallow the next activation.
    window.setTimeout(() => {
      suppressClickAfterDragRef.current = false;
    }, 0);
  };

  const handleRowDragOver = (event: React.DragEvent, item: FileTreeItem) => {
    // Finder / OS file drops → folder (or parent of file).
    const destination = externalDropDestination(item, workspacePath);
    if (acceptExternalDragOver(event, destination)) return;

    if (!canDrag || !draggingPath) return;
    // Always stop so the root container doesn't steal row hover.
    event.stopPropagation();
    const source = dragSourceRef.current;
    if (!source) return;

    const moveDestination = resolveDropTarget(
      item,
      draggingPath,
      workspacePath,
    );
    if (!moveDestination) {
      event.dataTransfer.dropEffect = "none";
      if (dropTargetPath !== null) setDropTargetPath(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetPath !== moveDestination) setDropTargetPath(moveDestination);
  };

  const handleRowDrop = (event: React.DragEvent, item: FileTreeItem) => {
    const externalDest = externalDropDestination(item, workspacePath);
    if (handleExternalFilesDrop(event, externalDest)) return;

    if (!canDrag || !onMoveItem) return;
    event.preventDefault();
    event.stopPropagation();

    const source = dragSourceRef.current;
    const sourcePath = source
      ? getTreeItemPath(source)
      : event.dataTransfer.getData(TREE_DND_MIME) ||
        event.dataTransfer.getData("text/plain");
    if (!sourcePath) {
      clearDragState();
      return;
    }

    const destination = resolveDropTarget(item, sourcePath, workspacePath);
    const moveItem =
      source ??
      sourceItems.find(
        (candidate) => getTreeItemPath(candidate) === sourcePath,
      ) ??
      null;
    clearDragState();
    if (!destination || !moveItem) return;

    setActionPath(getTreeItemPath(moveItem));
    void onMoveItem(moveItem, destination).finally(() => {
      setActionPath(null);
    });
  };

  /** Empty padding / whole pane → upload into workspace root.
   *  Rows call stopPropagation, so this only runs for true empty-area hits
   *  (or the pane chrome), not while hovering a folder row.
   */
  const handleRootDragOver = (event: React.DragEvent) => {
    // If the event originated from a tree row, the row handler already owns it.
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("[data-tree-path]")) {
      return;
    }
    if (acceptExternalDragOver(event, workspacePath ?? null)) return;

    if (!canDrag || !draggingPath || !workspacePath) return;
    // Only accept drops on empty padding of the tree (not bubbled from rows — rows stopPropagation).
    if (getParentPath(draggingPath) === workspacePath) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetPath !== workspacePath) setDropTargetPath(workspacePath);
  };

  const handleRootDragEnter = (event: React.DragEvent) => {
    if (!canUpload || !workspacePath) return;
    if (!isExternalFileDrag(event.dataTransfer, Boolean(draggingPath))) return;
    event.preventDefault();
    externalDragDepthRef.current += 1;
    setExternalDragOver(true);
    // Don't force root target here — wait for dragover on empty area or a row.
  };

  const handleRootDragLeave = (event: React.DragEvent) => {
    // Clear highlight when leaving the scroll/pane entirely.
    const related = event.relatedTarget as Node | null;
    if (event.currentTarget.contains(related)) return;
    externalDragDepthRef.current = Math.max(
      0,
      externalDragDepthRef.current - 1,
    );
    if (externalDragDepthRef.current === 0) {
      setExternalDragOver(false);
      if (!draggingPath) setDropTargetPath(null);
    }
  };

  const handleRootDrop = (event: React.DragEvent) => {
    if (handleExternalFilesDrop(event, workspacePath ?? null)) return;

    if (!canDrag || !onMoveItem || !workspacePath) return;
    event.preventDefault();
    const source = dragSourceRef.current;
    const sourcePath = source
      ? getTreeItemPath(source)
      : event.dataTransfer.getData(TREE_DND_MIME) ||
        event.dataTransfer.getData("text/plain");
    const moveItem =
      source ??
      sourceItems.find(
        (candidate) => getTreeItemPath(candidate) === sourcePath,
      ) ??
      null;
    clearDragState();
    if (!moveItem || !sourcePath) return;
    if (getParentPath(sourcePath) === workspacePath) return;

    setActionPath(sourcePath);
    void onMoveItem(moveItem, workspacePath).finally(() => {
      setActionPath(null);
    });
  };

  // Full-card blue ring only when the drop target is the workspace ROOT
  // (empty padding). Folder targets use the row highlight alone.

  return {
    handleRootDragEnter,
    handleRootDragLeave,
    handleRootDragOver,
    handleRootDrop,
    handleDragEnd,
    handleRowDragOver,
    handleDragStart,
    handleRowDrop,
  };
}
