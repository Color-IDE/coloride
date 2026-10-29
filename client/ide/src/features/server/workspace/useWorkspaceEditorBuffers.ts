import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, decodeBase64ToText } from "../../../shared/api/client";
import {
  resolveReviewBufferText,
  updateAgentEditReviewAfter,
} from "../../editor/agentEditBridge";
import { isAgentLogTabKey } from "../../editor/agentLogTab";
import { lspSyncOpen } from "../../editor/lsp/documentSync";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import {
  isApiNotFound,
  isMissingFileError,
  messageFromError,
} from "./connectionValidation";
import {
  formatBytesShort,
  getImageMimeType,
  isKnownBinaryPath,
  isProbablyBinaryBase64,
  MAX_EDITOR_FETCH_BYTES,
} from "./editorFiles";
import {
  getAncestorDirsUnderRoot,
  getItemPath,
  getParentPath,
  isDirectoryEditorPath,
  isUnderWorkspace,
  itemDepthUnderRoot,
  normalizeRemotePath,
} from "./treeModel";
import { type ConnectionState, type EditorBuffer, type TreeUndoEntry } from "./types";
import { isUntitledPath } from "./untitledFile";

interface Dependencies {
  treeUndoStackRef: RefObject<TreeUndoEntry[]>;
  selectedFile: string | null;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  editorDirtyRef: RefObject<boolean>;
  editorError: string;
  editorEtagRef: RefObject<string | null>;
  editorImageUrlRef: RefObject<string | null>;
  editorTruncatedRef: RefObject<boolean>;
  editorValueRef: RefObject<string>;
  revealTokenRef: RefObject<number>;
  setRevealRequest: Dispatch<
    SetStateAction<{ path: string; token: number } | null>
  >;
  workspacePathRef: RefObject<string>;
  connectionStateRef: RefObject<ConnectionState>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  expandedIdsRef: RefObject<Set<string>>;
  loadedDirsRef: RefObject<Set<string>>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  loadDirectory: (
    path: string,
    depth: number,
    replaceRoot?: boolean,
    allowDuringConnect?: boolean,
    options?: { quiet?: boolean; force?: boolean },
  ) => Promise<boolean>;
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  selectedFileRef: RefObject<string | null>;
  editorLoadRequestRef: RefObject<number>;
  setAgentEditReviewTick: Dispatch<SetStateAction<number>>;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
}
export function useWorkspaceEditorBuffers({
  treeUndoStackRef,
  selectedFile,
  editorBuffersRef,
  editorDirtyRef,
  editorError,
  editorEtagRef,
  editorImageUrlRef,
  editorTruncatedRef,
  editorValueRef,
  revealTokenRef,
  setRevealRequest,
  workspacePathRef,
  connectionStateRef,
  setExpandedIds,
  expandedIdsRef,
  loadedDirsRef,
  treeItemsRef,
  loadDirectory,
  setOpenFiles,
  setSelectedFile,
  setEditorLoading,
  setEditorError,
  setEditorDirty,
  setEditorImageUrl,
  setEditorValue,
  setEditorEtag,
  setEditorTruncated,
  selectedFileRef,
  editorLoadRequestRef,
  setAgentEditReviewTick,
  setMissingFiles,
}: Dependencies) {
  const rememberActiveEditor = () => {
    if (!selectedFile) return;
    const prev = editorBuffersRef.current.get(selectedFile);
    editorBuffersRef.current.set(selectedFile, {
      dirty: editorDirtyRef.current,
      error: editorError,
      missing: Boolean(prev?.missing) || isMissingFileError(editorError),
      etag: editorEtagRef.current,
      imageUrl: editorImageUrlRef.current,
      truncated: editorTruncatedRef.current,
      value: editorValueRef.current,
      agentStreaming: prev?.agentStreaming,
    });
  };

  const requestRevealInTree = (path: string) => {
    revealTokenRef.current += 1;
    setRevealRequest({ path, token: revealTokenRef.current });
  };

  /** Expand + load ancestor folders so `path` is visible in the explorer tree, then scroll to it. */
  const revealInTree = async (path: string) => {
    const root = workspacePathRef.current;
    if (!root || connectionStateRef.current !== "connected") return false;
    if (isBrowserTabKey(path) || !isUnderWorkspace(path, root)) return false;

    const ancestors = getAncestorDirsUnderRoot(path, root);

    // Expand all ancestors (and keep root loaded).
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const dir of ancestors) next.add(dir);
      expandedIdsRef.current = next;
      return next;
    });

    // Load each ancestor that isn't loaded yet, parent → child.
    for (const dir of ancestors) {
      if (loadedDirsRef.current.has(dir)) continue;
      const stillMissing = !treeItemsRef.current.some(
        (item) => getItemPath(item) === dir,
      );
      // Parent list may already include this dir as a closed folder row; still need its children.
      const childDepth = itemDepthUnderRoot(dir, root) + 1;
      if (stillMissing || !loadedDirsRef.current.has(dir)) {
        await loadDirectory(dir, childDepth, false, false, { quiet: true });
      }
    }

    // If the file itself still isn't in the flat tree, reload its parent once more.
    const parent = getParentPath(path);
    if (
      parent &&
      !treeItemsRef.current.some((item) => getItemPath(item) === path)
    ) {
      if (parent === root) {
        await loadDirectory(root, 0, true, false, { quiet: true });
      } else if (isUnderWorkspace(parent, root)) {
        const childDepth = itemDepthUnderRoot(parent, root) + 1;
        await loadDirectory(parent, childDepth, false, false, { quiet: true });
      }
    }

    requestRevealInTree(path);
    return true;
  };

  const activateEditorFile = async (
    path: string,
    rememberCurrent = true,
    options?: { reveal?: boolean },
  ) => {
    const shouldReveal = options?.reveal === true;

    if (isAgentLogTabKey(path)) {
      if (rememberCurrent) rememberActiveEditor();
      const cached = editorBuffersRef.current.get(path);
      setOpenFiles((current) =>
        current.includes(path) ? current : [...current, path],
      );
      setSelectedFile(path);
      setEditorLoading(false);
      setEditorError("");
      setEditorDirty(false);
      setEditorImageUrl(null);
      setEditorValue(cached?.value ?? "");
      setEditorEtag(cached?.etag ?? "agent-log");
      setEditorTruncated(false);
      return true;
    }

    if (isBrowserTabKey(path)) {
      if (rememberCurrent) rememberActiveEditor();
      setOpenFiles((current) =>
        current.includes(path) ? current : [...current, path],
      );
      setSelectedFile(path);
      setEditorLoading(false);
      setEditorError("");
      setEditorDirty(false);
      setEditorImageUrl(null);
      setEditorValue("");
      setEditorEtag(null);
      setEditorTruncated(false);
      return;
    }

    // Never open folders (or the workspace root) as editor tabs.
    // Otherwise restore/select-workspace creates a phantom tab named after the
    // folder basename — e.g. workspace `/…/sites/www` → tab "www" with empty body.
    const rootNow = workspacePathRef.current;
    if (
      !isUntitledPath(path) &&
      isDirectoryEditorPath(path, rootNow, treeItemsRef.current, getItemPath)
    ) {
      setOpenFiles((current) =>
        current.filter(
          (file) =>
            file !== path &&
            normalizeRemotePath(file) !== normalizeRemotePath(path),
        ),
      );
      if (selectedFileRef.current === path) {
        setSelectedFile(null);
        setEditorValue("");
        setEditorImageUrl(null);
        setEditorEtag(null);
        setEditorDirty(false);
        setEditorError("");
        setEditorTruncated(false);
        setEditorLoading(false);
      }
      if (shouldReveal) void revealInTree(path);
      return false;
    }

    if (rememberCurrent) rememberActiveEditor();
    const imageMimeType = getImageMimeType(path);
    const knownBinary = isKnownBinaryPath(path);
    setOpenFiles((current) =>
      current.includes(path) ? current : [...current, path],
    );
    setSelectedFile(path);
    if (shouldReveal && !editorBuffersRef.current.get(path)?.missing) {
      void revealInTree(path);
    }
    const requestId = editorLoadRequestRef.current + 1;
    editorLoadRequestRef.current = requestId;

    let cached = editorBuffersRef.current.get(path);
    if (cached?.missing && !cached.value && !cached.imageUrl) {
      // Recover a tab that an earlier deletion handler left empty, using the
      // exact file snapshot already retained by tree Undo; do not restore to disk.
      const saved = [...treeUndoStackRef.current].reverse()
        .flatMap(entry => entry.type === "delete" ? entry.files : [])
        .find(file => file.path === path);
      if (saved && (imageMimeType || !isProbablyBinaryBase64(saved.contentBase64))) {
        cached = {...cached, error:"", value:imageMimeType ? "" : decodeBase64ToText(saved.contentBase64),
          imageUrl:imageMimeType ? `data:${imageMimeType};base64,${saved.contentBase64}` : null};
        editorBuffersRef.current.set(path, cached);
      }
    }
    if (cached) {
      // Pending Keep/Undo review: if the buffer was reset to the pre-agent
      // baseline, restore the post-agent text so green/red can paint again.
      const restoredValue = cached.missing ? cached.value : resolveReviewBufferText(path, cached.value);
      const buffer =
        restoredValue === cached.value
          ? cached
          : { ...cached, value: restoredValue, dirty: true };
      if (buffer !== cached) {
        editorBuffersRef.current.set(path, buffer);
        if (restoredValue !== cached.value) {
          updateAgentEditReviewAfter(path, restoredValue);
        }
      }
      setEditorValue(buffer.value);
      setEditorImageUrl(buffer.imageUrl);
      setEditorEtag(buffer.etag);
      setEditorDirty(buffer.dirty);
      setEditorTruncated(buffer.truncated);
      setEditorError(buffer.error);
      setEditorLoading(false);
      // Nudge editor to (re)paint green/red for this path.
      setAgentEditReviewTick((n) => n + 1);
      if (!buffer.missing && buffer.imageUrl === null && !buffer.truncated && !buffer.error) {
        void lspSyncOpen(path, buffer.value);
      }
      return;
    }

    setEditorLoading(true);
    setEditorError("");
    setEditorImageUrl(imageMimeType ? "" : null);

    const dropDirectoryTab = () => {
      editorBuffersRef.current.delete(path);
      setOpenFiles((current) => current.filter((file) => file !== path));
      if (selectedFileRef.current === path) {
        setSelectedFile(null);
        setEditorValue("");
        setEditorImageUrl(null);
        setEditorEtag(null);
        setEditorDirty(false);
        setEditorError("");
        setEditorTruncated(false);
      }
      setEditorLoading(false);
    };

    const applyBuffer = (buffer: EditorBuffer) => {
      const restored = resolveReviewBufferText(path, buffer.value);
      const next =
        restored === buffer.value
          ? buffer
          : {
              ...buffer,
              value: restored,
              dirty: buffer.dirty || restored !== buffer.value,
            };
      editorBuffersRef.current.set(path, next);
      if (editorLoadRequestRef.current !== requestId) return;
      setEditorValue(next.value);
      setEditorImageUrl(next.imageUrl);
      setEditorEtag(next.etag);
      setEditorDirty(next.dirty);
      setEditorTruncated(next.truncated);
      setEditorError(next.error);
      setEditorLoading(false);
      setAgentEditReviewTick((n) => n + 1);
    };

    try {
      // Cheap stat first — never download multi‑MB binaries into the renderer.
      let remoteSize: number | null = null;
      let remoteEtag: string | null = null;
      try {
        const stats = await api.statFiles(path);
        const entry = stats.entries?.[0];
        if (entry?.exists) {
          if (entry.kind === "dir") {
            dropDirectoryTab();
            if (shouldReveal) void revealInTree(path);
            return false;
          }
          remoteSize = typeof entry.size === "number" ? entry.size : null;
          remoteEtag = entry.etag ?? null;
        }
      } catch {
        // stat optional — fall through
      }

      const tooLargeToFetch =
        remoteSize != null && remoteSize > MAX_EDITOR_FETCH_BYTES;
      const treatAsBinary = knownBinary || (tooLargeToFetch && !imageMimeType);

      if (treatAsBinary || (imageMimeType && tooLargeToFetch)) {
        const sizeHint =
          remoteSize != null ? ` (${formatBytesShort(remoteSize)})` : "";
        applyBuffer({
          dirty: false,
          error: imageMimeType
            ? `Image too large to preview${sizeHint}.`
            : `Binary file${sizeHint} — cannot open in the text editor.`,
          etag: remoteEtag,
          imageUrl: imageMimeType ? "" : null,
          truncated: true,
          value: "",
        });
        return;
      }

      const response = await api.readFile(path);
      // Guard against huge payloads that skipped/failed stat.
      if (
        !imageMimeType &&
        response.content.length > 4_000_000 &&
        isProbablyBinaryBase64(response.content.slice(0, 8_000))
      ) {
        applyBuffer({
          dirty: false,
          error: "Binary file — cannot open in the text editor.",
          etag: response.etag,
          imageUrl: null,
          truncated: true,
          value: "",
        });
        return;
      }

      const binary =
        !imageMimeType &&
        !response.truncated &&
        isProbablyBinaryBase64(response.content);
      const rawValue =
        imageMimeType || binary ? "" : decodeBase64ToText(response.content);
      const restoredValue = resolveReviewBufferText(path, rawValue);
      const buffer: EditorBuffer = {
        dirty: restoredValue !== rawValue,
        error: binary ? "Binary file — cannot open in the text editor." : "",
        etag: response.etag,
        imageUrl:
          imageMimeType && !response.truncated
            ? `data:${imageMimeType};base64,${response.content}`
            : imageMimeType
              ? ""
              : null,
        // Mark truncated so the editor stays read-only for binaries too.
        truncated: response.truncated || binary,
        value: restoredValue,
      };
      editorBuffersRef.current.set(path, buffer);
      setMissingFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      if (editorLoadRequestRef.current !== requestId) return;
      setEditorValue(buffer.value);
      setEditorImageUrl(buffer.imageUrl);
      setEditorEtag(buffer.etag);
      setEditorDirty(buffer.dirty);
      setEditorTruncated(buffer.truncated);
      setEditorError(buffer.error);
      setAgentEditReviewTick((n) => n + 1);
      if (!imageMimeType && !binary && !buffer.truncated) {
        void lspSyncOpen(path, buffer.value);
      }
    } catch (error) {
      const missing = isApiNotFound(error);
      const previous = editorBuffersRef.current.get(path);
      const buffer: EditorBuffer = {
        dirty: previous?.dirty ?? false,
        error: missing
          ? previous ? "" : "This file has been deleted. No cached content is available."
          : messageFromError(error),
        etag: previous?.etag ?? null,
        imageUrl: previous?.imageUrl ?? (imageMimeType ? "" : null),
        missing,
        truncated: previous?.truncated ?? false,
        value: previous?.value ?? "",
      };
      setMissingFiles((current) => {
        const has = current.has(path);
        if (missing === has) return current;
        const next = new Set(current);
        if (missing) next.add(path);
        else next.delete(path);
        return next;
      });
      editorBuffersRef.current.set(path, buffer);
      if (editorLoadRequestRef.current !== requestId) return;
      setEditorValue(buffer.value);
      setEditorImageUrl(buffer.imageUrl);
      setEditorEtag(buffer.etag);
      setEditorDirty(buffer.dirty);
      setEditorTruncated(buffer.truncated);
      setEditorError(buffer.error);
    } finally {
      if (editorLoadRequestRef.current === requestId) setEditorLoading(false);
    }
  };

  return {
    rememberActiveEditor,
    requestRevealInTree,
    revealInTree,
    activateEditorFile,
  };
}
