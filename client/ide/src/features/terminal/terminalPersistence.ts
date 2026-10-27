import type { PersistedTerminalWorkspace, TerminalSplitNode } from "./terminalTypes";

const PREFIX = "coloride.terminal.v2";

export function terminalWorkspaceStorageKey(input: {
  workspaceKind: "local" | "ssh";
  connectionId?: string | null;
  workspacePath?: string | null;
}) {
  return [PREFIX, input.workspaceKind, input.connectionId || "local", input.workspacePath || "workspace"]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function readTerminalWorkspace(key: string): PersistedTerminalWorkspace | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as PersistedTerminalWorkspace | null;
    if (!value || value.version !== 2 || !isLayout(value.layout) || !Array.isArray(value.sessions)) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeTerminalWorkspace(key: string, value: PersistedTerminalWorkspace) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be disabled or full. Terminal sessions must keep working.
  }
}

function isLayout(value: unknown): value is TerminalSplitNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<TerminalSplitNode>;
  if (node.type === "pane") return typeof node.id === "string";
  return node.type === "split"
    && typeof node.id === "string"
    && (node.direction === "horizontal" || node.direction === "vertical")
    && typeof node.ratio === "number"
    && isLayout(node.first)
    && isLayout(node.second);
}

