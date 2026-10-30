import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api,
  encodeBytesToBase64
} from "../../../shared/api/client";
import { readOsClipboardFiles } from "../../../shared/lib/clipboardFiles";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import type { AppPreferences } from "../../settings/preferences";
import {
  messageFromError
} from "./connectionValidation";
import {
  buildCopyName,
  getItemPath,
  getParentPath,
  isPathOrDescendant,
  mergeDirectoryListing,
  joinRemotePath
} from "./treeModel";
import {
  type ConnectionState,
  type TreeUndoEntry,
} from "./types";
interface Dependencies {
  pushTreeUndo: (entry: TreeUndoEntry) => void;
  treeClipboardRef: RefObject<{ path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null>;
  setTreeClipboard: Dispatch<SetStateAction<{ path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null>>;
  setExplorerError: Dispatch<SetStateAction<string>>;
  appPreferences: AppPreferences;
  workspacePathRef: RefObject<string>;
  workspacePath: string;
  treeItemsRef: RefObject<FileTreeItem[]>;
  setTreeItems: Dispatch<SetStateAction<FileTreeItem[]>>;
  openFilesRef: RefObject<string[]>;
  connectionState: ConnectionState;
  requestWritePermission: (action: string, dangerous?: boolean, options?: { skipConfirm?: boolean; }) => boolean;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  refreshDirectory: (path: string) => Promise<void>;
  requestRevealInTree: (path: string) => void;
  selectedFileRef: RefObject<string | null>;
  selectedFile: string | null;
  connectionStateRef: RefObject<ConnectionState>;
  treeClipboard: { path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null;
  handleMoveTreeItem: (item: FileTreeItem, targetDirPath: string) => Promise<boolean>;
}

export function useWorkspaceClipboard({
  pushTreeUndo,
  treeClipboardRef,
  setTreeClipboard,
  setExplorerError,
  appPreferences,
  workspacePathRef,
  workspacePath,
  treeItemsRef,
  setTreeItems,
  openFilesRef,
  connectionState,
  requestWritePermission,
  setExpandedIds,
  expandedIdsRef,
  refreshDirectory,
  requestRevealInTree,
  selectedFileRef,
  selectedFile,
  connectionStateRef,
  treeClipboard,
  handleMoveTreeItem,
}: Dependencies) {

  const handleCopyTreeItem = (item: FileTreeItem) => {
    const entry = { path: getItemPath(item), name: item.name, kind: item.kind };
    treeClipboardRef.current = entry;
    setTreeClipboard(entry);
    setExplorerError("");
    return true;
  };

  const handleCutTreeItem = (item: FileTreeItem) => {
    if (appPreferences.permissionMode === "read-only") {
      setExplorerError("Read-only mode: cut is disabled.");
      return false;
    }
    const entry = {
      path: getItemPath(item),
      name: item.name,
      kind: item.kind,
      mode: "cut" as const,
    };
    treeClipboardRef.current = entry;
    setTreeClipboard(entry);
    setExplorerError("");
    return true;
  };

  const resolveUniqueDestPath = async (
    parent: string,
    preferredName: string,
    forceCopySuffix = false,
  ) => {
    const normalizedParent = parent.replace(/\/+$/, "") || "/";
    const root =
      (workspacePathRef.current || workspacePath || "").replace(/\/+$/, "") ||
      "/";
    const items = treeItemsRef.current;
    const siblingNames = new Set(
      items
        .filter((candidate) => {
          const candidatePath = getItemPath(candidate);
          if (normalizedParent === root) {
            return candidate.depth === 0;
          }
          return getParentPath(candidatePath) === normalizedParent;
        })
        .map((candidate) => candidate.name),
    );
    // Also treat open paths under parent as occupied so we don't collide with hidden unloaded siblings when possible.
    for (const openPath of openFilesRef.current) {
      if (getParentPath(openPath) === normalizedParent) {
        siblingNames.add(
          openPath.split("/").filter(Boolean).at(-1) ?? openPath,
        );
      }
    }
    for (;;) {
      const name = buildCopyName(preferredName, siblingNames, forceCopySuffix);
      const path = joinRemotePath(parent, name);
      // Probe only the proposed destination, including unloaded/hidden files.
      // Existing copies and writes also refuse occupied destinations.
      const { entries } = await api.statFiles(path);
      if (!entries.length) throw new Error("Could not check the paste destination.");
      if (!entries[0]!.exists) return { name, path };
      siblingNames.add(name);
    }
  };

  const handleDuplicateTreeItem = async (item: FileTreeItem) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const sourcePath = getItemPath(item);
    const parent = getParentPath(sourcePath);
    try {
      const { name: destName, path: destPath } = await resolveUniqueDestPath(parent, item.name, true);
      if (!requestWritePermission(`Duplicate "${item.name}" as "${destName}"`)) return false;
      await api.copyFile(sourcePath, destPath);
      pushTreeUndo({type:"create", items:[{path:destPath, kind:item.kind}]});
      revealAfterPaste(parent, destPath, item.kind);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error));
      return false;
    }
  };

