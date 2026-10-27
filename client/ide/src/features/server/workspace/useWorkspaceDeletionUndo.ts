import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api
} from "../../../shared/api/client";
import { lspSyncClose } from "../../editor/lsp/documentSync";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  MAX_TREE_UNDO,
  MAX_TREE_UNDO_BYTES,
  MAX_TREE_UNDO_FILES,
  messageFromError,
} from "./connectionValidation";
import {
  getItemPath,
  getParentPath,
  isPathOrDescendant,
  isUnderWorkspace,
  itemDepthUnderRoot
} from "./treeModel";
import {
  type ConnectionState,
  type EditorBuffer,
  type TreeUndoDeleteEntry,
  type TreeUndoEntry,
  type TreeUndoFileSnapshot,
} from "./types";
interface Dependencies {
  openFilesRef: RefObject<string[]>;
  setTreeItems: Dispatch<SetStateAction<FileTreeItem[]>>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  loadedDirsRef: RefObject<Set<string>>;
  setLoadingDirs: Dispatch<SetStateAction<Set<string>>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  selectedFileRef: RefObject<string | null>;
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
  setExplorerError: Dispatch<SetStateAction<string>>;
  treeUndoStackRef: RefObject<TreeUndoDeleteEntry[]>;
  setTreeUndoDepth: Dispatch<SetStateAction<number>>;
  suppressEditorWatchUntilRef: RefObject<number>;
  workspacePathRef: RefObject<string>;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
  revealInTree: (path: string) => Promise<boolean>;
  connectionStateRef: RefObject<ConnectionState>;
  connectionState: ConnectionState;
  dirtyFiles: Set<string>;
  requestWritePermission: (action: string, dangerous?: boolean, options?: { skipConfirm?: boolean; }) => boolean;
  rememberActiveEditor: () => void;
}

