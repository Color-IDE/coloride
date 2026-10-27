import type { Dispatch, RefObject, SetStateAction } from "react";
import { api, encodeTextToBase64 } from "../../../shared/api/client";
import {
  clearAgentEditReview,
  getAgentEditReview,
  notifyIdeAcceptedPaths,
  notifyIdeRejectedPaths,
} from "../../editor/agentEditBridge";
import { isBrowserTabKey } from "../../explorer/BrowserPane";
import { messageFromError } from "./connectionValidation";
import { type ConnectionState, type EditorBuffer } from "./types";

interface Dependencies {
  clearAgentEditBaseline: (path?: string) => void;
  selectedFileRef: RefObject<string | null>;
  setEditorDirty: Dispatch<SetStateAction<boolean>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
  setAgentEditReviewTick: Dispatch<SetStateAction<number>>;
  connectionStateRef: RefObject<ConnectionState>;
  setEditorError: Dispatch<SetStateAction<string>>;
  suppressEditorWatchUntilRef: RefObject<number>;
  editorEtagRef: RefObject<string | null>;
  setEditorValue: Dispatch<SetStateAction<string>>;
  setEditorEtag: Dispatch<SetStateAction<string | null>>;
  setEditorImageUrl: Dispatch<SetStateAction<string | null>>;
  setEditorTruncated: Dispatch<SetStateAction<boolean>>;
  agentEditReviewTick: number;
}
export function useWorkspaceAgentReview({
  clearAgentEditBaseline,
  selectedFileRef,
  setEditorDirty,
  setDirtyFiles,
  editorBuffersRef,
  setAgentEditReviewTick,
  connectionStateRef,
  setEditorError,
  suppressEditorWatchUntilRef,
  editorEtagRef,
  setEditorValue,
  setEditorEtag,
  setEditorImageUrl,
  setEditorTruncated,
  agentEditReviewTick,
}: Dependencies) {
  const acceptAgentEdit = (path: string) => {
    const review = getAgentEditReview(path);
    if (!review) {
      // Still clean dirty flags when review already cleared by hunk UI.
    } else {
      clearAgentEditReview(path);
    }
    clearAgentEditBaseline(path);
    // Content already on disk from the agent write — just drop decorations.
    if (selectedFileRef.current === path) {
      setEditorDirty(false);
      setDirtyFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      const buf = editorBuffersRef.current.get(path);
      if (buf) {
        editorBuffersRef.current.set(path, {
          ...buf,
          dirty: false,
          agentStreaming: false,
        });
      }
    }
    // Sync chat sidebar Keep-all dock (same session as Agents tab — one AgentView).
    notifyIdeAcceptedPaths([path]);
    setAgentEditReviewTick((n) => n + 1);
    return true;
  };

  /** Write editor buffer after a per-hunk Reject (partial undo of agent edit). */
  const commitAgentEditContent = async (
    path: string,
    content: string,
  ): Promise<boolean> => {
    if (!path || isBrowserTabKey(path)) return false;
    if (connectionStateRef.current !== "connected") {
      setEditorError("Connect to a server first.");
      return false;
    }
    try {
      suppressEditorWatchUntilRef.current = Date.now() + 8_000;
      const prevEtag =
        (selectedFileRef.current === path ? editorEtagRef.current : null) ??
        editorBuffersRef.current.get(path)?.etag ??
        null;
      const write = await api.writeFile(
        path,
        encodeTextToBase64(content),
        prevEtag,
      );
      const buffer = {
        dirty: false,
        error: "",
        etag: write.etag,
        imageUrl: null as string | null,
        truncated: false,
        value: content,
        agentStreaming: false,
      };
      editorBuffersRef.current.set(path, buffer);
      setDirtyFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      if (selectedFileRef.current === path) {
        setEditorValue(content);
        editorEtagRef.current = write.etag;
        setEditorEtag(write.etag);
        setEditorDirty(false);
        setEditorError("");
        setEditorImageUrl(null);
        setEditorTruncated(false);
      }
      return true;
    } catch (error) {
      setEditorError(messageFromError(error));
      return false;
    }
  };

  const rejectAgentEdit = async (path: string): Promise<boolean> => {
    const review = getAgentEditReview(path);
    if (!review) return false;
    if (connectionStateRef.current !== "connected") {
      setEditorError("Connect to a server first.");
      return false;
    }
    try {
      suppressEditorWatchUntilRef.current = Date.now() + 8_000;
      const previousEtag =
        (selectedFileRef.current === path ? editorEtagRef.current : null) ??
        editorBuffersRef.current.get(path)?.etag ??
        null;
      if (!previousEtag) {
        setEditorError("Reload the file before undoing agent changes.");
        return false;
      }
      const write = await api.writeFile(
        path,
        encodeTextToBase64(review.before),
        previousEtag,
      );
      clearAgentEditReview(path);
      clearAgentEditBaseline(path);
      const buffer = {
        dirty: false,
        error: "",
        etag: write.etag,
        imageUrl: null as string | null,
        truncated: false,
        value: review.before,
        agentStreaming: false,
      };
      editorBuffersRef.current.set(path, buffer);
      setDirtyFiles((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      if (selectedFileRef.current === path) {
        setEditorValue(review.before);
        editorEtagRef.current = write.etag;
        setEditorEtag(write.etag);
        setEditorDirty(false);
        setEditorError("");
        setEditorImageUrl(null);
        setEditorTruncated(false);
      }
      // File restored in the IDE — settle matching checkpoint entries in the agent dock.
      notifyIdeRejectedPaths([path]);
      setAgentEditReviewTick((n) => n + 1);
      return true;
    } catch (error) {
      setEditorError(messageFromError(error));
      return false;
    }
  };

  const getPendingAgentEditReview = (path: string | null | undefined) => {
    void agentEditReviewTick; // re-render dependency
    return getAgentEditReview(path);
  };

  return {
    acceptAgentEdit,
    commitAgentEditContent,
    rejectAgentEdit,
    getPendingAgentEditReview,
  };
}
