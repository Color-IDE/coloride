import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api,
  encodeTextToBase64
} from "../../../shared/api/client";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  messageFromError
} from "./connectionValidation";
import {
  getItemPath,
  getParentPath,
  isPathOrDescendant,
  joinRemotePath,
  replacePathPrefix,
  replacePathPrefixInSet
} from "./treeModel";
import {
  type ConnectionState,
  type EditorBuffer
} from "./types";

interface Dependencies {
  connectionState: ConnectionState;
  workspacePath: string;
  setExplorerError: Dispatch<SetStateAction<string>>;
  requestWritePermission: (action: string, dangerous?: boolean, options?: { skipConfirm?: boolean; }) => boolean;
  refreshDirectory: (path: string) => Promise<void>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  revealInTree: (path: string) => Promise<boolean>;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  setLoadingDirs: Dispatch<SetStateAction<Set<string>>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  treeItems: FileTreeItem[];
  rememberActiveEditor: () => void;
  setTreeItems: Dispatch<SetStateAction<FileTreeItem[]>>;
  expandedIds: Set<string>;
  loadedDirs: Set<string>;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
}

export function useWorkspaceFileMutations({
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
}: Dependencies) {
  const createFileAt = async (
    parentDirPath: string,
    name: string,
  ): Promise<boolean> => {
    if (connectionState !== "connected" || !workspacePath) {
      setExplorerError(
        connectionState === "connected"
          ? "Select a workspace first."
          : "Connect to a server first.",
      );
      return false;
    }
    if (
      !requestWritePermission("Create a new file", false, { skipConfirm: true })
    )
      return false;

    const cleanName = name.trim();
    if (
      !cleanName ||
      cleanName.includes("/") ||
      cleanName.includes("\0") ||
      cleanName === "." ||
      cleanName === ".."
    ) {
      setExplorerError("File name cannot be empty, '.', '..', or contain '/'.");
      return false;
    }

    const parent = parentDirPath || workspacePath;
    const path = joinRemotePath(parent, cleanName);

    try {
      const response = await api.writeFile(path, encodeTextToBase64(""));
      await refreshDirectory(parent);
      setExpandedIds((current) => new Set(current).add(parent));
      setSelectedFile(path);
      setOpenFiles((current) =>
        current.includes(path) ? current : [...current, path],
      );
      setEditorValue("");
      setEditorImageUrl(null);
      setEditorEtag(response.etag);
      setEditorDirty(false);
      setEditorTruncated(false);
      setEditorError("");
      editorBuffersRef.current.set(path, {
        dirty: false,
        error: "",
        etag: response.etag,
        imageUrl: null,
        truncated: false,
        value: "",
      });
      revealInTree(path);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  const createFolderAt = async (
    parentDirPath: string,
    name: string,
  ): Promise<boolean> => {
    if (connectionState !== "connected" || !workspacePath) {
      setExplorerError(
        connectionState === "connected"
          ? "Select a workspace first."
          : "Connect to a server first.",
      );
      return false;
    }
    if (
      !requestWritePermission("Create a new folder", false, {
        skipConfirm: true,
      })
    )
      return false;

    const cleanName = name.trim();
    if (
      !cleanName ||
      cleanName.includes("/") ||
      cleanName.includes("\0") ||
      cleanName === "." ||
      cleanName === ".."
    ) {
      setExplorerError(
        "Folder name cannot be empty, '.', '..', or contain '/'.",
      );
      return false;
    }

    const parent = parentDirPath || workspacePath;
    const path = joinRemotePath(parent, cleanName);

    try {
      await api.mkdir(path);
      await refreshDirectory(parent);
      setExpandedIds((current) => {
        const next = new Set(current);
        next.add(parent);
        next.add(path);
        return next;
      });
      revealInTree(path);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  const remapMovedPaths = (oldPath: string, newPath: string) => {
    setExpandedIds((current) =>
      replacePathPrefixInSet(current, oldPath, newPath),
    );
    setLoadedDirs((current) =>
      replacePathPrefixInSet(current, oldPath, newPath),
    );
    setLoadingDirs((current) =>
      replacePathPrefixInSet(current, oldPath, newPath),
    );
    setOpenFiles((current) =>
      current.map((path) => replacePathPrefix(path, oldPath, newPath)),
    );
    setDirtyFiles((current) =>
      replacePathPrefixInSet(current, oldPath, newPath),
    );
    setSelectedFile((current) =>
      current ? replacePathPrefix(current, oldPath, newPath) : null,
    );

    const remappedBuffers = new Map<string, EditorBuffer>();
    for (const [path, buffer] of editorBuffersRef.current) {
      remappedBuffers.set(replacePathPrefix(path, oldPath, newPath), buffer);
    }
    editorBuffersRef.current = remappedBuffers;
  };

  const handleRenameTreeItem = async (
    item: FileTreeItem,
    requestedName: string,
  ) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const newName = requestedName.trim();
    if (
      !newName ||
      newName === "." ||
      newName === ".." ||
      newName.includes("/") ||
      newName.includes("\0")
    ) {
      setExplorerError("Name cannot be empty, '.', '..', or contain '/'.");
      return false;
    }

    const oldPath = getItemPath(item);
    const newPath = joinRemotePath(getParentPath(oldPath), newName);
    if (newPath === oldPath) return true;
    if (treeItems.some((candidate) => getItemPath(candidate) === newPath)) {
      setExplorerError(`A file or folder named "${newName}" already exists.`);
      return false;
    }
    if (!requestWritePermission(`Rename "${item.name}" to "${newName}"`))
      return false;

    rememberActiveEditor();
    try {
      await api.renameFile(oldPath, newPath);

      setTreeItems((current) =>
        current.map((candidate) => {
          const candidatePath = getItemPath(candidate);
          if (!isPathOrDescendant(candidatePath, oldPath)) return candidate;
          const nextPath = replacePathPrefix(candidatePath, oldPath, newPath);
          return {
            ...candidate,
            id: nextPath,
            name: candidatePath === oldPath ? newName : candidate.name,
            path: nextPath,
          };
        }),
      );
      remapMovedPaths(oldPath, newPath);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  const handleMoveTreeItem = async (
    item: FileTreeItem,
    targetDirPath: string,
  ) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const oldPath = getItemPath(item);
    const sourceParent = getParentPath(oldPath);
    const destination = targetDirPath.replace(/\/+$/, "") || "/";
    const newPath = joinRemotePath(destination, item.name);

    if (newPath === oldPath || sourceParent === destination) {
      return true;
    }

    // Cannot move a folder into itself or one of its descendants.
    if (item.kind === "dir" && isPathOrDescendant(destination, oldPath)) {
      setExplorerError("Cannot move a folder into itself or a subfolder.");
      return false;
    }

    if (treeItems.some((candidate) => getItemPath(candidate) === newPath)) {
      setExplorerError(
        `A file or folder named "${item.name}" already exists in the destination.`,
      );
      return false;
    }

    const destinationLabel =
      destination === workspacePath
        ? workspacePath.split("/").filter(Boolean).at(-1) || workspacePath
        : destination.split("/").filter(Boolean).at(-1) || destination;

    // Drag-and-drop is an explicit user gesture — don't prompt; still honor read-only.
    if (
      !requestWritePermission(
        `Move "${item.name}" into "${destinationLabel}"`,
        false,
        { skipConfirm: true },
      )
    ) {
      return false;
    }

    const wasExpanded = item.kind === "dir" && expandedIds.has(oldPath);
    const destIsRoot = destination === workspacePath;
    const destLoaded = destIsRoot || loadedDirs.has(destination);
    const destItem = destIsRoot
      ? null
      : treeItems.find((candidate) => getItemPath(candidate) === destination);
    const destDepth = destIsRoot ? -1 : (destItem?.depth ?? 0);
    const insertedDepth = destDepth + 1;

    rememberActiveEditor();
    try {
      await api.renameFile(oldPath, newPath);

      // Optimistic tree update: cut the moved subtree and paste under destination when visible.
      setTreeItems((current) => {
        const sourceIndex = current.findIndex(
          (candidate) => getItemPath(candidate) === oldPath,
        );
        if (sourceIndex < 0) return current;

        const sourceDepth = current[sourceIndex].depth;
        let sourceEnd = sourceIndex + 1;
        while (
          sourceEnd < current.length &&
          current[sourceEnd].depth > sourceDepth
        ) {
          sourceEnd += 1;
        }

        const movedSlice = current
          .slice(sourceIndex, sourceEnd)
          .map((candidate) => {
            const candidatePath = getItemPath(candidate);
            const nextPath = replacePathPrefix(candidatePath, oldPath, newPath);
            return {
              ...candidate,
              id: nextPath,
              path: nextPath,
              name: candidatePath === oldPath ? item.name : candidate.name,
              depth: insertedDepth + (candidate.depth - sourceDepth),
            };
          });

        const withoutSource = [
          ...current.slice(0, sourceIndex),
          ...current.slice(sourceEnd),
        ];

        // Destination never loaded: only remove from source; expand+load after will fetch it.
        if (!destIsRoot && !destLoaded) {
          return withoutSource;
        }

        if (destIsRoot) {
          // Insert among root-level items (depth 0), folders first then alpha — match entriesToTreeItems.
          const insertAt = (() => {
            const moved = movedSlice[0];
            let index = 0;
            while (
              index < withoutSource.length &&
              withoutSource[index].depth === 0
            ) {
              const candidate = withoutSource[index];
              const folderBeforeFile =
                candidate.kind === "dir" && moved.kind !== "dir";
              const fileAfterFolder =
                candidate.kind !== "dir" && moved.kind === "dir";
              if (fileAfterFolder) break;
              if (
                !folderBeforeFile &&
                candidate.name.localeCompare(moved.name) > 0
              )
                break;
              // Skip past this root item and its currently-visible descendants.
              index += 1;
              while (
                index < withoutSource.length &&
                withoutSource[index].depth > 0
              ) {
                index += 1;
              }
            }
            return index;
          })();
          return [
            ...withoutSource.slice(0, insertAt),
            ...movedSlice,
            ...withoutSource.slice(insertAt),
          ];
        }

        const destIndex = withoutSource.findIndex(
          (candidate) => getItemPath(candidate) === destination,
        );
        if (destIndex < 0) {
          return withoutSource;
        }

        const destDepthInTree = withoutSource[destIndex].depth;
        let childRegionEnd = destIndex + 1;
        while (
          childRegionEnd < withoutSource.length &&
          withoutSource[childRegionEnd].depth > destDepthInTree
        ) {
          childRegionEnd += 1;
        }

        // Insert in sorted order among direct children of destination (even if collapsed — we expand next).
        const childDepth = destDepthInTree + 1;
        const moved = movedSlice[0];
        let sortedInsert = destIndex + 1;
        while (sortedInsert < childRegionEnd) {
          const candidate = withoutSource[sortedInsert];
          if (candidate.depth === childDepth) {
            const folderBeforeFile =
              candidate.kind === "dir" && moved.kind !== "dir";
            const fileAfterFolder =
              candidate.kind !== "dir" && moved.kind === "dir";
            if (fileAfterFolder) break;
            if (
              !folderBeforeFile &&
              candidate.name.localeCompare(moved.name) > 0
            )
              break;
          }
          sortedInsert += 1;
          while (
            sortedInsert < childRegionEnd &&
            withoutSource[sortedInsert].depth > childDepth
          ) {
            sortedInsert += 1;
          }
        }

        return [
          ...withoutSource.slice(0, sortedInsert),
          ...movedSlice,
          ...withoutSource.slice(sortedInsert),
        ];
      });

      setExpandedIds((current) => {
        const next = replacePathPrefixInSet(current, oldPath, newPath);
        next.add(destination);
        // Only keep moved-folder expansion when its children were carried over in the optimistic slice.
        if (wasExpanded && (destLoaded || destIsRoot)) next.add(newPath);
        return next;
      });
      setLoadedDirs((current) => {
        const next = replacePathPrefixInSet(current, oldPath, newPath);
        if (destLoaded || destIsRoot) next.add(destination);
        // Same: only mark moved folder loaded if children stayed in the tree.
        if (wasExpanded && (destLoaded || destIsRoot)) next.add(newPath);
        return next;
      });
      setLoadingDirs((current) =>
        replacePathPrefixInSet(current, oldPath, newPath),
      );
      setOpenFiles((current) =>
        current.map((path) => replacePathPrefix(path, oldPath, newPath)),
      );
      setDirtyFiles((current) =>
        replacePathPrefixInSet(current, oldPath, newPath),
      );
      setSelectedFile((current) =>
        current ? replacePathPrefix(current, oldPath, newPath) : null,
      );

      const remappedBuffers = new Map<string, EditorBuffer>();
      for (const [path, buffer] of editorBuffersRef.current) {
        remappedBuffers.set(replacePathPrefix(path, oldPath, newPath), buffer);
      }
      editorBuffersRef.current = remappedBuffers;

      // Destination wasn't loaded yet: expand and fetch so the moved item appears.
      if (!destIsRoot && destItem && !destLoaded) {
        await loadDirectory(destination, insertedDepth, false);
        if (wasExpanded) {
          setExpandedIds((current) => new Set(current).add(newPath));
          await loadDirectory(newPath, insertedDepth + 1, false);
        }
      }

      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      // Best-effort recovery: refresh source parent so the tree doesn't stay wrong after a failed optimistic path.
      // (API failed before optimistic update in this flow — tree is unchanged.)
      return false;
    }
  };
  return { createFileAt, createFolderAt, handleRenameTreeItem, handleMoveTreeItem };
}