  /**
   * Destination folder for paste:
   * - folder row (incl. workspace root card) → paste **inside** it
   * - file / link row → paste into the **parent folder** (next to the file)
   * - no tree context → parent of open editor file, else workspace root
   */
  const resolvePasteParent = (contextItem?: FileTreeItem) => {
    const root =
      (workspacePathRef.current || workspacePath || "").replace(/\/+$/, "") ||
      "/";

    const parentOf = (path: string) => {
      const parent = getParentPath(path);
      // Never return empty; fall back to workspace root.
      if (!parent || parent === ".") return root;
      return parent;
    };

    if (contextItem) {
      const path = getItemPath(contextItem);
      const normalized = path.replace(/\/+$/, "") || path;
      // Synthetic workspace-root card item uses the workspace path as a dir.
      if (
        normalized === root ||
        path === workspacePath ||
        path === workspacePathRef.current
      ) {
        return root === "/"
          ? "/"
          : workspacePathRef.current || workspacePath || root;
      }
      // Only real directories receive paste inside; files/links → their folder.
      if (contextItem.kind === "dir") return path;
      return parentOf(path);
    }

    // Prefer the tree-focused path if the open editor tab is unrelated.
    const openPath = selectedFileRef.current ?? selectedFile;
    if (openPath) {
      const selectedItem = treeItemsRef.current.find(
        (candidate) => getItemPath(candidate) === openPath,
      );
      if (selectedItem?.kind === "dir") return openPath;
      // Open editor file → paste into the folder that contains it.
      return parentOf(openPath);
    }

    return workspacePathRef.current || workspacePath || root;
  };

  const revealAfterPaste = (
    destinationParent: string,
    destPath: string,
    kind: FileTreeItem["kind"] = "file",
    reconcile = true,
  ) => {
    const root = workspacePathRef.current || workspacePath;
    if (!root || !isPathOrDescendant(destinationParent, root)) return;
    if (destinationParent !== root) {
      const expanded = new Set(expandedIdsRef.current).add(destinationParent);
      expandedIdsRef.current = expanded;
      setExpandedIds(expanded);
    }
    // The write already succeeded. Insert its known result without waiting
    // for a directory listing, preserving every loaded sibling subtree.
    setTreeItems(current => {
      if (current.some(item => getItemPath(item) === destPath)) return current;
      const parent = current.find(item => getItemPath(item) === destinationParent);
      if (destinationParent !== root && !parent) return current;
      const depth = parent ? parent.depth + 1 : 0;
      const children = current.filter(item => item.depth === depth && getParentPath(getItemPath(item)) === destinationParent);
      children.push({id:destPath, path:destPath, name:destPath.split("/").at(-1)!, kind, depth});
      children.sort((a, b) => a.kind === "dir" && b.kind !== "dir" ? -1
        : b.kind === "dir" && a.kind !== "dir" ? 1 : a.name.localeCompare(b.name));
      const next = mergeDirectoryListing(current, destinationParent === root ? null : destinationParent, children);
      treeItemsRef.current = next;
      return next;
    });
    requestRevealInTree(destPath);
    // Do one authoritative reconciliation after paint, without blocking paste.
    if (reconcile) window.requestAnimationFrame(() => {
      if ((workspacePathRef.current || workspacePath) !== root) return;
      void refreshDirectory(destinationParent).catch(error => setExplorerError(messageFromError(error)));
    });
  };

