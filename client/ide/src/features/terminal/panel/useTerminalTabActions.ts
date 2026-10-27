import type { Dispatch, RefObject, SetStateAction } from "react";
import { api } from "../../../shared/api/client";
import type { AgentTerminalReference } from "../../../shared/api/types";
import { closeManagedTerminalSession } from "../TerminalSessionManager";
import { firstTerminalPaneId } from "../terminalLayout";
import type {
  TerminalSessionStatus,
  TerminalSplitNode,
} from "../terminalTypes";
import {
  compactLayout,
  isProblemsTab,
  newTerminalSessionId,
  omitKey,
  paneIds,
  resolveActiveIds,
} from "./layout";
import { type TerminalTab } from "./types";

interface Dependencies {
  tabs: TerminalTab[];
  setTabs: Dispatch<SetStateAction<TerminalTab[]>>;
  setActiveIds: Dispatch<SetStateAction<Record<string, number | null>>>;
  onDrawerViewChange: ((view: "terminal" | "problems") => void) | undefined;
  onEmpty: (() => void) | undefined;
  layout: TerminalSplitNode;
  setLayout: Dispatch<SetStateAction<TerminalSplitNode>>;
  activeIds: Record<string, number | null>;
  terminalIds: Record<number, string>;
  initialTerminal: AgentTerminalReference | undefined;
  requestedRef: RefObject<Set<string>>;
  onAgentTerminalClose: ((sessionId: string) => void) | undefined;
  setTerminalIds: Dispatch<SetStateAction<Record<number, string>>>;
  setForeground: Dispatch<SetStateAction<Record<number, string>>>;
  setStatuses: Dispatch<SetStateAction<Record<number, TerminalSessionStatus>>>;
  setUserTitles: Dispatch<SetStateAction<Record<number, string>>>;
  activePaneId: string;
  setActivePaneId: Dispatch<SetStateAction<string>>;
}
export function useTerminalTabActions({
  tabs,
  setTabs,
  setActiveIds,
  onDrawerViewChange,
  onEmpty,
  layout,
  setLayout,
  activeIds,
  terminalIds,
  initialTerminal,
  requestedRef,
  onAgentTerminalClose,
  setTerminalIds,
  setForeground,
  setStatuses,
  setUserTitles,
  activePaneId,
  setActivePaneId,
}: Dependencies) {
  const closeTab = (id: number) => {
    const closed = tabs.find((tab) => tab.id === id);
    if (!closed) return;

    if (isProblemsTab(closed)) {
      const nextTabs = tabs.filter((tab) => tab.id !== id);
      if (nextTabs.length === 0) {
        setTabs([]);
        setActiveIds({});
        onDrawerViewChange?.("terminal");
        onEmpty?.();
        return;
      }
      const nextLayout = compactLayout(layout, nextTabs) ?? {
        id: nextTabs[0].paneId,
        type: "pane",
      };
      setTabs(nextTabs);
      setLayout(nextLayout);
      setActiveIds(resolveActiveIds(nextLayout, nextTabs, activeIds));
      onDrawerViewChange?.("terminal");
      return;
    }

    void closeManagedTerminalSession(closed.sessionId)
      .then((closedByManager) => {
        if (closedByManager) return;
        const termId = terminalIds[id];
        if (termId) void api.closeTerminal(termId).catch(() => {});
      })
      .catch(() => {});
    if (
      initialTerminal?.sessionId === closed.sessionId ||
      requestedRef.current.has(closed.sessionId)
    ) {
      requestedRef.current.delete(closed.sessionId);
      onAgentTerminalClose?.(closed.sessionId);
    }

    setTerminalIds((current) => omitKey(current, id));
    setForeground((current) => omitKey(current, id));
    setStatuses((current) => omitKey(current, id));
    setUserTitles((current) => omitKey(current, id));

    const nextTabs = tabs.filter((tab) => tab.id !== id);
    if (nextTabs.length === 0) {
      setTabs([]);
      setActiveIds({});
      onEmpty?.();
      return;
    }

    const nextLayout = compactLayout(layout, nextTabs) ?? {
      id: nextTabs[0].paneId,
      type: "pane",
    };
    setTabs(nextTabs);
    setLayout(nextLayout);
    setActiveIds(resolveActiveIds(nextLayout, nextTabs, activeIds));
    if (!paneIds(nextLayout).includes(activePaneId))
      setActivePaneId(firstTerminalPaneId(nextLayout));
  };

  const restartTab = async (id: number) => {
    const current = tabs.find((tab) => tab.id === id && !isProblemsTab(tab));
    if (!current) return;
    // Closing the tmux session is asynchronous. Creating the replacement
    // before it finishes makes `tmux new-session -A` attach the old shell,
    // which means new terminal features (shell integration, shell setting)
    // silently never take effect.
    try {
      const closedByManager = await closeManagedTerminalSession(
        current.sessionId,
      );
      if (!closedByManager) {
        const termId = terminalIds[id];
        if (termId) await api.closeTerminal(termId);
      }
    } catch {
      // Keep the existing recovery behaviour: create a fresh session even if
      // the transport was already gone; it will reconnect normally.
    }
    setTerminalIds((values) => omitKey(values, id));
    setForeground((values) => omitKey(values, id));
    setStatuses((values) => ({ ...omitKey(values, id), [id]: "connecting" }));
    setTabs((values) =>
      values.map((tab) =>
        tab.id === id ? { ...tab, sessionId: newTerminalSessionId() } : tab,
      ),
    );
    setActivePaneId(current.paneId);
  };

  return { closeTab, restartTab };
}
