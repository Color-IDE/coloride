import type { ExternalAgentEvent, ExternalAgentSession } from "@coloride/contracts";
import { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api/client";
import { externalAgentsApi } from "./api";
import { emptyExternalAgentState, hydrateExternalAgentEvents, reduceExternalAgentEvent, type ExternalAgentUiState } from "./externalAgentReducer";

const TABS_KEY = "coloride.external-agent.tabs.v1";

export type AgentWorkspaceTab =
  | { id: string; kind: "coloride"; sessionId: string | null }
  | { id: string; kind: "external"; agentId: string; sessionId: string }
  | { id: string; kind: "terminal"; sessionId: string };

export function readAgentWorkspaceTabs(): { tabs: AgentWorkspaceTab[]; selectedId: string | null } {
  try {
    const raw = window.localStorage.getItem(TABS_KEY);
    if (!raw) return { tabs: [{ id: "coloride", kind: "coloride", sessionId: null }], selectedId: "coloride" };
    const parsed = JSON.parse(raw) as { tabs?: AgentWorkspaceTab[]; selectedId?: string | null };
    if (!parsed.tabs?.length) return { tabs: [{ id: "coloride", kind: "coloride", sessionId: null }], selectedId: "coloride" };
    return { tabs: parsed.tabs, selectedId: parsed.selectedId ?? parsed.tabs[0]?.id ?? null };
  } catch {
    return { tabs: [{ id: "coloride", kind: "coloride", sessionId: null }], selectedId: "coloride" };
  }
}

export function writeAgentWorkspaceTabs(tabs: AgentWorkspaceTab[], selectedId: string | null) {
  window.localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, selectedId }));
}

export function useExternalAgentSession(sessionId: string | null, active: boolean) {
  const [session, setSession] = useState<ExternalAgentSession | null>(null);
  const [state, setState] = useState<ExternalAgentUiState>(emptyExternalAgentState);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void externalAgentsApi.session(sessionId).then(async (loaded) => {
      if (cancelled) return;
      setSession(loaded);
      const events = await externalAgentsApi.events(sessionId, 0);
      if (cancelled) return;
      const hydrated = hydrateExternalAgentEvents(events);
      sequence.current = hydrated.lastSequence;
      setState(hydrated);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open Codex.");
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!active || !sessionId) return;
    const socket = api.events((event) => {
      if (event.event !== "external-agent:event") return;
      const payload = event.payload as ExternalAgentEvent;
      if (payload.sessionId !== sessionId) return;
      sequence.current = Math.max(sequence.current, payload.sequence);
      setState((current) => reduceExternalAgentEvent(current, payload));
    });
    const refresh = window.setInterval(() => {
      void externalAgentsApi.events(sessionId, sequence.current).then((events) => {
        setState((current) => events.reduce(reduceExternalAgentEvent, current));
        const last = events.at(-1);
        if (last) sequence.current = last.sequence;
      }).catch(() => undefined);
    }, 1500);
    return () => {
      socket.close();
      window.clearInterval(refresh);
    };
  }, [active, sessionId]);

  return { session, setSession, state, setState, error, setError };
}