  /**
   * Write local OS files (clipboard paste, Finder drop, Upload…) into a remote folder.
   * Any file type is accepted (fonts, zip, images, binaries…) — content is base64 SFTP write.
   */
  const uploadLocalFiles = async (destinationParent: string, files: File[]) => {
    if (files.length === 0) return false;
    if (appPreferences.permissionMode === "read-only") {
      setExplorerError("Read-only mode: upload is disabled.");
      return false;
    }
    if (connectionStateRef.current !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }
    if (!destinationParent) {
      setExplorerError("Select a folder in the tree to upload into.");
      return false;
    }

    let lastPath: string | null = null;
    const created: {path:string; kind:FileTreeItem["kind"]}[] = [];
    try {
      for (const file of files) {
        const preferredName = file.name?.trim() || "uploaded-file";
        const { name: destName, path: destPath } = await resolveUniqueDestPath(
          destinationParent,
          preferredName,
          false,
        );
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > 50 * 1024 * 1024) {
          setExplorerError(`"${destName}" is too large to upload (max 50 MB).`);
          return false;
        }
        // Empty files are allowed (e.g. placeholder assets).
        // New path → no etag. resolveUniqueDestPath avoids clobbering existing files.
        await api.writeFile(destPath, encodeBytesToBase64(bytes), null);
        created.push({path:destPath, kind:"file"});
        lastPath = destPath;
        revealAfterPaste(destinationParent, destPath, "file", false);
      }

      if (lastPath) revealAfterPaste(destinationParent, lastPath);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error) || "Upload failed.");
      return false;
    } finally {
      if (created.length) pushTreeUndo({type:"create", items:created});
    }
  };

  /** Write an OS-clipboard file (e.g. Figma/Discord image) into a tree folder. */
  const pasteOsClipboardFiles = async (
    destinationParent: string,
    files: File[],
  ) => uploadLocalFiles(destinationParent, files);

  const handlePasteTreeItem = async (contextItem?: FileTreeItem) => {
    if (connectionState !== "connected" || !workspacePath) {
      setExplorerError(
        connectionState === "connected"
          ? "Select a workspace first."
          : "Connect to a server first.",
      );
      return false;
    }

    const destinationParent = resolvePasteParent(contextItem);
    if (!destinationParent) {
      setExplorerError("Select a folder (or file) in the tree to paste into.");
      return false;
    }

    // 1) OS clipboard images/files (Figma, Discord, screenshots…) take priority
    // when present — that's what the user just copied outside the app.
    const osFiles =
      (treeClipboardRef.current ?? treeClipboard)?.mode === "cut"
        ? []
        : await readOsClipboardFiles();
    if (osFiles.length > 0) {
      return pasteOsClipboardFiles(destinationParent, osFiles);
    }

    // 2) Internal tree clipboard (Cmd+C on a remote file/folder).
    const clip = treeClipboardRef.current ?? treeClipboard;
    if (clip) {
      // Cannot paste a folder into itself or a descendant.
      if (
        clip.kind === "dir" &&
        isPathOrDescendant(destinationParent, clip.path)
      ) {
        setExplorerError("Cannot paste a folder into itself or a subfolder.");
        return false;
      }

      if (clip.mode === "cut") {
        const moved =
          getParentPath(clip.path) === destinationParent ||
          (await handleMoveTreeItem(
            {
              id: clip.path,
              path: clip.path,
              name: clip.name,
              kind: clip.kind,
              depth: 0,
            },
            destinationParent,
          ));
        if (moved && getParentPath(clip.path) !== destinationParent) {
          pushTreeUndo({type:"move", source:clip.path, destination:joinRemotePath(destinationParent, clip.name), kind:clip.kind});
        }
        if (moved) {
          treeClipboardRef.current = null;
          setTreeClipboard(null);
        }
        return Boolean(moved);
      }
      // Paste is intentional, but must still honor read-only mode.
      if (appPreferences.permissionMode === "read-only") {
        setExplorerError("Read-only mode: paste is disabled.");
        return false;
      }
      try {
        const forceSuffix = getParentPath(clip.path) === destinationParent;
        const { path: destPath } = await resolveUniqueDestPath(destinationParent, clip.name, forceSuffix);
        if (destPath === clip.path) {
          setExplorerError("Source and destination are the same.");
          return false;
        }
        await api.copyFile(clip.path, destPath);
        pushTreeUndo({type:"create", items:[{path:destPath, kind:clip.kind}]});
        revealAfterPaste(destinationParent, destPath, clip.kind);
        setExplorerError("");
        return true;
      } catch (error) {
        setExplorerError(messageFromError(error));
        return false;
      }
    }

    setExplorerError(
      "Nothing to paste. Copy a file in the tree, or copy an image (Figma, screenshot…).",
    );
    return false;
  };
  return { handleCopyTreeItem, handleCutTreeItem, handleDuplicateTreeItem, uploadLocalFiles, handlePasteTreeItem };
}
