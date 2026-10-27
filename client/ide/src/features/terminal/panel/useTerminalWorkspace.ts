import type { AgentTerminalReference } from "@coloride/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { firstTerminalPaneId, terminalPaneIds } from "../terminalLayout";
import {
  readTerminalWorkspace,
  terminalWorkspaceStorageKey,
  writeTerminalWorkspace,
} from "../terminalPersistence";
import type { TerminalSessionStatus } from "../terminalTypes";
import {
  isProblemsTab,
  nextNumericId,
  paneIds,
  PROBLEMS_TAB_ID,
  splitIds,
} from "./layout";
import { restoreActiveIds, restoreTabs, restoreTitles } from "./persistence";
import { type LayoutNode, type PaneId, type TerminalTab } from "./types";

interface Dependencies {
  initialTerminal: AgentTerminalReference | undefined;
  workspaceKind: "local" | "ssh";
  connectionId: string | null | undefined;
  workspacePath: string | null | undefined;
  enableProblems: boolean;
  drawerView: "terminal" | "problems";
  surfaceActive: boolean;
  placement: "drawer" | "center";
}
export function useTerminalWorkspace({
  initialTerminal,
  workspaceKind,
  connectionId,
  workspacePath,
  enableProblems,
  drawerView,
  surfaceActive,
  placement,
}: Dependencies) {
  const storageKey = useMemo(
    () =>
      initialTerminal
        ? `coloride.agent-terminal:${initialTerminal.sessionId}`
        : terminalWorkspaceStorageKey({
            workspaceKind,
            connectionId,
            workspacePath,
          }),
    [connectionId, workspaceKind, workspacePath, initialTerminal],
  );
  const initialPersisted = useMemo(
    () => readTerminalWorkspace(storageKey),
    [storageKey],
  );
  const [tabs, setTabs] = useState<TerminalTab[]>(() =>
    initialTerminal
      ? [
          {
            id: 1,
            paneId: "pane-1",
            kind: "terminal",
            sessionId: initialTerminal.sessionId,
            cwd: initialTerminal.cwd,
          },
        ]
      : restoreTabs(initialPersisted, enableProblems, drawerView),
  );
  const [layout, setLayout] = useState<LayoutNode>(
    () => initialPersisted?.layout ?? { id: "pane-1", type: "pane" },
  );
  const [activeIds, setActiveIds] = useState<Record<PaneId, number | null>>(
    () =>
      initialPersisted
        ? restoreActiveIds(initialPersisted)
        : {
            "pane-1":
              enableProblems && drawerView === "problems" ? PROBLEMS_TAB_ID : 1,
          },
  );
  const [activePaneId, setActivePaneId] = useState<PaneId>(
    () => initialPersisted?.activePaneId ?? "pane-1",
  );
  const [nextId, setNextId] = useState(() =>
    Math.max(
      2,
      tabs.reduce((max, tab) => Math.max(max, tab.id + 1), 2),
    ),
  );
  const [nextPaneId, setNextPaneId] = useState(() =>
    nextNumericId(terminalPaneIds(layout), 2),
  );
  const [nextSplitId, setNextSplitId] = useState(1);

  const [foreground, setForeground] = useState<Record<number, string>>({});
  const [userTitles, setUserTitles] = useState<Record<number, string>>(() =>
    initialTerminal?.title
      ? { 1: initialTerminal.title }
      : restoreTitles(initialPersisted),
  );
  const [terminalIds, setTerminalIds] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<
    Record<number, TerminalSessionStatus>
  >({});

  const loadedStorageKeyRef = useRef(storageKey);

  useEffect(() => {
    if (loadedStorageKeyRef.current === storageKey) return;
    loadedStorageKeyRef.current = storageKey;
    const saved = readTerminalWorkspace(storageKey);
    const nextTabs = restoreTabs(saved, enableProblems, drawerView);
    const nextLayout = saved?.layout ?? { id: "pane-1", type: "pane" as const };
    setTabs(nextTabs);
    setLayout(nextLayout);
    setActiveIds(
      saved
        ? restoreActiveIds(saved)
        : {
            "pane-1":
              enableProblems && drawerView === "problems"
                ? PROBLEMS_TAB_ID
                : (nextTabs[0]?.id ?? null),
          },
    );
    setActivePaneId(saved?.activePaneId ?? firstTerminalPaneId(nextLayout));
    setNextId(
      Math.max(
        2,
        nextTabs.reduce((max, tab) => Math.max(max, tab.id + 1), 2),
      ),
    );
    setNextPaneId(nextNumericId(terminalPaneIds(nextLayout), 2));
    setNextSplitId(nextNumericId(splitIds(nextLayout), 1));
    setTerminalIds({});
    setForeground({});
    setUserTitles(restoreTitles(saved));
    setStatuses({});
  }, [drawerView, enableProblems, storageKey]);

  useEffect(() => {
    if (loadedStorageKeyRef.current !== storageKey) return;
    const timer = window.setTimeout(() => {
      const terminalTabs = tabs.filter((tab) => !isProblemsTab(tab));
      const groups = paneIds(layout)
        .map((paneId) => {
          const sessionIds = terminalTabs
            .filter((tab) => tab.paneId === paneId)
            .map((tab) => tab.sessionId);
          const active = terminalTabs.find(
            (tab) => tab.id === activeIds[paneId],
          );
          return {
            activeSessionId: active?.sessionId ?? sessionIds[0] ?? null,
            groupId: `group:${paneId}`,
            paneId,
            sessionIds,
          };
        })
        .filter((group) => group.sessionIds.length > 0);
      writeTerminalWorkspace(storageKey, {
        activePaneId,
        drawerOpen: surfaceActive,
        groups,
        layout,
        savedAt: Date.now(),
        sessions: terminalTabs.map((tab) => ({
          connectionId: connectionId ?? null,
          cwd: tab.cwd ?? workspacePath ?? null,
          groupId: `group:${tab.paneId}`,
          paneId: tab.paneId,
          placement,
          sessionId: tab.sessionId,
          title: userTitles[tab.id] ?? "",
          workspaceKind,
        })),
        version: 2,
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    activeIds,
    activePaneId,
    connectionId,
    foreground,
    layout,
    placement,
    storageKey,
    surfaceActive,
    tabs,
    userTitles,
    workspaceKind,
    workspacePath,
  ]);

  return {
    setActivePaneId,
    activeIds,
    tabs,
    layout,
    nextId,
    setTabs,
    setActiveIds,
    setNextId,
    setUserTitles,
    nextPaneId,
    nextSplitId,
    setNextPaneId,
    setNextSplitId,
    setLayout,
    activePaneId,
    terminalIds,
    setTerminalIds,
    setForeground,
    setStatuses,
    foreground,
    statuses,
    userTitles,
    storageKey,
  };
}