export function useWorkspaceDeletionUndo({
  openFilesRef,
  setTreeItems,
  treeItemsRef,
  setExpandedIds,
  expandedIdsRef,
  setLoadedDirs,
  loadedDirsRef,
  setLoadingDirs,
  setDirtyFiles,
  setMissingFiles,
  editorBuffersRef,
  selectedFileRef,
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
  setExplorerError,
  treeUndoStackRef,
  setTreeUndoDepth,
  suppressEditorWatchUntilRef,
  workspacePathRef,
  loadDirectory,
  revealInTree,
  connectionStateRef,
  connectionState,
  dirtyFiles,
  requestWritePermission,
  rememberActiveEditor,
}: Dependencies) {

  const applyDeletedPaths = async (deletedPaths: string[]) => {
    if (deletedPaths.length === 0) return;

    const isDeleted = (candidate: string) =>
      deletedPaths.some((path) => isPathOrDescendant(candidate, path));

    const deletedOpen = openFilesRef.current.filter(
      (openPath) => isDeleted(openPath) && !isBrowserTabKey(openPath),
    );
    const remainingOpenFiles = openFilesRef.current;
    setTreeItems((current) => {
      const next = current.filter(
        (candidate) => !isDeleted(getItemPath(candidate)),
      );
      treeItemsRef.current = next;
      return next;
    });
    setExpandedIds((current) => {
      const next = new Set(
        [...current].filter((candidate) => !isDeleted(candidate)),
      );
      expandedIdsRef.current = next;
      return next;
    });
    setLoadedDirs((current) => {
      const next = new Set(
        [...current].filter((candidate) => !isDeleted(candidate)),
      );
      loadedDirsRef.current = next;
      return next;
    });
    setLoadingDirs(
      (current) =>
        new Set([...current].filter((candidate) => !isDeleted(candidate))),
    );
    setDirtyFiles(
      (current) =>
        new Set([...current].filter((candidate) => !isDeleted(candidate))),
    );
    if (deletedOpen.length > 0) {
      setMissingFiles((current) => {
        const next = new Set(current);
        for (const path of deletedOpen) next.add(path);
        return next;
      });
      for (const path of deletedOpen) {
        const cached = editorBuffersRef.current.get(path);
        editorBuffersRef.current.set(path, {
          dirty: false,
          error: "",
          etag: cached?.etag ?? null,
          imageUrl: cached?.imageUrl ?? null,
          missing: true,
          truncated: cached?.truncated ?? false,
          value: cached?.value ?? "",
          agentStreaming: false,
        });
        void lspSyncClose(path);
      }
    }

    const activePath = selectedFileRef.current;
    if (activePath && deletedOpen.includes(activePath)) {
      editorLoadRequestRef.current += 1;
      // Prefer another open tab in the same folder as the deleted file.
      const deletedParent = getParentPath(activePath);
      const selectable = remainingOpenFiles.filter((path) => !isDeleted(path));
      const sameFolderOpen =
        selectable.find((path) => getParentPath(path) === deletedParent) ??
        null;
      const nextPath = sameFolderOpen ?? selectable[0] ?? null;
      if (nextPath) {
        await activateEditorFile(nextPath, false);
      } else {
        selectedFileRef.current = null;
        setSelectedFile(null);
        setEditorValue("");
        setEditorImageUrl(null);
        setEditorEtag(null);
        setEditorDirty(false);
        setEditorTruncated(false);
        setEditorError("");
        setEditorLoading(false);
      }
    }

    setExplorerError("");
  };

  /** Collapse nested selections so deleting a folder doesn't also try to delete its children. */
  const collapseDeleteTargets = (items: FileTreeItem[]) => {
    const ordered = [...items].sort((a, b) =>
      getItemPath(a).localeCompare(getItemPath(b)),
    );
    const roots: FileTreeItem[] = [];
    for (const item of ordered) {
      const path = getItemPath(item);
      if (roots.some((root) => isPathOrDescendant(path, getItemPath(root))))
        continue;
      roots.push(item);
    }
    return roots;
  };

  const pushTreeUndo = (entry: TreeUndoEntry) => {
    treeUndoStackRef.current = [...treeUndoStackRef.current, entry].slice(
      -MAX_TREE_UNDO,
    );
    setTreeUndoDepth(treeUndoStackRef.current.length);
  };

  /** Snapshot remote path(s) so delete can be undone with Ctrl/Cmd+Z. */
  const snapshotDeleteTargets = async (
    items: FileTreeItem[],
  ): Promise<TreeUndoDeleteEntry | null> => {
    const dirs = new Set<string>();
    const files: TreeUndoFileSnapshot[] = [];
    let totalBytes = 0;

    const addFile = async (path: string) => {
      if (files.length >= MAX_TREE_UNDO_FILES) {
        throw new Error("Too many files to keep for undo.");
      }
      const response = await api.readFile(path);
      // base64 → approx original bytes
      const approx = Math.floor((response.content.length * 3) / 4);
      totalBytes += approx;
      if (totalBytes > MAX_TREE_UNDO_BYTES) {
        throw new Error("Selection is too large to undo.");
      }
      files.push({ path, contentBase64: response.content });
    };

    const addDir = async (path: string) => {
      dirs.add(path);
      let offset = 0;
      for (; ;) {
        const response = await api.listFiles(path, offset, 500);
        const entries = response.entries ?? [];
        if (entries.length === 0) break;
        for (const entry of entries) {
          if (entry.kind === "dir") {
            await addDir(entry.path);
          } else if (entry.kind === "file" || entry.kind === "link") {
            await addFile(entry.path);
          }
        }
        if (entries.length < 500) break;
        offset += entries.length;
      }
    };

    for (const item of items) {
      const path = getItemPath(item);
      if (!path) continue;
      if (item.kind === "dir") await addDir(path);
      else await addFile(path);
    }

    const dirList = [...dirs].sort(
      (a, b) => a.length - b.length || a.localeCompare(b),
    );
    return {
      type: "delete",
      rootPaths: items.map(getItemPath).filter(Boolean),
      dirs: dirList,
      files,
    };
  };

  const restoreDeleteSnapshot = async (
    entry: TreeUndoDeleteEntry,
  ): Promise<boolean> => {
    suppressEditorWatchUntilRef.current = Date.now() + 12_000;
    // Parents first.
    for (const dir of entry.dirs) {
      try {
        await api.mkdir(dir);
      } catch {
        // Already exists is fine.
      }
    }
    for (const file of entry.files) {
      const parent = getParentPath(file.path);
      if (parent && parent !== "/" && !entry.dirs.includes(parent)) {
        // Ensure intermediate parents for single-file restores.
        const parts = parent.split("/").filter(Boolean);
        let built = parent.startsWith("/") ? "" : "";
        for (const part of parts) {
          built = parent.startsWith("/")
            ? `${built}/${part}`
            : built
              ? `${built}/${part}`
              : part;
          try {
            await api.mkdir(built);
          } catch {
            /* exists */
          }
        }
      }
      await api.writeFile(file.path, file.contentBase64, null);
    }

    // Refresh visible parents + root.
    const parents = new Set<string>();
    for (const root of entry.rootPaths) {
      const parent = getParentPath(root);
      if (parent) parents.add(parent);
    }
    const workspaceRoot = workspacePathRef.current;
    if (workspaceRoot) parents.add(workspaceRoot);

    for (const parent of parents) {
      if (!parent) continue;
      if (parent === workspaceRoot) {
        await loadDirectory(parent, 0, true, false, {
          quiet: true,
          force: true,
        });
      } else if (workspaceRoot && isUnderWorkspace(parent, workspaceRoot)) {
        const depth = itemDepthUnderRoot(parent, workspaceRoot);
        await loadDirectory(parent, depth + 1, false, false, {
          quiet: true,
          force: true,
        });
      }
    }

    const focusPath = entry.files[0]?.path ?? entry.rootPaths[0] ?? null;
    if (focusPath) {
      const isDirOnly =
        entry.files.length === 0 && entry.dirs.includes(focusPath);
      if (!isDirOnly && entry.files.some((f) => f.path === focusPath)) {
        await activateEditorFile(focusPath, true, { reveal: true });
      } else {
        void revealInTree(focusPath);
      }
    }
    setExplorerError("");
    return true;
  };

  const undoTreeAction = async (): Promise<boolean> => {
    if (connectionStateRef.current !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }
    const stack = treeUndoStackRef.current;
    const entry = stack[stack.length - 1];
    if (!entry) return false;
    treeUndoStackRef.current = stack.slice(0, -1);
    setTreeUndoDepth(treeUndoStackRef.current.length);

    try {
      if (entry.type === "delete") {
        return await restoreDeleteSnapshot(entry);
      }
      return false;
    } catch (error) {
      // Put entry back so the user can retry.
      treeUndoStackRef.current = [...treeUndoStackRef.current, entry].slice(
        -MAX_TREE_UNDO,
      );
      setTreeUndoDepth(treeUndoStackRef.current.length);
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  const handleDeleteTreeItem = async (item: FileTreeItem) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const path = getItemPath(item);
    const hasDirtyFiles = [...dirtyFiles].some((dirtyPath) =>
      isPathOrDescendant(dirtyPath, path),
    );
    const kind = item.kind === "dir" ? "folder" : "file";
    const contents = item.kind === "dir" ? " and everything inside it" : "";
    const warning = hasDirtyFiles
      ? " Unsaved changes inside it will be discarded."
      : "";
    if (
      !requestWritePermission(
        `Delete ${kind} "${item.name}"${contents}?${warning}`,
        true,
      )
    )
      return false;

    rememberActiveEditor();
    let snapshot: TreeUndoDeleteEntry | null = null;
    try {
      snapshot = await snapshotDeleteTargets([item]);
    } catch (error) {
      // Still allow delete, but undo won't be available.
      snapshot = null;
      console.warn("[tree-undo] snapshot failed", error);
    }
    try {
      await api.deleteFile(path, item.kind === "dir");
      await applyDeletedPaths([path]);
      if (snapshot) pushTreeUndo(snapshot);
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  const handleDeleteTreeItems = async (items: FileTreeItem[]) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }
    if (items.length === 0) return false;

    const targets = collapseDeleteTargets(items);
    if (targets.length === 1) {
      return handleDeleteTreeItem(targets[0]!);
    }

    const paths = targets.map(getItemPath);
    const hasDirtyFiles = [...dirtyFiles].some((dirtyPath) =>
      paths.some((path) => isPathOrDescendant(dirtyPath, path)),
    );
    const folders = targets.filter((item) => item.kind === "dir").length;
    const files = targets.length - folders;
    const parts: string[] = [];
    if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
    if (folders > 0) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
    const summary = parts.join(" and ");
    const preview = targets
      .slice(0, 5)
      .map((item) => item.name)
      .join(", ");
    const more = targets.length > 5 ? ` and ${targets.length - 5} more` : "";
    const warning = hasDirtyFiles
      ? " Unsaved changes inside them will be discarded."
      : "";
    if (
      !requestWritePermission(
        `Delete ${summary} (${preview}${more})?${warning}`,
        true,
      )
    ) {
      return false;
    }

    rememberActiveEditor();
    let snapshot: TreeUndoDeleteEntry | null = null;
    try {
      snapshot = await snapshotDeleteTargets(targets);
    } catch (error) {
      snapshot = null;
      console.warn("[tree-undo] bulk snapshot failed", error);
    }

    const deleted: string[] = [];
    const failures: string[] = [];

    for (const item of targets) {
      const path = getItemPath(item);
      try {
        await api.deleteFile(path, item.kind === "dir");
        deleted.push(path);
      } catch (error) {
        failures.push(`${item.name}: ${messageFromError(error)}`);
      }
    }

    if (deleted.length > 0) {
      await applyDeletedPaths(deleted);
      if (snapshot) {
        // Only keep undo for paths that actually deleted.
        const deletedSet = new Set(deleted);
        const filtered: TreeUndoDeleteEntry = {
          type: "delete",
          rootPaths: snapshot.rootPaths.filter((p) => deletedSet.has(p)),
          dirs: snapshot.dirs.filter((d) =>
            deleted.some((p) => isPathOrDescendant(d, p) || d === p),
          ),
          files: snapshot.files.filter((f) =>
            deleted.some((p) => isPathOrDescendant(f.path, p) || f.path === p),
          ),
        };
        if (filtered.rootPaths.length > 0) pushTreeUndo(filtered);
      }
    }

    if (failures.length > 0) {
      const failedMsg =
        failures.length === 1
          ? failures[0]!
          : `Failed to delete ${failures.length} items. ${failures[0]}`;
      setExplorerError(failedMsg);
      return deleted.length > 0;
    }

    return deleted.length > 0;
  };
  return { applyDeletedPaths, undoTreeAction, handleDeleteTreeItem, handleDeleteTreeItems };
}
