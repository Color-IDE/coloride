import { firstTerminalPaneId, terminalPaneIds } from "../terminalLayout";
import type { PersistedTerminalWorkspace } from "../terminalTypes";
import { DEFAULT_SHELL, initialTabs, makeProblemsTab } from "./layout";
import { type PaneId, type TerminalTab } from "./types";

export function restoreTabs(
  persisted: PersistedTerminalWorkspace | null,
  enableProblems: boolean,
  drawerView: "terminal" | "problems",
): TerminalTab[] {
  if (!persisted?.sessions.length)
    return initialTabs(enableProblems, drawerView);
  const restored = persisted.sessions.map((session, index) => ({
    cwd: session.cwd,
    id: index + 1,
    kind: "terminal" as const,
    paneId: session.paneId,
    sessionId: session.sessionId,
  }));
  if (!enableProblems || drawerView !== "problems") return restored;
  return [makeProblemsTab(firstTerminalPaneId(persisted.layout)), ...restored];
}

export function restoreActiveIds(
  persisted: PersistedTerminalWorkspace,
): Record<PaneId, number | null> {
  const tabs = restoreTabs(persisted, false, "terminal");
  return Object.fromEntries(
    terminalPaneIds(persisted.layout).map((paneId) => {
      const group = persisted.groups.find(
        (candidate) => candidate.paneId === paneId,
      );
      const active = tabs.find(
        (tab) => tab.sessionId === group?.activeSessionId,
      );
      return [
        paneId,
        active?.id ?? tabs.find((tab) => tab.paneId === paneId)?.id ?? null,
      ];
    }),
  );
}

export function restoreTitles(
  persisted: PersistedTerminalWorkspace | null,
): Record<number, string> {
  if (!persisted) return {};
  const entries: [number, string][] = [];
  persisted.sessions.forEach((session, index) => {
    // Only restore actual explicit user titles, not fallbacks like "zsh"
    if (session.title && session.title !== DEFAULT_SHELL) {
      entries.push([index + 1, session.title]);
    }
  });
  return Object.fromEntries(entries);
}
