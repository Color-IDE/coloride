import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  api,
  decodeBase64ToText
} from "../../../shared/api/client";
import {
  isBrowserTabKey
} from "../../explorer/BrowserPane";
import {
  isApiNotFound,
  isConnectionNotOpen,
  messageFromError
} from "./connectionValidation";
import {
  formatBytesShort,
  getImageMimeType,
  isKnownBinaryPath,
  isProbablyBinaryBase64
} from "./editorFiles";
import type { ConnectionState } from "./types";
import {
  type EditorBuffer
} from "./types";

interface Dependencies {
  workspacePathRef: RefObject<string>;
  connectionStateRef: RefObject<ConnectionState>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  selectedFileRef: RefObject<string | null>;
  editorDirtyRef: RefObject<boolean>;
  setEditorError: Dispatch<SetStateAction<string>>;
  editorLoadRequestRef: RefObject<number>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  setEditorLoading: Dispatch<SetStateAction<boolean>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  handleConnectionUnavailable: (message?: string) => void;
  setMissingFiles: Dispatch<SetStateAction<ReadonlySet<string>>>;
  reloadEditorFromRemoteRef: RefObject<(path: string, options?: { force?: boolean; }) => Promise<boolean>>;
}

export function createWorkspaceEditorReload({
  workspacePathRef,
  connectionStateRef,
  editorBuffersRef,
  selectedFileRef,
  editorDirtyRef,
  setEditorError,
  editorLoadRequestRef,
  setEditorValue,
  setEditorImageUrl,
  setEditorEtag,
  setEditorDirty,
  setEditorTruncated,
  setEditorLoading,
  setDirtyFiles,
  handleConnectionUnavailable,
  setMissingFiles,
  reloadEditorFromRemoteRef,
}: Dependencies) {

  /** Reload a clean editor buffer from the remote host (external change). */
  const reloadEditorFromRemote = async (
    path: string,
    options?: { force?: boolean },
  ) => {
    if (!path || isBrowserTabKey(path)) return false;
    if (connectionStateRef.current !== "connected") return false;

    const cached = editorBuffersRef.current.get(path);
    const isActive = selectedFileRef.current === path;
    const isDirty = isActive ? editorDirtyRef.current : Boolean(cached?.dirty);
    if (isDirty && !options?.force) {
      // Don't clobber unsaved edits — surface a soft notice on the active tab.
      if (isActive) {
        setEditorError((current) =>
          current.includes("changed on the server")
            ? current
            : "This file changed on the server. Save or discard local edits, then reopen to load the remote version.",
        );
      }
      return false;
    }

    const workspaceAtStart = workspacePathRef.current;
    const canApply = () => workspacePathRef.current === workspaceAtStart
      && connectionStateRef.current === "connected"
      && (!isActive || editorLoadRequestRef.current === requestId)
      && (options?.force || !(selectedFileRef.current === path
        ? editorDirtyRef.current : editorBuffersRef.current.get(path)?.dirty));
    const requestId = editorLoadRequestRef.current + 1;
    editorLoadRequestRef.current = requestId;
    const imageMimeType = getImageMimeType(path);

    try {
      // Never re-download known binaries / huge files on remote-watch reload.
      if (isKnownBinaryPath(path)) {
        const buffer: EditorBuffer = {
          dirty: false,
          error: "Binary file — cannot open in the text editor.",
          etag: null,
          imageUrl: null,
          truncated: true,
          value: "",
        };
        try {
          const stats = await api.statFiles(path);
          const entry = stats.entries?.[0];
          if (entry?.etag) buffer.etag = entry.etag;
          if (typeof entry?.size === "number") {
            buffer.error = `Binary file (${formatBytesShort(entry.size)}) — cannot open in the text editor.`;
          }
        } catch {
          // ignore
        }
        if (!canApply()) return false;
        editorBuffersRef.current.set(path, buffer);
        if (
          selectedFileRef.current === path &&
          editorLoadRequestRef.current === requestId
        ) {
          setEditorValue("");
          setEditorImageUrl(null);
          setEditorEtag(buffer.etag);
          setEditorDirty(false);
          setEditorTruncated(true);
          setEditorError(buffer.error);
          setEditorLoading(false);
        }
        return true;
      }

      const response = await api.readFile(path);
      if (!canApply()) return false;

      const binary =
        !imageMimeType &&
        !response.truncated &&
        isProbablyBinaryBase64(response.content);
      const buffer: EditorBuffer = {
        dirty: false,
        error: binary ? "Binary file — cannot open in the text editor." : "",
        etag: response.etag,
        imageUrl:
          imageMimeType && !response.truncated
            ? `data:${imageMimeType};base64,${response.content}`
            : imageMimeType
              ? ""
              : null,
        truncated: response.truncated || binary,
        value:
          imageMimeType || binary ? "" : decodeBase64ToText(response.content),
      };
      editorBuffersRef.current.set(path, buffer);
      setDirtyFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });

      if (
        selectedFileRef.current === path &&
        editorLoadRequestRef.current === requestId
      ) {
        setEditorValue(buffer.value);
        setEditorImageUrl(buffer.imageUrl);
        setEditorEtag(buffer.etag);
        setEditorDirty(false);
        setEditorTruncated(buffer.truncated);
        setEditorError(buffer.error);
        setEditorLoading(false);
      }
      return true;
    } catch (error) {
      if (!canApply()) return false;
      if (isConnectionNotOpen(error)) {
        handleConnectionUnavailable();
        return false;
      }
      if (!isApiNotFound(error)) {
        if (selectedFileRef.current === path)
          setEditorError(messageFromError(error));
        return false;
      }
      const cached = editorBuffersRef.current.get(path);
      editorBuffersRef.current.set(path, {
        dirty: false,
        error: "",
        etag: cached?.etag ?? null,
        imageUrl: cached?.imageUrl ?? null,
        missing: true,
        truncated: cached?.truncated ?? false,
        value: cached?.value ?? "",
        agentStreaming: cached?.agentStreaming,
      });
      setMissingFiles((current) =>
        current.has(path) ? current : new Set(current).add(path),
      );
      if (selectedFileRef.current === path) setEditorError("");
      return false;
    }
  };
  reloadEditorFromRemoteRef.current = reloadEditorFromRemote;
  return { reloadEditorFromRemote };
}
