import type { AgentEvent, AgentSessionSummary } from "@coloride/contracts";
import { useRef, useState } from "react";
import { readStoredSessionId } from "./agentStorage";

/** Session state and its async-generation refs have one owner for both agent presentations. */
export function useAgentSessionState({
  sessionPane,
}: {
  sessionPane: "agent" | "sidebar";
}) {
  const configSeqRef = useRef(0);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => readStoredSessionId(sessionPane),
  );
  const [openChatTabs, setOpenChatTabs] = useState<(string | null)[]>(() => [
    readStoredSessionId(sessionPane),
  ]);
  const [complementsOpen, setComplementsOpen] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const timelineRef = useRef<HTMLDivElement>(null);
  const selectedSessionIdRef = useRef<string | null>(
    readStoredSessionId(sessionPane),
  );
  const watchdogFiredRef = useRef<string | null>(null);
  const sessionsRef = useRef<AgentSessionSummary[]>([]);
  sessionsRef.current = sessions;
  const eventsRef = useRef<AgentEvent[]>([]);
  eventsRef.current = events;
  const bufferedEventsRef = useRef<Map<string, AgentEvent[]>>(new Map());
  const historyHydratedRef = useRef<Set<string>>(new Set());
  const historyHasOlderRef = useRef<Map<string, boolean>>(new Map());
  const historyOlderRequestRef = useRef(false);
  const historyFetchGenRef = useRef(0);
  const stickToBottomRef = useRef(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [historyHasOlder, setHistoryHasOlder] = useState(false);
  return {
    openChatTabs,
    sessions,
    setOpenChatTabs,
    selectedSessionId,
    setSessions,
    events,
    bufferedEventsRef,
    setComplementsOpen,
    selectedSessionIdRef,
    stickToBottomRef,
    setHistoryLoadingOlder,
    setHistoryHasOlder,
    historyHasOlderRef,
    historyFetchGenRef,
    setHistoryLoading,
    setEvents,
    setSelectedSessionId,
    historyHydratedRef,
    configSeqRef,
    sessionsRef,
    historyOlderRequestRef,
    historyHasOlder,
    eventsRef,
    timelineRef,
    watchdogFiredRef,
    historyLoading,
    complementsOpen,
    historyLoadingOlder,
  };
}
