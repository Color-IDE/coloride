export type TerminalSessionStatus = "connecting" | "ready" | "disconnected" | "exited" | "error";

export type TerminalPlacement = "drawer" | "center";

export interface TerminalSessionDescriptor {
  sessionId: string;
  groupId: string;
  paneId: string;
  placement: TerminalPlacement;
  cwd: string | null;
  title: string;
  workspaceKind: "local" | "ssh";
  connectionId: string | null;
  status: TerminalSessionStatus;
  termId?: string;
}

export interface TerminalGroup {
  groupId: string;
  paneId: string;
  sessionIds: string[];
  activeSessionId: string | null;
}

export interface TerminalPaneNode {
  id: string;
  type: "pane";
}

export interface TerminalSplitBranch {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  first: TerminalSplitNode;
  second: TerminalSplitNode;
}

export type TerminalSplitNode = TerminalPaneNode | TerminalSplitBranch;

export type WorkspaceCenterItem =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "browser"; browserId: string }
  | { id: string; kind: "terminal"; sessionId: string };

export interface PersistedTerminalWorkspace {
  version: 2;
  sessions: Array<Pick<TerminalSessionDescriptor,
    "sessionId" | "groupId" | "paneId" | "placement" | "cwd" | "title" | "workspaceKind" | "connectionId"
  >>;
  groups: TerminalGroup[];
  layout: TerminalSplitNode;
  activePaneId: string;
  drawerOpen: boolean;
  drawerHeight?: number;
  savedAt: number;
}

