import { useSyncExternalStore } from "react";

export type AgentAccessLevel = "request" | "agent" | "full";

export const AGENT_ACCESS_LEVEL_KEY = "coloride.agent.access-level.v1";

const ALLOWED: readonly AgentAccessLevel[] = ["request", "agent", "full"];

const listeners = new Set<() => void>();

const readStoredAccessLevel = (): AgentAccessLevel => {
  if (typeof window === "undefined") return "agent";
  try {
    const raw = window.localStorage.getItem(AGENT_ACCESS_LEVEL_KEY);
    if (raw === "request" || raw === "agent" || raw === "full") return raw;
  } catch {
    /* ignore */
  }
  return "agent";
};

let currentAccessLevel = readStoredAccessLevel();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => currentAccessLevel;

export function getDefaultAgentAccessLevel(): AgentAccessLevel {
  return currentAccessLevel;
}

export function setDefaultAgentAccessLevel(level: AgentAccessLevel) {
  if (!ALLOWED.includes(level) || level === currentAccessLevel) return;
  currentAccessLevel = level;
  try {
    window.localStorage.setItem(AGENT_ACCESS_LEVEL_KEY, level);
  } catch {
    /* keep the in-memory value for this session */
  }
  listeners.forEach((listener) => listener());
}

export function useDefaultAgentAccessLevel(): AgentAccessLevel {
  return useSyncExternalStore(subscribe, getSnapshot, () => "agent");
}
