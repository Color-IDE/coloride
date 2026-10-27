import type { AgentTerminalReference } from "../../../shared/api/types";
import type { DiagnosticMarker } from "../../editor";
import { type SplitPlacement } from "../terminalLayout";
import type { TerminalSplitNode } from "../terminalTypes";

export type PaneId = string;

export type DropPlacement = SplitPlacement | "center";

export interface TerminalTab {
  cwd?: string | null;
  id: number;
  paneId: PaneId;
  kind: "terminal" | "problems";
  /**
   * Stable unique identity for the remote tmux session.
   * Must never be reused across tabs — otherwise two tabs attach to the
   * same shell (tmux new-session -A) and "merge" keystrokes/output.
   */
  sessionId: string;
}

export type LayoutNode = TerminalSplitNode;

export interface TerminalPanelProps {
  initialTerminal?: AgentTerminalReference;
  requestedTerminals?: AgentTerminalReference[];
  onAgentTerminalClose?: (sessionId: string) => void;
  connected: boolean;
  embedded?: boolean;
  /** Hide the internal terminal tab strip (e.g. Agent workspace already has outer tabs). */
  hideHeader?: boolean;
  /**
   * False while the parent surface is hidden (other app tab, collapsed card).
   * Keeps PTY alive but skips fit/focus until visible again.
   */
  surfaceActive?: boolean;
  onEmpty?: () => void;
  onOpenBrowserUrl?: (url: string) => void | Promise<unknown>;
  onOpenRemoteFile?: (path: string) => void | Promise<unknown>;
  terminalRequest?: number;
  workspacePath?: string | null;
  workspaceKind: "local" | "ssh";
  connectionId?: string | null;
  /** Explorer drawer only: Problems as a sibling tab of the terminals. */
  enableProblems?: boolean;
  problemsMarkers?: DiagnosticMarker[];
  onRevealProblem?: (line: number, column: number) => void;
  drawerView?: "terminal" | "problems";
  onDrawerViewChange?: (view: "terminal" | "problems") => void;
  placement?: "drawer" | "center";
  onPlacementChange?: (placement: "drawer" | "center") => void;
}

export type TerminalMenu = { tabId: number; x: number; y: number } | null;

export type PointerDrag = {
  active: boolean;
  grabX: number;
  grabY: number;
  startX: number;
  startY: number;
  tabId: number;
  width: number;
};

export type DropPreview = {
  beforeTabId?: number;
  paneId: PaneId;
  placement: DropPlacement;
};

export type SurfaceRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};
