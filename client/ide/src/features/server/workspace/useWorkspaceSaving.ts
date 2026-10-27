import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, encodeTextToBase64 } from "../../../shared/api/client";
import { isUntitledPath } from "./untitledFile";
import { workspaceBasename } from "../../../shared/lib/workspacePath";
import {
  getAgentEditReview,
  updateAgentEditReviewAfter,
} from "../../editor/agentEditBridge";
import { lspSyncChange, lspSyncSave } from "../../editor/lsp/documentSync";
import { lspSessionManager } from "../../editor/lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../editor/lsp/pathUri";
import { applyLineEdits } from "../../editor/lsp/textEdits";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import type { AppPreferences } from "../../settings/preferences";
import { messageFromError } from "./connectionValidation";
import { fingerprintEntries, getParentPath } from "./treeModel";
import { type ConnectionState, type EditorBuffer } from "./types";

interface Dependencies {
  appPreferences: AppPreferences;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  selectedFileRef: RefObject<string | null>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  suppressEditorWatchUntilRef: RefObject<number>;
  editorEtagRef: RefObject<string | null>;
  editorValueRef: RefObject<string>;
  editorDirtyRef: RefObject<boolean>;
  autoSavePendingRef: RefObject<boolean>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorError: Dispatch<SetStateAction<string>>;
  dirFingerprintsRef: RefObject<Map<string, string>>;
  saveEditorBufferRef: RefObject<
    (
      path: string,
      buffer: EditorBuffer,
      options?: { format?: boolean },
    ) => Promise<string | null>
  >;
  selectedFile: string | null;
  editorDirty: boolean;
  editorLoading: boolean;
  editorTruncated: boolean;
  editorEtag: string | null;
  connectionState: ConnectionState;
  requestWritePermission: (
    action: string,
    dangerous?: boolean,
    options?: { skipConfirm?: boolean },
  ) => boolean;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  editorTruncatedRef: RefObject<boolean>;
  editorImageUrlRef: RefObject<string | null>;
  dirtyFiles: Set<string>;
  connectionStateRef: RefObject<ConnectionState>;
  autoSaveTimerRef: RefObject<number | null>;
  autoSaveInFlightRef: RefObject<boolean>;
}
export function useWorkspaceSaving({
  appPreferences,
  editorBuffersRef,
  selectedFileRef,
  setEditorValue,
  suppressEditorWatchUntilRef,
  editorEtagRef,
  editorValueRef,
  editorDirtyRef,
  autoSavePendingRef,
  setDirtyFiles,
  setEditorEtag,
  setEditorDirty,
  setEditorError,
  dirFingerprintsRef,
  saveEditorBufferRef,
  selectedFile,
  editorDirty,
  editorLoading,
  editorTruncated,
  editorEtag,
  connectionState,
  requestWritePermission,
  setEditorLoading,
  editorTruncatedRef,
  editorImageUrlRef,
  dirtyFiles,
  connectionStateRef,
  autoSaveTimerRef,
  autoSaveInFlightRef,
}: Dependencies) {
  const saveEditorBuffer = async (
    path: string,
    buffer: EditorBuffer,
    options?: { format?: boolean },
  ) => {
    if (buffer.imageUrl !== null) {
      return "Image previews are read only and cannot be saved in the editor.";
    }
    if (buffer.truncated) {
      return "Large file previews are read only and cannot be saved.";
    }

    try {
      if (options?.format !== false && lspDocumentLanguageId(path)) {
        try {
          let next = buffer.value;
          const organized = await lspSessionManager.organizeImports(path);
          if (organized.length) {
            next = applyLineEdits(next, organized);
            lspSyncChange(path, next);
          }
          const formatted = await lspSessionManager.formatDocument(path, {
            tabSize: appPreferences.editorTabSize,
            insertSpaces: appPreferences.editorInsertSpaces,
          });
          if (formatted.length) next = applyLineEdits(next, formatted);
          if (next !== buffer.value) {
            buffer = { ...buffer, value: next };
            editorBuffersRef.current.set(path, { ...buffer });
            lspSyncChange(path, next);
            if (selectedFileRef.current === path) setEditorValue(next);
          }
        } catch (error) {
          console.warn("[LSP] organize/format on save failed", error);
        }
      }
      const response = await api.writeFile(
        path,
        encodeTextToBase64(buffer.value),
        buffer.etag,
      );
      // Own write just landed — don't treat the new etag / mtime as an external change.
      // Also covers tree fingerprints (size/mtime) so remote-watch won't rebuild the file tree.
      suppressEditorWatchUntilRef.current = Date.now() + 4_000;
      // Update the ref immediately so a trailing autosave (0ms) does not
      // reuse the pre-write etag before React commits setEditorEtag.
      if (selectedFileRef.current === path) {
        editorEtagRef.current = response.etag;
      }
      const stillDirty =
        selectedFileRef.current === path &&
        editorValueRef.current !== buffer.value;
      if (selectedFileRef.current === path) {
        editorDirtyRef.current = stillDirty;
      }
      if (stillDirty) autoSavePendingRef.current = true;
      const savedBuffer: EditorBuffer = {
        ...buffer,
        dirty: stillDirty,
        error: "",
        etag: response.etag,
        value: stillDirty ? editorValueRef.current : buffer.value,
      };
      editorBuffersRef.current.set(path, savedBuffer);
      setDirtyFiles((current) => {
        if (stillDirty) {
          const next = new Set(current);
          next.add(path);
          return next;
        }
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      if (selectedFileRef.current === path) {
        setEditorEtag(response.etag);
        setEditorDirty(stillDirty);
        setEditorError("");
      }
      void lspSyncSave(path, buffer.value);
      // Refresh parent dir fingerprint to the post-save listing without touching tree UI.
      const parent = getParentPath(path);
      void api
        .listFiles(parent)
        .then((listed) => {
          dirFingerprintsRef.current.set(
            parent,
            fingerprintEntries(listed.entries),
          );
        })
        .catch(() => {
          // Best-effort; suppress window still covers the next poll ticks.
        });
      return null;
    } catch (error) {
      const message = messageFromError(error);
      editorBuffersRef.current.set(path, { ...buffer, error: message });
      if (selectedFileRef.current === path) setEditorError(message);
      return message;
    }
  };
  saveEditorBufferRef.current = saveEditorBuffer;

  const saveSelectedFile = async () => {
    if (
      !selectedFile ||
      !editorDirty ||
      editorLoading ||
      editorTruncated ||
      editorEtag === null ||
      connectionState !== "connected"
    )
      return;
    if (
      !requestWritePermission(
        `Save "${workspaceBasename(selectedFile)}"`,
        false,
        { skipConfirm: true },
      )
    )
      return;

    setEditorLoading(true);
    setEditorError("");

    await saveEditorBuffer(selectedFile, {
      dirty: editorDirtyRef.current,
      error: "",
      etag: editorEtagRef.current,
      truncated: editorTruncatedRef.current,
      imageUrl: editorImageUrlRef.current,
      value: editorValueRef.current,
    });
    setEditorLoading(false);
  };

  const saveAllFiles = async () => {
    if (connectionState !== "connected") return;
    if (!requestWritePermission("Save all files", false, { skipConfirm: true }))
      return;
    const paths = new Set(dirtyFiles);
    if (selectedFile && editorDirty) paths.add(selectedFile);
    for (const path of paths) {
      const buffer =
        path === selectedFileRef.current
          ? {
              dirty: true,
              error: "",
              etag: editorEtagRef.current,
              truncated: editorTruncatedRef.current,
              imageUrl: editorImageUrlRef.current,
              value: editorValueRef.current,
            }
          : editorBuffersRef.current.get(path);
      if (!buffer?.dirty || buffer.etag === null || buffer.truncated) continue;
      await saveEditorBuffer(path, buffer);
    }
  };

  const handleEditorChange = (value: string) => {
    if (
      appPreferences.permissionMode === "read-only" ||
      editorImageUrlRef.current !== null ||
      editorTruncatedRef.current ||
      (editorEtagRef.current === null && !isUntitledPath(selectedFileRef.current))
    )
      return;
    // Keep CodeMirror as source of truth while typing — pushing every
    // keystroke through React re-renders the explorer and feels laggy.
    editorValueRef.current = value;
    const path = selectedFileRef.current;
    if (path) {
      lspSyncChange(path, value);
      editorBuffersRef.current.set(path, {
        dirty: true,
        error: "",
        etag: editorEtagRef.current,
        imageUrl: null,
        truncated: false,
        value,
        agentStreaming: false,
      });
      if (!editorDirtyRef.current) {
        editorDirtyRef.current = true;
        setEditorDirty(true);
        setDirtyFiles((current) =>
          current.has(path) ? current : new Set(current).add(path),
        );
      }
      if (getAgentEditReview(path)) {
        updateAgentEditReviewAfter(path, value);
      }
      if (
        appPreferences.editorAutoSave &&
        connectionStateRef.current === "connected" &&
        !isBrowserTabKey(path)
      ) {
        if (autoSaveTimerRef.current != null)
          window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = window.setTimeout(() => {
          autoSaveTimerRef.current = null;
          const savePath = selectedFileRef.current;
          if (!savePath || savePath !== path) return;
          if (!editorDirtyRef.current) return;
          if (editorImageUrlRef.current !== null || editorTruncatedRef.current)
            return;
          const etag = editorEtagRef.current;
          if (etag === null) return;
          if (connectionStateRef.current !== "connected") return;
          if (autoSaveInFlightRef.current) {
            autoSavePendingRef.current = true;
            return;
          }
          const flush = () => {
            if (selectedFileRef.current !== path) return;
            if (!editorDirtyRef.current) return;
            if (
              editorImageUrlRef.current !== null ||
              editorTruncatedRef.current
            )
              return;
            const nextEtag = editorEtagRef.current;
            if (nextEtag === null) return;
            if (connectionStateRef.current !== "connected") return;
            if (autoSaveInFlightRef.current) {
              autoSavePendingRef.current = true;
              return;
            }
            autoSaveInFlightRef.current = true;
            autoSavePendingRef.current = false;
            void saveEditorBufferRef
              .current(
                path,
                {
                  dirty: true,
                  error: "",
                  etag: nextEtag,
                  imageUrl: null,
                  truncated: false,
                  value: editorValueRef.current,
                },
                { format: false },
              )
              .finally(() => {
                autoSaveInFlightRef.current = false;
                if (!autoSavePendingRef.current) return;
                autoSavePendingRef.current = false;
                flush();
              });
          };
          flush();
        }, 250);
      }
    }
  };

  return { saveSelectedFile, saveAllFiles, handleEditorChange };
}
