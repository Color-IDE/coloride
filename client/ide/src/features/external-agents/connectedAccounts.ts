import type { ExternalAgentSession } from "@coloride/contracts";
import { useSyncExternalStore } from "react";

type ConnectedAccount = { agentId: string; name: string };
const sessions = new Map<string, ConnectedAccount>();
const listeners = new Set<() => void>();
let snapshot: ConnectedAccount[] = [];
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => snapshot;

export function updateConnectedAccount(session: ExternalAgentSession | null, sessionId: string) {
  const before = sessions.get(sessionId);
  const next = session?.phase === "ready" ? {agentId:session.agentId, name:session.agentId === "codex-acp" ? "Codex" : session.agentId} : null;
  if (before?.agentId === next?.agentId && before?.name === next?.name) return;
  if (next) sessions.set(sessionId, next);
  else sessions.delete(sessionId);
  snapshot = [...new Map([...sessions.values()].map(account => [account.agentId, account])).values()];
  for (const listener of listeners) listener();
}

export function useConnectedAccounts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
