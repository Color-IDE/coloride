import type {
  ExternalAgentEvent,
  ExternalAgentSession,
} from "@coloride/contracts";
import { useEffect, useState } from "react";
import { api } from "../../shared/api/client";
import { externalAgentsApi } from "./api";
import {
  emptyExternalAgentState,
  reduceExternalAgentEvent,
  type ExternalAgentUiState,
} from "./externalAgentReducer";

const TABS_KEY = "coloride.external-agent.tabs.v1";

export type AgentWorkspaceTab =
  | { id: string; kind: "coloride"; sessionId: string | null }
  | { id: string; kind: "external"; agentId: string; sessionId: string }
  | { id: string; kind: "terminal"; sessionId: string };

export function readAgentWorkspaceTabs(namespace = ""): {
  tabs: AgentWorkspaceTab[];
  selectedId: string | null;
} {
  try {
    const raw = window.localStorage.getItem(`${TABS_KEY}:${namespace}`);
    if (!raw)
      return {
        tabs: [{ id: "coloride", kind: "coloride", sessionId: null }],
        selectedId: "coloride",
      };
    const parsed = JSON.parse(raw) as {
      tabs?: AgentWorkspaceTab[];
      selectedId?: string | null;
    };
    if (
      !Array.isArray(parsed.tabs) ||
      !parsed.tabs.every(
        (tab) =>
          tab &&
          typeof tab.id === "string" &&
          (tab.kind === "coloride" ||
            (tab.kind === "external" &&
              typeof tab.agentId === "string" &&
              typeof tab.sessionId === "string")),
      )
    )
      throw new Error("Invalid saved agent tabs");
    if (!parsed.tabs?.length)
      return {
        tabs: [{ id: "coloride", kind: "coloride", sessionId: null }],
        selectedId: "coloride",
      };
    return {
      tabs: parsed.tabs,
      selectedId: parsed.selectedId ?? parsed.tabs[0]?.id ?? null,
    };
  } catch {
    return {
      tabs: [{ id: "coloride", kind: "coloride", sessionId: null }],
      selectedId: "coloride",
    };
  }
}

export function writeAgentWorkspaceTabs(
  tabs: AgentWorkspaceTab[],
  selectedId: string | null,
  namespace = "",
) {
  try {
    window.localStorage.setItem(
      `${TABS_KEY}:${namespace}`,
      JSON.stringify({ tabs, selectedId }),
    );
  } catch {
    /* A full browser store must not crash an open conversation. */
  }
}

export function useExternalAgentSession(
  sessionId: string | null,
  active: boolean,
) {
  const [session, setSession] = useState<ExternalAgentSession | null>(null);
  const [state, setState] = useState<ExternalAgentUiState>(
    emptyExternalAgentState,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let sequence = 0;
    let fetching = false;
    let again = false;
    let opened = false;
    let identity: ExternalAgentSession | null = null;
    setSession(null);
    setState(emptyExternalAgentState());
    setError("");

    const synchronize = async () => {
      if (disposed) return;
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      try {
        do {
          again = false;
          let loaded: ExternalAgentSession =
            identity ?? (await externalAgentsApi.session(sessionId));
          if (disposed) return;
          if (active && !opened) {
            opened = true;
            loaded = await externalAgentsApi.openSession({
              sessionId,
              agentId: loaded.agentId,
              workspacePath: loaded.workspacePath,
              executionTarget: "local",
            });
            if (disposed) return;
          }
          // The durable log is authoritative: socket notifications only wake this
          // ordered catch-up, so a missed packet cannot skip earlier text chunks.
          const events = await externalAgentsApi.events(sessionId, sequence);
          if (disposed) return;
          loaded = await externalAgentsApi.session(sessionId);
          if (disposed) return;
          identity = loaded;
          const last = events.at(-1);
          if (last) sequence = last.sequence;
          setSession(loaded);
          setState((current) => ({
            ...events.reduce(reduceExternalAgentEvent, current),
            config: loaded.configOptions,
            turnActive: loaded.turn !== "idle",
          }));
          setError("");
        } while (again && !disposed);
      } catch (reason) {
        if (!disposed)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not open the external agent.",
          );
      } finally {
        fetching = false;
      }
    };
    void synchronize();
    const socket = active
      ? api.events((event) => {
          if (
            event.event === "external-agent:event" &&
            (event.payload as ExternalAgentEvent).sessionId === sessionId
          )
            void synchronize();
        })
      : null;
    const timer = active
      ? window.setInterval(() => void synchronize(), 1500)
      : null;
    return () => {
      disposed = true;
      socket?.close();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [active, sessionId]);

  return { session, setSession, state, setState, error, setError };
}
