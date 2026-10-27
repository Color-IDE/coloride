import type { TerminalGroup, TerminalSplitNode } from "./terminalTypes";

export type SplitPlacement = "top" | "right" | "bottom" | "left";

export type TerminalLayoutState = {
  groups: TerminalGroup[];
  layout: TerminalSplitNode;
};

export type TerminalLayoutAction =
  | { type: "move"; sessionId: string; toPaneId: string; beforeSessionId?: string }
  | { type: "split"; sessionId: string; sourcePaneId: string; newPaneId: string; splitId: string; placement: SplitPlacement }
  | { type: "ratio"; splitId: string; ratio: number }
  | { type: "remove"; sessionId: string };

export function terminalLayoutReducer(state: TerminalLayoutState, action: TerminalLayoutAction): TerminalLayoutState {
  if (action.type === "ratio") {
    return { ...state, layout: updateTerminalSplitRatio(state.layout, action.splitId, action.ratio) };
  }
  const groups = state.groups.map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter((sessionId) => sessionId !== action.sessionId),
    activeSessionId: group.activeSessionId === action.sessionId ? null : group.activeSessionId,
  }));
  if (action.type === "remove") {
    const live = normalizeGroups(groups);
    return { groups: live, layout: compactTerminalLayout(state.layout, live) ?? { id: "pane-1", type: "pane" } };
  }
  let layout = state.layout;
  let destination = action.type === "move"
    ? groups.find((group) => group.paneId === action.toPaneId)
    : undefined;
  if (action.type === "split") {
    destination = {
      activeSessionId: action.sessionId,
      groupId: `group:${action.newPaneId}`,
      paneId: action.newPaneId,
      sessionIds: [],
    };
    groups.push(destination);
    layout = replaceTerminalPane(layout, action.sourcePaneId, createTerminalSplit(
      action.splitId,
      action.sourcePaneId,
      action.newPaneId,
      action.placement,
    ));
  }
  if (!destination) return state;
  const index = action.type === "move" && action.beforeSessionId
    ? destination.sessionIds.indexOf(action.beforeSessionId)
    : -1;
  destination.sessionIds = index < 0
    ? [...destination.sessionIds, action.sessionId]
    : [...destination.sessionIds.slice(0, index), action.sessionId, ...destination.sessionIds.slice(index)];
  destination.activeSessionId = action.sessionId;
  const live = normalizeGroups(groups);
  return { groups: live, layout: compactTerminalLayout(layout, live) ?? layout };
}

function normalizeGroups(groups: TerminalGroup[]) {
  return groups.filter((group) => group.sessionIds.length > 0).map((group) => ({
    ...group,
    activeSessionId: group.sessionIds.includes(group.activeSessionId || "")
      ? group.activeSessionId
      : group.sessionIds[0] ?? null,
  }));
}

export function createTerminalSplit(
  id: string,
  targetPaneId: string,
  newPaneId: string,
  placement: SplitPlacement,
): TerminalSplitNode {
  const target: TerminalSplitNode = { id: targetPaneId, type: "pane" };
  const added: TerminalSplitNode = { id: newPaneId, type: "pane" };
  const addedFirst = placement === "left" || placement === "top";
  return {
    direction: placement === "left" || placement === "right" ? "horizontal" : "vertical",
    first: addedFirst ? added : target,
    id,
    ratio: 0.5,
    second: addedFirst ? target : added,
    type: "split",
  };
}

export function replaceTerminalPane(
  node: TerminalSplitNode,
  paneId: string,
  replacement: TerminalSplitNode,
): TerminalSplitNode {
  if (node.type === "pane") return node.id === paneId ? replacement : node;
  return {
    ...node,
    first: replaceTerminalPane(node.first, paneId, replacement),
    second: replaceTerminalPane(node.second, paneId, replacement),
  };
}

export function updateTerminalSplitRatio(
  node: TerminalSplitNode,
  splitId: string,
  ratio: number,
): TerminalSplitNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) return { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) };
  return {
    ...node,
    first: updateTerminalSplitRatio(node.first, splitId, ratio),
    second: updateTerminalSplitRatio(node.second, splitId, ratio),
  };
}

export function compactTerminalLayout(
  node: TerminalSplitNode,
  groups: TerminalGroup[],
): TerminalSplitNode | null {
  if (node.type === "pane") {
    return groups.some((group) => group.paneId === node.id && group.sessionIds.length > 0) ? node : null;
  }
  const first = compactTerminalLayout(node.first, groups);
  const second = compactTerminalLayout(node.second, groups);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function terminalPaneIds(node: TerminalSplitNode): string[] {
  return node.type === "pane" ? [node.id] : [...terminalPaneIds(node.first), ...terminalPaneIds(node.second)];
}

export function firstTerminalPaneId(node: TerminalSplitNode): string {
  return node.type === "pane" ? node.id : firstTerminalPaneId(node.first);
}
