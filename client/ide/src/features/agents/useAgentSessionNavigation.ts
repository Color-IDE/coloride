import type { AgentEvent } from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { startTransition, useCallback } from "react";
import {
  HISTORY_CACHE_SESSIONS,
  HISTORY_EVENT_LIMIT,
  TIMELINE_RENDER_TURNS,
} from "./agentEvents";
import { writePreferNewTask } from "./agentStorage";

interface Dependencies {
  bufferedEventsRef: RefObject<Map<string, AgentEvent[]>>;
  setComplementsOpen: Dispatch<SetStateAction<boolean>>;
  setActiveHeaderTerminal: Dispatch<SetStateAction<string | null>>;
  selectedSessionIdRef: RefObject<string | null>;
  stickToBottomRef: RefObject<boolean>;
  setTimelineRenderLimit: Dispatch<SetStateAction<number>>;
  setActiveTimelineTurn: Dispatch<SetStateAction<number>>;
  setHistoryLoadingOlder: Dispatch<SetStateAction<boolean>>;
  setHistoryHasOlder: Dispatch<SetStateAction<boolean>>;
  historyHasOlderRef: RefObject<Map<string, boolean>>;
  historyFetchGenRef: RefObject<number>;
  setCheckpointReviewOpen: Dispatch<SetStateAction<boolean>>;
  setQueuedFollowUps: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string>>;
  sessionPane: "sidebar" | "agent";
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  historyHydratedRef: RefObject<Set<string>>;
}
export function useAgentSessionNavigation({
  bufferedEventsRef,
  setComplementsOpen,
  setActiveHeaderTerminal,
  selectedSessionIdRef,
  stickToBottomRef,
  setTimelineRenderLimit,
  setActiveTimelineTurn,
  setHistoryLoadingOlder,
  setHistoryHasOlder,
  historyHasOlderRef,
  historyFetchGenRef,
  setCheckpointReviewOpen,
  setQueuedFollowUps,
  setError,
  sessionPane,
  setHistoryLoading,
  setEvents,
  setSelectedSessionId,
  historyHydratedRef,
}: Dependencies) {
  const rememberSessionEvents = useCallback(
    (sessionId: string, nextEvents: AgentEvent[]) => {
      const clipped = nextEvents.slice(-HISTORY_EVENT_LIMIT);
      bufferedEventsRef.current.delete(sessionId);
      bufferedEventsRef.current.set(sessionId, clipped);
      while (bufferedEventsRef.current.size > HISTORY_CACHE_SESSIONS) {
        bufferedEventsRef.current.delete(
          bufferedEventsRef.current.keys().next().value as string,
        );
      }
      return clipped;
    },
    [],
  );

  /** Switch chats without a frame of the previous timeline (avoids hard visual jump). */
  const selectSession = useCallback(
    (sessionId: string | null, options?: { preferNewTask?: boolean }) => {
      setComplementsOpen(false);
      setActiveHeaderTerminal(null);
      if (selectedSessionIdRef.current === sessionId) return;
      selectedSessionIdRef.current = sessionId;
      stickToBottomRef.current = true;
      setTimelineRenderLimit(TIMELINE_RENDER_TURNS);
      setActiveTimelineTurn(0);
      setHistoryLoadingOlder(false);
      setHistoryHasOlder(
        sessionId
          ? (historyHasOlderRef.current.get(sessionId) ?? false)
          : false,
      );
      // Bump fetch gen so an in-flight history request for the old chat is ignored.
      historyFetchGenRef.current += 1;
      setCheckpointReviewOpen(false);
      setQueuedFollowUps([]);
      setError("");
      if (!sessionId) {
        if (options?.preferNewTask !== false)
          writePreferNewTask(sessionPane, true);
        setHistoryLoading(false);
        setHistoryHasOlder(false);
        setEvents([]);
        setSelectedSessionId(null);
        return;
      }
      writePreferNewTask(sessionPane, false);
      const cached = bufferedEventsRef.current.get(sessionId) ?? [];
      const hydrated = historyHydratedRef.current.has(sessionId);
      // Selection + chrome update immediately; heavy event swap stays off the click path when possible.
      setHistoryLoading(!hydrated && cached.length === 0);
      setSelectedSessionId(sessionId);
      if (hydrated || cached.length === 0) {
        setEvents(cached);
      } else {
        startTransition(() => setEvents(cached));
      }
    },
    [sessionPane],
  );

  return { rememberSessionEvents, selectSession };
}
