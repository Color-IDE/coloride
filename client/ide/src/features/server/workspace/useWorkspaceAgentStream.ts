import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, decodeBase64ToText } from "../../../shared/api/client";
import {
  clearAgentEditReview,
  queueAgentEditHighlight,
} from "../../editor/agentEditBridge";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import { isApiNotFound, messageFromError } from "./connectionValidation";
import { getImageMimeType } from "./editorFiles";
import {
  getItemPath,
  getParentPath,
  isDirectoryEditorPath,
  isUnderWorkspace,
  itemDepthUnderRoot,
} from "./treeModel";
import {
  type ApplyAgentFileStreamInput,
  type ConnectionState,
  type EditorBuffer,
} from "./types";

interface Dependencies {
  editorRevealTokenRef: RefObject<number>;
  setEditorReveal: Dispatch<
    SetStateAction<{
      path: string;
      line: number;
      column?: number;
      token: number;
    } | null>
  >;
  connectionStateRef: RefObject<ConnectionState>;
  clearAgentEditBaseline: (path?: string) => void;
  reloadEditorFromRemoteRef: RefObject<
    (path: string, options?: { force?: boolean }) => Promise<boolean>
  >;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
  refreshDirectory: (path: string) => Promise<void>;
  applyDeletedPaths: (deletedPaths: string[]) => Promise<void>;
  workspacePathRef: RefObject<string>;
  dirFingerprintsRef: RefObject<Map<string, string>>;
  loadDirectory: (
    path: string,
    depth: number,
    replaceRoot?: boolean,
    allowDuringConnect?: boolean,
    options?: { quiet?: boolean; force?: boolean },
  ) => Promise<boolean>;
  treeItemsRef: RefObject<FileTreeItem[]>;
  selectedFileRef: RefObject<string | null>;
  setEditorError: Dispatch<SetStateAction<string>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  setOpenFiles: Dispatch<SetStateAction<string[]>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setAgentStreamingPaths: Dispatch<SetStateAction<Set<string>>>;
  setSelectedFile: Dispatch<SetStateAction<string | null>>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  editorDirtyRef: RefObject<boolean>;
  suppressEditorWatchUntilRef: RefObject<number>;
  editorEtagRef: RefObject<string | null>;
  activateEditorFile: (
    path: string,
    rememberCurrent?: boolean,
    options?: { reveal?: boolean },
  ) => Promise<boolean | undefined>;
  openFilesRef: RefObject<string[]>;
  rememberActiveEditor: () => void;
  captureAgentEditBaseline: (
    path: string,
    opts?: {
      isActive?: boolean;
      cachedValue?: string | null;
      agentStreaming?: boolean;
    },
  ) => string;
  agentEditBaseRef: RefObject<Map<string, string>>;
  revealInTree: (path: string) => Promise<boolean>;
  setExplorerError: Dispatch<SetStateAction<string>>;
  clearRemoteWorkspace: () => void;
  activateWorkspaceRef: RefObject<
    (
      path: string,
      options?: {
        persist?: boolean;
        forceReload?: boolean;
        skipAccessSetup?: boolean;
      },
    ) => Promise<boolean>
  >;
}
export function useWorkspaceAgentStream({
  editorRevealTokenRef,
  setEditorReveal,
  connectionStateRef,
  clearAgentEditBaseline,
  reloadEditorFromRemoteRef,
  setMissingFiles,
  refreshDirectory,
  applyDeletedPaths,
  workspacePathRef,
  dirFingerprintsRef,
  loadDirectory,
  treeItemsRef,
  selectedFileRef,
  setEditorError,
  editorBuffersRef,
  setOpenFiles,
  setDirtyFiles,
  setAgentStreamingPaths,
  setSelectedFile,
  setEditorValue,
  setEditorImageUrl,
  setEditorEtag,
  setEditorDirty,
  setEditorTruncated,
  setEditorLoading,
  editorDirtyRef,
  suppressEditorWatchUntilRef,
  editorEtagRef,
  activateEditorFile,
  openFilesRef,
  rememberActiveEditor,
  captureAgentEditBaseline,
  agentEditBaseRef,
  revealInTree,
  setExplorerError,
  clearRemoteWorkspace,
  activateWorkspaceRef,
}: Dependencies) {
  const requestEditorReveal = (
    path: string,
    line?: number,
    column?: number,
  ) => {
    if (!line || line < 1) return;
    editorRevealTokenRef.current += 1;
    setEditorReveal({
      path,
      line,
      column: column && column > 0 ? column : undefined,
      token: editorRevealTokenRef.current,
    });
  };

  /**
   * Apply agent write/edit into the Explorer editor (Cursor-style live buffer).
   * - streaming: open tab + set content without marking user-dirty
   * - final: set content (or reload from remote) and clear streaming flag
   * Skips clobber when the user has unsaved edits (unless already agentStreaming).
   */
  const applyAgentFileStream = async (
    input: ApplyAgentFileStreamInput,
  ): Promise<boolean> => {
    const path = (input.path || "").trim();
    if (!path || isBrowserTabKey(path)) return false;
    if (connectionStateRef.current !== "connected") return false;

    if (input.restored && input.phase === "final") {
      clearAgentEditReview(path);
      clearAgentEditBaseline(path);
      // Use the normal disk refresh: preserve focus and unsaved user buffers,
      // handle missing files, and never paint the inverse change as a new review.
      const refreshed = await reloadEditorFromRemoteRef.current(path);
      if (refreshed) {
        setMissingFiles((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
      const parent = getParentPath(path);
      if (parent) await refreshDirectory(parent);
      return refreshed;
    }

    if (input.phase === "deleted") {
      await applyDeletedPaths([path]);
      const parent = getParentPath(path);
      const root = workspacePathRef.current;
      const refreshTarget = parent && parent !== path ? parent : root;
      if (refreshTarget) {
        dirFingerprintsRef.current.delete(refreshTarget);
        const isRoot = refreshTarget === root;
        if (isRoot) {
          await loadDirectory(refreshTarget, 0, true, false, { force: true });
        } else {
          const row = treeItemsRef.current.find(
            (item) => getItemPath(item) === refreshTarget,
          );
          const depth = row
            ? row.depth + 1
            : root
              ? itemDepthUnderRoot(refreshTarget, root) + 1
              : 0;
          await loadDirectory(refreshTarget, depth, false, false, {
            force: true,
          });
        }
      }
      return true;
    }

    // Tool arguments are streamed before the VPS confirms the mutation. If the
    // tool later fails, restore an existing remote file or remove the phantom
    // tab created by the optimistic preview.
    if (input.phase === "failed") {
      try {
        const response = await api.readFile(path);
        clearAgentEditBaseline(path);
        return applyAgentFileStream({
          path,
          content: decodeBase64ToText(response.content),
          phase: "final",
          etag: response.etag,
        });
      } catch (error) {
        if (!isApiNotFound(error)) {
          if (selectedFileRef.current === path)
            setEditorError(messageFromError(error));
          return false;
        }

        editorBuffersRef.current.delete(path);
        clearAgentEditBaseline(path);
        setOpenFiles((current) =>
          current.filter((candidate) => candidate !== path),
        );
        setDirtyFiles((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        setAgentStreamingPaths((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        if (selectedFileRef.current === path) {
          setSelectedFile(null);
          setEditorValue("");
          setEditorImageUrl(null);
          setEditorEtag(null);
          setEditorDirty(false);
          setEditorTruncated(false);
          setEditorError("");
          setEditorLoading(false);
        }

        const parent = getParentPath(path);
        if (parent) await refreshDirectory(parent);
        return true;
      }
    }

    // Never open directories as editor tabs.
    const rootNow = workspacePathRef.current;
    if (
      isDirectoryEditorPath(path, rootNow, treeItemsRef.current, getItemPath)
    ) {
      return false;
    }

    const cached = editorBuffersRef.current.get(path);
    const isActive = selectedFileRef.current === path;
    const userDirty = isActive
      ? editorDirtyRef.current
      : Boolean(cached?.dirty && !cached?.agentStreaming);
    const agentOwned =
      Boolean(cached?.agentStreaming) || input.phase === "streaming";

    if (userDirty && !agentOwned) {
      if (input.phase === "final" && isActive) {
        setEditorError((current) =>
          current.includes("Agent updated")
            ? current
            : "Agent updated this file on the server. Save or discard local edits, then reopen to load the remote version.",
        );
      }
      return false;
    }

    suppressEditorWatchUntilRef.current = Date.now() + 6_000;

    let nextValue = input.content;
    let nextEtag =
      input.etag ?? cached?.etag ?? (isActive ? editorEtagRef.current : null);

    if (input.phase === "final" && (input.reload || nextValue == null)) {
      try {
        if (getImageMimeType(path)) {
          // Images: open normally (no text stream).
          await activateEditorFile(path, true, { reveal: true });
          return true;
        }
        const response = await api.readFile(path);
        nextValue = decodeBase64ToText(response.content);
        nextEtag = response.etag;
      } catch (error) {
        if (isApiNotFound(error)) {
          const existing = editorBuffersRef.current.get(path);
          editorBuffersRef.current.set(path, {
            dirty: false,
            error: "",
            etag: existing?.etag ?? null,
            imageUrl: existing?.imageUrl ?? null,
            missing: true,
            truncated: existing?.truncated ?? false,
            value: existing?.value ?? "",
            agentStreaming: existing?.agentStreaming,
          });
          setMissingFiles((current) =>
            current.has(path) ? current : new Set(current).add(path),
          );
          if (isActive) setEditorError("");
          return false;
        }
        if (isActive) setEditorError(messageFromError(error));
        return false;
      }
    }

    // Open-only (tool just started) or live replace_in_file stream:
    if (nextValue == null) {
      if (input.phase !== "streaming") return false;
      const alreadyOpen = openFilesRef.current.includes(path);
      if (!alreadyOpen) {
        await activateEditorFile(path, true, { reveal: true });
      } else if (selectedFileRef.current !== path) {
        rememberActiveEditor();
        setSelectedFile(path);
        const buf = editorBuffersRef.current.get(path);
        if (buf) {
          setEditorValue(buf.value);
          setEditorImageUrl(buf.imageUrl);
          setEditorEtag(buf.etag);
          setEditorDirty(Boolean(buf.dirty));
          setEditorTruncated(buf.truncated);
          setEditorError(buf.error);
          setEditorLoading(false);
        }
      }
      const existing = editorBuffersRef.current.get(path);
      if (existing) {
        editorBuffersRef.current.set(path, {
          ...existing,
          agentStreaming: true,
        });
      }
      // Capture baseline once for the whole pending-review session. If a review
      // is already open (agent edited this path before Keep/Undo), keep its
      // original `before` so later edits accumulate instead of auto-accepting.
      const baseForReplace = captureAgentEditBaseline(path, {
        isActive,
        cachedValue: existing?.value ?? cached?.value,
        agentStreaming: true,
      });
      setAgentStreamingPaths((current) => {
        if (current.has(path)) return current;
        const next = new Set(current);
        next.add(path);
        return next;
      });
      if (
        typeof input.oldText === "string" &&
        input.oldText.length > 0 &&
        typeof input.newText === "string" &&
        typeof baseForReplace === "string" &&
        baseForReplace.includes(input.oldText)
      ) {
        nextValue = input.replaceAll
          ? baseForReplace.split(input.oldText).join(input.newText)
          : baseForReplace.replace(input.oldText, input.newText);
      } else {
        return true;
      }
    }

    // Ensure tab is open and focused.
    if (selectedFileRef.current && selectedFileRef.current !== path) {
      rememberActiveEditor();
    }
    setOpenFiles((current) =>
      current.includes(path) ? current : [...current, path],
    );
    setSelectedFile(path);

    // Baseline for green/red: stable across multiple agent edits until Keep/Undo.
    const beforeValue = captureAgentEditBaseline(path, {
      isActive,
      cachedValue: cached?.value,
      agentStreaming:
        input.phase === "streaming" || Boolean(cached?.agentStreaming),
    });
    // Paint green/red once the write is committed (final), not on every stream tick.
    // Diff against the first unreviewed baseline so edit #2 accumulates with edit #1.
    if (input.phase === "final") {
      if (beforeValue !== nextValue) {
        queueAgentEditHighlight(path, beforeValue, nextValue);
        // Keep baseline while review stays open (second edit must not reset it).
        agentEditBaseRef.current.set(path, beforeValue);
      } else {
        clearAgentEditBaseline(path);
      }
    }

    const buffer: EditorBuffer = {
      dirty: false,
      error: "",
      etag: nextEtag,
      imageUrl: null,
      truncated: false,
      value: nextValue,
      agentStreaming: input.phase === "streaming",
    };
    editorBuffersRef.current.set(path, buffer);
    setDirtyFiles((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
    setAgentStreamingPaths((current) => {
      if (input.phase === "streaming") {
        if (current.has(path)) return current;
        const next = new Set(current);
        next.add(path);
        return next;
      }
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });

    setEditorValue(nextValue);
    setEditorImageUrl(null);
    setEditorEtag(nextEtag);
    setEditorDirty(false);
    setEditorTruncated(false);
    setEditorError("");
    setEditorLoading(false);

    if (input.phase === "final") {
      // Soft reveal in tree (non-blocking).
      void revealInTree(path);
    }

    return true;
  };

  const openRemoteFile = async (
    path: string,
    options?: { line?: number; column?: number },
  ) => {
    if (connectionStateRef.current !== "connected") {
      setExplorerError("Connect to a server first.");
      clearRemoteWorkspace();
      return false;
    }

    const root = workspacePathRef.current;

    // Prefer revealing inside the current workspace instead of resetting the tree root.
    if (root && isUnderWorkspace(path, root)) {
      await activateEditorFile(path, true, { reveal: true });
      requestEditorReveal(path, options?.line, options?.column);
      return true;
    }

    const parent = getParentPath(path);
    const loadedParent = await activateWorkspaceRef.current(parent, {
      persist: true,
      forceReload: true,
    });
    if (!loadedParent) return false;
    await activateEditorFile(path, true, { reveal: true });
    requestEditorReveal(path, options?.line, options?.column);
    return true;
  };

  return { requestEditorReveal, applyAgentFileStream, openRemoteFile };
}
