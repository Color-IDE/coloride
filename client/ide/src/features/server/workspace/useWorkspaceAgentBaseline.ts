import type { RefObject } from "react";
import { useRef, useState } from "react";
import {
  getAgentEditReview
} from "../../editor/agentEditBridge";
import {
  type EditorBuffer
} from "./types";

interface Dependencies {
  editorBuffersRef: RefObject<Map<string, EditorBuffer>>;
}

export function useWorkspaceAgentBaseline({ editorBuffersRef }: Dependencies) {
  /** Original buffer text when agent first touched a path (for green/red diff). */
  const agentEditBaseRef = useRef(new Map<string, string>());
  /**
   * Capture pre-agent baseline once per pending-review session.
   * If a Keep/Undo review is already open for this path, reuse its `before`
   * so a second agent edit accumulates instead of replacing/accepting the first.
   */
  const captureAgentEditBaseline = (
    path: string,
    opts?: {
      isActive?: boolean;
      cachedValue?: string | null;
      agentStreaming?: boolean;
    },
  ) => {
    const pending = getAgentEditReview(path);
    if (pending) {
      agentEditBaseRef.current.set(path, pending.before);
      return pending.before;
    }
    // Mid-stream (same tool write): keep the baseline captured at stream start.
    const midStream =
      opts?.agentStreaming ||
      Boolean(editorBuffersRef.current.get(path)?.agentStreaming);
    if (midStream && agentEditBaseRef.current.has(path)) {
      return agentEditBaseRef.current.get(path) ?? "";
    }
    // Fresh edit after Keep/Undo (or first touch): only use a buffer belonging
    // to this path. During a rapid agent tab switch the rendered editor can
    // still contain the *previous* tab for one React frame; using its generic
    // editorValue here makes the new file look as if that previous file was
    // deleted. Editor changes are mirrored into editorBuffersRef synchronously.
    const base =
      opts?.cachedValue ?? editorBuffersRef.current.get(path)?.value ?? "";
    agentEditBaseRef.current.set(path, base);
    return base;
  };
  const clearAgentEditBaseline = (path?: string) => {
    if (!path) {
      agentEditBaseRef.current.clear();
      return;
    }
    agentEditBaseRef.current.delete(path);
  };

  const [agentStreamingPaths, setAgentStreamingPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const [agentEditReviewTick, setAgentEditReviewTick] = useState(0);
  return {
    agentStreamingPaths,
    agentEditReviewTick,
    setAgentStreamingPaths,
    setAgentEditReviewTick,
    agentEditBaseRef,
    captureAgentEditBaseline,
    clearAgentEditBaseline,
  };
}
