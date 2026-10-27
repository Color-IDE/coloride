import { useEffect, useState } from "react";
import {
  AGENT_PROJECTS_KEY,
  ARCHIVED_TASKS_KEY,
  HIDDEN_TASKS_KEY,
  PINNED_TASKS_KEY,
  readAgentProjects,
  readStoredTaskIds,
  SELECTED_SESSION_KEY,
  selectedSessionStorageKey,
  type AgentProject,
} from "./agentStorage";

export function useAgentHistoryPreferences(
  sessionPane: "agent" | "sidebar",
  selectedSessionId: string | null,
) {
  const [chatTitles, setChatTitles] = useState<Record<string, string>>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("coloride.agent.chat-titles") || "{}",
      );
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "coloride.agent.chat-titles",
        JSON.stringify(chatTitles),
      );
    } catch {
      /* Storage may be unavailable. */
    }
  }, [chatTitles]);

  const [archivedTaskIds, setArchivedTaskIds] = useState<string[]>(() =>
    readStoredTaskIds(ARCHIVED_TASKS_KEY),
  );
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>(() =>
    readStoredTaskIds(HIDDEN_TASKS_KEY),
  );
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>(() =>
    readStoredTaskIds(PINNED_TASKS_KEY),
  );
  const [projects, setProjects] = useState<AgentProject[]>(() =>
    readAgentProjects(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ARCHIVED_TASKS_KEY,
        JSON.stringify(archivedTaskIds),
      );
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [archivedTaskIds]);

  useEffect(() => {
    window.localStorage.setItem(
      HIDDEN_TASKS_KEY,
      JSON.stringify(hiddenTaskIds),
    );
  }, [hiddenTaskIds]);

  useEffect(() => {
    window.localStorage.setItem(
      PINNED_TASKS_KEY,
      JSON.stringify(pinnedTaskIds),
    );
  }, [pinnedTaskIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AGENT_PROJECTS_KEY, JSON.stringify(projects));
    } catch {
      // ignore quota
    }
  }, [projects]);

  useEffect(() => {
    try {
      const key = selectedSessionStorageKey(sessionPane);
      if (selectedSessionId)
        window.localStorage.setItem(key, selectedSessionId);
      else window.localStorage.removeItem(key);
      if (sessionPane === "agent") {
        if (selectedSessionId)
          window.localStorage.setItem(SELECTED_SESSION_KEY, selectedSessionId);
        else window.localStorage.removeItem(SELECTED_SESSION_KEY);
      }
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [selectedSessionId, sessionPane]);

  return {
    chatTitles,
    setChatTitles,
    archivedTaskIds,
    setArchivedTaskIds,
    hiddenTaskIds,
    setHiddenTaskIds,
    pinnedTaskIds,
    setPinnedTaskIds,
    projects,
    setProjects,
  };
}
