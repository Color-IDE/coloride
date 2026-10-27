import type {
  AgentApproval,
  AgentEvent,
  AgentSessionSummary
} from "@coloride/contracts";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { startTransition, useEffect } from "react";
import { api } from "../../shared/api/client";
import {
  eventsFingerprint,
  HISTORY_EVENT_LIMIT,
  HISTORY_PAGE_TURNS,
  historyPageMayHaveOlder,
  mergeAgentEvents,
  reconcileApprovalEvents
} from "./agentEvents";

interface Dependencies {
  selectedSessionId: string | null;
  selectedSession: AgentSessionSummary | null;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  selectedSessionIdRef: RefObject<string | null>;
  historyFetchGenRef: RefObject<number>;
  bufferedEventsRef: RefObject<Map<string, AgentEvent[]>>;
  historyHydratedRef: RefObject<Set<string>>;
  setHistoryHasOlder: Dispatch<SetStateAction<boolean>>;
  historyHasOlderRef: RefObject<Map<string, boolean>>;
  rememberSessionEvents: (sessionId: string, nextEvents: AgentEvent[]) => AgentEvent[];
  setEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  setError: Dispatch<SetStateAction<string>>;
  messageFromError: (error: unknown) => string;
}

export function startSelectedHistoryLoad({
  selectedSessionId,
  selectedSession,
  setHistoryLoading,
  selectedSessionIdRef,
  historyFetchGenRef,
  bufferedEventsRef,
  historyHydratedRef,
  setHistoryHasOlder,
  historyHasOlderRef,
  rememberSessionEvents,
  setEvents,
  setError,
  messageFromError,
}: Dependencies) {
  if (!selectedSessionId || !selectedSession) {
    setHistoryLoading(false);
    return;
  }
  selectedSessionIdRef.current = selectedSessionId;
  const fetchGen = ++historyFetchGenRef.current;
  let cancelled = false;

  // Trust in-memory history + websocket after first load — refetch freezes switches.
  const cached = bufferedEventsRef.current.get(selectedSessionId) ?? [];
  if (historyHydratedRef.current.has(selectedSessionId)) {
    setHistoryLoading(false);
    setHistoryHasOlder(
      historyHasOlderRef.current.get(selectedSessionId) ?? false,
    );
    if (cached.length > 0) return;
  }

  setHistoryLoading(cached.length === 0);
  void Promise.all([
    api.agentEventsPage(selectedSessionId, {
      turns: HISTORY_PAGE_TURNS,
      limit: HISTORY_EVENT_LIMIT,
    }),
    // An approval can be resolved while the renderer is closed. Its original
    // event is immutable history, so reconcile it with the authoritative
    // approval record before rebuilding the timeline.
    api.agentApprovals(selectedSessionId).catch(() => [] as AgentApproval[]),
  ])
    .then(([nextEvents, approvals]) => {
      if (cancelled || fetchGen !== historyFetchGenRef.current) return;
      if (selectedSessionIdRef.current !== selectedSessionId) return;
      const merged = mergeAgentEvents(
        reconcileApprovalEvents(nextEvents, approvals),
        bufferedEventsRef.current.get(selectedSessionId) ?? [],
      );
      rememberSessionEvents(selectedSessionId, merged);
      historyHydratedRef.current.add(selectedSessionId);
      const hasOlder = historyPageMayHaveOlder(nextEvents);
      historyHasOlderRef.current.set(selectedSessionId, hasOlder);
      setHistoryHasOlder(hasOlder);
      // Defer heavy timeline rebuild so the click stays responsive.
      startTransition(() => {
        setEvents((current) =>
          eventsFingerprint(current) === eventsFingerprint(merged)
            ? current
            : merged,
        );
        setHistoryLoading(false);
      });
    })
    .catch((reason) => {
      if (
        !cancelled &&
        fetchGen === historyFetchGenRef.current &&
        selectedSessionIdRef.current === selectedSessionId
      ) {
        setHistoryLoading(false);
        setError(messageFromError(reason));
      }
    });
  return () => {
    cancelled = true;
  };

}

export function useAgentSelectedHistory(dependencies: Dependencies) {
  useEffect(() => startSelectedHistoryLoad(dependencies), [
    dependencies.rememberSessionEvents,
    dependencies.selectedSession,
    dependencies.selectedSessionId,
  ]);
}
