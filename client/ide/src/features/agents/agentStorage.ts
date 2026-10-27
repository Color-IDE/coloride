import type { ComposerReasoning } from "./composer/modelReasoning";

export const ARCHIVED_TASKS_KEY = "coloride.agent.archived-tasks";
export const HIDDEN_TASKS_KEY = "coloride.agent.hidden-tasks";
export const PINNED_TASKS_KEY = "coloride.agent.pinned-tasks";

export const AGENT_PROJECTS_KEY = "coloride.agent.projects.v1";

export type AgentProject = {
  id: string;
  name: string;
  open: boolean;
  sessionIds: string[];
};

export function readAgentProjects(): AgentProject[] {
  try {
    const raw = window.localStorage.getItem(AGENT_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : "";
        const name = typeof o.name === "string" ? o.name.trim() : "";
        if (!id || !name) return null;
        const sessionIds = Array.isArray(o.sessionIds)
          ? o.sessionIds.filter(
              (s): s is string => typeof s === "string" && s.length > 0,
            )
          : [];
        return {
          id,
          name,
          open: o.open !== false,
          sessionIds,
        } satisfies AgentProject;
      })
      .filter((x): x is AgentProject => Boolean(x));
  } catch {
    return [];
  }
}

export const SELECTED_SESSION_KEY = "coloride.agent.selected-session";
export const COMPOSER_REASONING_KEY = "coloride.agent.composer-reasoning";
/** User chose New task — keep empty selection across tab switches / AgentView remounts. */
export const NEW_TASK_FLAG_KEY = "coloride.agent.prefer-new-task";
/** Kept checkpoint ids per session so "Keep all" survives chat switches. */
export const KEPT_CHECKPOINTS_KEY = "coloride.agent.kept-checkpoints";

export const readStoredTaskIds = (key: string): string[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

export const selectedSessionStorageKey = (pane: "agent" | "sidebar") =>
  `${SELECTED_SESSION_KEY}.${pane}`;
export const preferNewTaskStorageKey = (pane: "agent" | "sidebar") =>
  `${NEW_TASK_FLAG_KEY}.${pane}`;
export const newTaskNoRepoStorageKey = (pane: "agent" | "sidebar") =>
  `coloride.agent.new-task-no-repo.${pane}`;
export const composerReasoningStorageKey = (pane: "agent" | "sidebar") =>
  `${COMPOSER_REASONING_KEY}.${pane}`;

export const readNewTaskNoRepo = (pane: "agent" | "sidebar"): boolean => {
  try {
    return window.sessionStorage.getItem(newTaskNoRepoStorageKey(pane)) === "1";
  } catch {
    return false;
  }
};

export const writeNewTaskNoRepo = (
  pane: "agent" | "sidebar",
  value: boolean,
) => {
  try {
    if (value)
      window.sessionStorage.setItem(newTaskNoRepoStorageKey(pane), "1");
    else window.sessionStorage.removeItem(newTaskNoRepoStorageKey(pane));
  } catch {
    // ignore
  }
};

export const readStoredComposerReasoning = (
  pane: "agent" | "sidebar",
): ComposerReasoning => {
  try {
    const value = window.localStorage.getItem(
      composerReasoningStorageKey(pane),
    );
    if (
      value === "none" ||
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh" ||
      value === "max"
    ) {
      return value;
    }
  } catch {
    // ignore
  }
  return "medium";
};

export const writeStoredComposerReasoning = (
  pane: "agent" | "sidebar",
  value: ComposerReasoning,
) => {
  try {
    window.localStorage.setItem(composerReasoningStorageKey(pane), value);
  } catch {
    // ignore
  }
};

export const readPreferNewTask = (pane: "agent" | "sidebar"): boolean => {
  try {
    if (window.sessionStorage.getItem(preferNewTaskStorageKey(pane)) === "1")
      return true;
    // Older builds used one flag for both panes.
    return (
      pane === "agent" &&
      window.sessionStorage.getItem(NEW_TASK_FLAG_KEY) === "1"
    );
  } catch {
    return false;
  }
};

export const writePreferNewTask = (
  pane: "agent" | "sidebar",
  prefer: boolean,
) => {
  try {
    if (prefer)
      window.sessionStorage.setItem(preferNewTaskStorageKey(pane), "1");
    else window.sessionStorage.removeItem(preferNewTaskStorageKey(pane));
    if (pane === "agent") {
      if (prefer) window.sessionStorage.setItem(NEW_TASK_FLAG_KEY, "1");
      else window.sessionStorage.removeItem(NEW_TASK_FLAG_KEY);
    }
  } catch {
    // ignore
  }
};

export const readStoredSessionId = (
  pane: "agent" | "sidebar",
): string | null => {
  try {
    // Explicit New task — do not fall back to the latest chat on remount.
    if (readPreferNewTask(pane)) return null;
    const value =
      window.localStorage.getItem(selectedSessionStorageKey(pane)) ??
      (pane === "agent"
        ? window.localStorage.getItem(SELECTED_SESSION_KEY)
        : null);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
};

/** sessionId → checkpoint ids the user chose to keep (hide the dock). */
export const readKeptCheckpointsBySession = (): Record<string, string[]> => {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(KEPT_CHECKPOINTS_KEY) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const next: Record<string, string[]> = {};
    for (const [sessionId, ids] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (!sessionId || !Array.isArray(ids)) continue;
      const cleaned = ids.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (cleaned.length) next[sessionId] = cleaned;
    }
    return next;
  } catch {
    return {};
  }
};

export const writeKeptCheckpointsBySession = (
  map: Record<string, string[]>,
) => {
  try {
    window.localStorage.setItem(KEPT_CHECKPOINTS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage failures (private mode / quota).
  }
};

export const keptIdsForSession = (
  map: Record<string, string[]>,
  sessionId: string | null | undefined,
): string[] => {
  if (!sessionId) return [];
  return map[sessionId] ?? [];
};

export const mergeKeptCheckpointIds = (
  map: Record<string, string[]>,
  sessionId: string,
  ids: string[],
): Record<string, string[]> => {
  if (!ids.length) return map;
  const existing = map[sessionId] ?? [];
  const set = new Set(existing);
  let changed = false;
  for (const id of ids) {
    if (set.has(id)) continue;
    set.add(id);
    changed = true;
  }
  if (!changed) return map;
  return { ...map, [sessionId]: [...set] };
};

export const pruneKeptCheckpointIds = (
  map: Record<string, string[]>,
  sessionId: string,
  validIds: Set<string>,
): Record<string, string[]> => {
  const current = map[sessionId] ?? [];
  if (!current.length) return map;
  const next = current.filter((id) => validIds.has(id));
  if (next.length === current.length) return map;
  if (!next.length) {
    const { [sessionId]: _, ...rest } = map;
    return rest;
  }
  return { ...map, [sessionId]: next };
};

export const toggleStoredId = (current: string[], sessionId: string) =>
  current.includes(sessionId)
    ? current.filter((id) => id !== sessionId)
    : [sessionId, ...current.filter((id) => id !== sessionId)];
