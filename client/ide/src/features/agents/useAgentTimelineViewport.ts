import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useState
} from "react";
import {
  groupTimelineTurns
} from "./AgentTimeline";
import {
  TIMELINE_RENDER_TURNS
} from "./agentEvents";

interface Dependencies {
  timelineRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: RefObject<boolean>;
  timelineTurns: ReturnType<typeof groupTimelineTurns>;
  loadOlderHistory: () => Promise<void>;
  viewActive: boolean;
  selectedSessionId: string | null;
}

export function useAgentTimelineViewport({ timelineRef, stickToBottomRef, timelineTurns, loadOlderHistory, viewActive, selectedSessionId }: Dependencies) {
  const [timelineRenderLimit, setTimelineRenderLimit] = useState(
    TIMELINE_RENDER_TURNS,
  );

  const [activeTimelineTurn, setActiveTimelineTurn] = useState(0);

  const [timelineFadeEdges, setTimelineFadeEdges] = useState({
    top: false,
    bottom: false,
  });
  const timelineHasTextSelection = useCallback(() => {
    const element = timelineRef.current;
    if (!element || typeof window === "undefined") return false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return false;
    if (!selection.toString()) return false;
    const anchor = selection.anchorNode;
    return Boolean(anchor && element.contains(anchor));
  }, []);

  const updateTimelineFadeEdges = useCallback(() => {
    const element = timelineRef.current;
    if (!element) return;
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const next = {
      top: element.scrollTop > 2,
      bottom: maxScroll - element.scrollTop > 2,
    };
    setTimelineFadeEdges((current) =>
      current.top === next.top && current.bottom === next.bottom
        ? current
        : next,
    );
  }, []);

  const handleTimelineScroll = useCallback(() => {
    const element = timelineRef.current;
    if (!element) return;
    const distanceFromBottom =
      element.scrollHeight - element.clientHeight - element.scrollTop;
    stickToBottomRef.current = distanceFromBottom <= 80;
    const viewportTop = element.getBoundingClientRect().top + 24;
    const rows = element.querySelectorAll<HTMLElement>(
      "[data-agent-turn-index]",
    );
    for (const row of rows) {
      if (row.getBoundingClientRect().bottom < viewportTop) continue;
      const index = Number(row.dataset.agentTurnIndex);
      if (Number.isFinite(index)) {
        setActiveTimelineTurn((current) =>
          current === index ? current : index,
        );
      }
      break;
    }
    updateTimelineFadeEdges();
  }, [updateTimelineFadeEdges]);

  /** User clicked the floating jump-down control above the composer. */
  const scrollTimelineToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    timelineRef.current?.scrollTo({
      top: timelineRef.current.scrollHeight,
      behavior: "smooth",
    });
    window.setTimeout(updateTimelineFadeEdges, 320);
  }, [updateTimelineFadeEdges]);

  const jumpToTimelineTurn = useCallback(
    (index: number) => {
      const required = timelineTurns.length - index;
      if (required > timelineRenderLimit) setTimelineRenderLimit(required);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const timeline = timelineRef.current;
          const row = timeline?.querySelector<HTMLElement>(
            `[data-agent-turn-index="${index}"]`,
          );
          if (!timeline || !row) return;
          if (index >= timelineTurns.length - 1) {
            timeline.scrollTo({
              top: timeline.scrollHeight,
              behavior: "smooth",
            });
            return;
          }
          const delta =
            row.getBoundingClientRect().top -
            timeline.getBoundingClientRect().top;
          timeline.scrollTo({
            top: Math.max(0, timeline.scrollTop + delta),
            behavior: "smooth",
          });
        });
      });
    },
    [timelineRenderLimit, timelineTurns.length],
  );

  const showEarlierTimeline = useCallback(() => {
    if (timelineRenderLimit < timelineTurns.length) {
      setTimelineRenderLimit((current) =>
        Math.min(timelineTurns.length, current + TIMELINE_RENDER_TURNS),
      );
      return;
    }
    void loadOlderHistory();
  }, [loadOlderHistory, timelineRenderLimit, timelineTurns.length]);

  // Native, capped history avoids react-virtuoso's React 19 layout-store loop.
  // Follow live output only while the user remains at the bottom.
  useEffect(() => {
    if (!viewActive || !stickToBottomRef.current || timelineHasTextSelection())
      return;
    const frame = requestAnimationFrame(() => {
      const element = timelineRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
      updateTimelineFadeEdges();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    selectedSessionId,
    timelineHasTextSelection,
    timelineTurns,
    updateTimelineFadeEdges,
    viewActive,
  ]);

  return {
    timelineRenderLimit,
    activeTimelineTurn,
    timelineFadeEdges,
    setTimelineRenderLimit,
    setActiveTimelineTurn,
    setTimelineFadeEdges,
    handleTimelineScroll,
    scrollTimelineToBottom,
    jumpToTimelineTurn,
    showEarlierTimeline,
  };
}
