import {
  type LayoutNode,
  type PaneId,
  type SurfaceRect,
  type TerminalTab,
} from "./types";

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export const DEFAULT_SHELL = "bash";

export const PROBLEMS_TAB_ID = 0;

export function isProblemsTab(tab: Pick<TerminalTab, "kind"> | undefined) {
  return tab?.kind === "problems";
}

export function makeProblemsTab(paneId: PaneId): TerminalTab {
  return {
    id: PROBLEMS_TAB_ID,
    paneId,
    kind: "problems",
    sessionId: "problems",
  };
}

export function initialTabs(
  enableProblems: boolean,
  drawerView: "terminal" | "problems",
): TerminalTab[] {
  const terminal: TerminalTab = {
    id: 1,
    paneId: "pane-1",
    kind: "terminal",
    sessionId: newTerminalSessionId(),
  };
  if (enableProblems && drawerView === "problems") {
    return [makeProblemsTab("pane-1"), terminal];
  }
  return [terminal];
}

/** Fresh identity for every terminal tab — never derived from sequential ids. */
export function newTerminalSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const baseName = (path?: string | null, fallback = "workspace") => {
  const trimmed = (path ?? "").replace(/\/+$/, "");
  return trimmed.split("/").at(-1) || fallback;
};

export function sameSurfaceRects(
  current: Record<string, SurfaceRect>,
  next: Record<string, SurfaceRect>,
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) return false;
  return nextKeys.every((key) => {
    const a = current[key];
    const b = next[key];
    return (
      a &&
      Math.abs(a.height - b.height) < 0.5 &&
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5
    );
  });
}

export function nextNumericId(values: string[], fallback: number) {
  return values.reduce((max, value) => {
    const match = value.match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1]) + 1) : max;
  }, fallback);
}

export function splitIds(node: LayoutNode): string[] {
  return node.type === "pane"
    ? []
    : [node.id, ...splitIds(node.first), ...splitIds(node.second)];
}

export function compactLayout(
  node: LayoutNode,
  tabs: TerminalTab[],
): LayoutNode | null {
  if (node.type === "pane") {
    return tabs.some((tab) => tab.paneId === node.id) ? node : null;
  }

  const first = compactLayout(node.first, tabs);
  const second = compactLayout(node.second, tabs);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function paneIds(node: LayoutNode): PaneId[] {
  return node.type === "pane"
    ? [node.id]
    : [...paneIds(node.first), ...paneIds(node.second)];
}

export function resolveActiveIds(
  layout: LayoutNode,
  tabs: TerminalTab[],
  preferred: Record<PaneId, number | null>,
) {
  return Object.fromEntries(
    paneIds(layout).map((paneId) => {
      const paneTabs = tabs.filter((tab) => tab.paneId === paneId);
      const preferredId = preferred[paneId];
      return [
        paneId,
        paneTabs.some((tab) => tab.id === preferredId)
          ? preferredId
          : (paneTabs[0]?.id ?? null),
      ];
    }),
  );
}

export function omitKey<T>(record: Record<number, T>, key: number) {
  const next = { ...record };
  delete next[key];
  return next;
}
