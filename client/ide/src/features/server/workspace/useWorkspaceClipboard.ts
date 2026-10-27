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
  itemDepthUnderRoot,
  joinRemotePath
} from "./treeModel";
import {
  type ConnectionState
} from "./types";
interface Dependencies {
  treeClipboardRef: RefObject<{ path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null>;
  setTreeClipboard: Dispatch<SetStateAction<{ path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null>>;
  setExplorerError: Dispatch<SetStateAction<string>>;
  appPreferences: AppPreferences;
  workspacePathRef: RefObject<string>;
  workspacePath: string;
  treeItemsRef: RefObject<FileTreeItem[]>;
  openFilesRef: RefObject<string[]>;
  connectionState: ConnectionState;
  requestWritePermission: (action: string, dangerous?: boolean, options?: { skipConfirm?: boolean; }) => boolean;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  refreshDirectory: (path: string) => Promise<void>;
  requestRevealInTree: (path: string) => void;
  selectedFileRef: RefObject<string | null>;
  selectedFile: string | null;
  setLoadedDirs: Dispatch<SetStateAction<Set<string>>>;
  loadedDirsRef: RefObject<Set<string>>;
  loadDirectory: (path: string, depth: number, replaceRoot?: boolean, allowDuringConnect?: boolean, options?: { quiet?: boolean; force?: boolean; }) => Promise<boolean>;
  connectionStateRef: RefObject<ConnectionState>;
  treeClipboard: { path: string; name: string; kind: FileTreeItem["kind"]; mode?: "copy" | "cut"; } | null;
  handleMoveTreeItem: (item: FileTreeItem, targetDirPath: string) => Promise<boolean>;
}

export function useWorkspaceClipboard({
  treeClipboardRef,
  setTreeClipboard,
  setExplorerError,
  appPreferences,
  workspacePathRef,
  workspacePath,
  treeItemsRef,
  openFilesRef,
  connectionState,
  requestWritePermission,
  setExpandedIds,
  expandedIdsRef,
  refreshDirectory,
  requestRevealInTree,
  selectedFileRef,
  selectedFile,
  setLoadedDirs,
  loadedDirsRef,
  loadDirectory,
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

  const resolveUniqueDestPath = (
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
    const name = buildCopyName(preferredName, siblingNames, forceCopySuffix);
    return { name, path: joinRemotePath(parent, name) };
  };

  const handleDuplicateTreeItem = async (item: FileTreeItem) => {
    if (connectionState !== "connected") {
      setExplorerError("Connect to a server first.");
      return false;
    }

    const sourcePath = getItemPath(item);
    const parent = getParentPath(sourcePath);
    const { name: destName, path: destPath } = resolveUniqueDestPath(
      parent,
      item.name,
      true,
    );

    if (!requestWritePermission(`Duplicate "${item.name}" as "${destName}"`)) {
      return false;
    }

    try {
      await api.copyFile(sourcePath, destPath);
      if (parent !== workspacePath) {
        setExpandedIds((current) => {
          const next = new Set(current).add(parent);
          expandedIdsRef.current = next;
          return next;
        });
      }
      await refreshDirectory(parent);
      requestRevealInTree(destPath);
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

  const revealAfterPaste = async (
    destinationParent: string,
    destPath: string,
  ) => {
    const root = workspacePathRef.current || workspacePath;
    // Expand destination first so the refreshed children are visible immediately.
    if (root && destinationParent !== root) {
      setExpandedIds((current) => {
        const next = new Set(current).add(destinationParent);
        expandedIdsRef.current = next;
        return next;
      });
    }
    setLoadedDirs((current) => {
      const next = new Set(current).add(destinationParent);
      loadedDirsRef.current = next;
      return next;
    });

    await refreshDirectory(destinationParent);
    const stillMissing = !treeItemsRef.current.some(
      (item) => getItemPath(item) === destPath,
    );
    if (stillMissing && root) {
      const depth =
        destinationParent === root
          ? 0
          : itemDepthUnderRoot(destinationParent, root) + 1;
      await loadDirectory(
        destinationParent,
        depth,
        destinationParent === root,
        false,
        { force: true },
      );
    }

    requestRevealInTree(destPath);
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
    try {
      // Ensure destination folder exists (and is a dir) before writing children.
      try {
        await api.mkdir(destinationParent);
      } catch {
        // already exists — fine
      }

      for (const file of files) {
        const preferredName = file.name?.trim() || "uploaded-file";
        const { name: destName, path: destPath } = resolveUniqueDestPath(
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
        lastPath = destPath;
      }

      if (lastPath) await revealAfterPaste(destinationParent, lastPath);
      setExplorerError("");
      return true;
    } catch (error) {
      setExplorerError(messageFromError(error) || "Upload failed.");
      return false;
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
        if (moved) {
          treeClipboardRef.current = null;
          setTreeClipboard(null);
        }
        return Boolean(moved);
      }
      const forceSuffix = getParentPath(clip.path) === destinationParent;
      const { path: destPath } = resolveUniqueDestPath(
        destinationParent,
        clip.name,
        forceSuffix,
      );

      if (destPath === clip.path) {
        setExplorerError("Source and destination are the same.");
        return false;
      }

      // Paste is intentional (Cmd+V) — no confirm dialog; still honor read-only.
      if (appPreferences.permissionMode === "read-only") {
        setExplorerError("Read-only mode: paste is disabled.");
        return false;
      }

      try {
        await api.copyFile(clip.path, destPath);
        await revealAfterPaste(destinationParent, destPath);
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
