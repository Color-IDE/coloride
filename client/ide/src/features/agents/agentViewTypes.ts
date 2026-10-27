import { type MouseEventHandler } from "react";

export type AgentFileStreamApply = (input: {
  path: string;
  content?: string;
  oldText?: string;
  newText?: string;
  replaceAll?: boolean;
  phase: "streaming" | "final" | "failed" | "deleted";
  reload?: boolean;
  restored?: boolean;
  etag?: string;
}) => Promise<boolean>;

export interface AgentViewProps {
  /** False while another app tab is shown; view stays mounted to preserve chat scroll. */
  active?: boolean;
  connected: boolean;
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  /**
   * Live agent edits → Explorer editor (Cursor-style).
   * Opens the path and applies streaming/final content.
   */
  onApplyAgentFileStream?: AgentFileStreamApply;
  /**
   * Sidebar only: Open on a Wrote/Edited row → Explorer Monaco/CodeMirror on the left
   * (not the Agents-tab workspace card).
   */
  onOpenExplorerFile?: (
    path: string,
    options?: { line?: number; column?: number },
  ) => void | Promise<unknown>;
  /** Open a local in-memory dump in Explorer Monaco — never writes to the VPS. */
  onOpenAgentLogDump?: (fileName: string, content: string) => void;
  serverName: string;
  sidePanelOpen: boolean;
  sidePanelWidth: number;
  workspacePath: string | null;
  workspaceKind?: "local" | "ssh";
  connectionId?: string | null;
  /**
   * full — Agents tab (session list + chat + workspace).
   * sidebar — docked right panel inside Explorer (chat only).
   */
  presentation?: "full" | "sidebar";
  /** Storage namespace. Coloride uses "agent" for both full and sidebar presentations. */
  sessionPane?: "agent" | "sidebar";
  /**
   * workspace — Explorer chat stays inside the open folder.
   * server — Agents tab may work across the permitted VPS areas.
   */
  filesystemScope?: "workspace" | "server";
  /** Close the explorer-docked agent sidebar (X in header). */
  onCloseSidebar?: () => void;
  /** Open a folder browser to pick a workspace for a new task. */
  onBrowseWorkspace?: () => Promise<string | null>;
  /**
   * Register/authorize a workspace before a new task adopts it. The returned
   * path may differ from the requested path (for example, a safe Production copy).
   */
  onPrepareWorkspace?: (path: string) => Promise<string>;
}
