import type {
  AgentApproval,
  AgentCheckpoint,
  AgentPlan,
  AgentTerminalReference,
} from "@coloride/contracts";

export type ActivityState = "running" | "completed" | "failed";

export type ToolTimelineEntry = {
  id: string;
  kind: "tool";
  itemId: string;
  tool: string;
  title: string;
  arguments: Record<string, unknown>;
  output: string;
  metadata: Record<string, unknown>;
  diff: string;
  preview: string;
  complete: boolean;
  failed: boolean;
  waitingApproval: boolean;
};

export type ActivityTimelineEntry = {
  id: string;
  kind: "activity";
  activityId: string;
  /** "thinking" (default) or "context" compaction row. */
  activityKind: "thinking" | "context";
  label: string;
  detail: string;
  state: ActivityState;
  durationMs: number | null;
  /** ISO timestamp when this activity first appeared (for live elapsed clock). */
  startedAt: string | null;
};

export type AgentAssistantTimelineEntry = {
  id: string;
  kind: "assistant";
  activityId?: string;
  text: string;
  /** ISO timestamp of last streamed chunk / done. */
  finishedAt: string | null;
  streaming: boolean;
  /** True when this bubble is the end of a full assistant turn (show actions). */
  final: boolean;
};

export type ExploreTimelineItem = ActivityTimelineEntry | ToolTimelineEntry;

export type AgentUserAttachment = {
  name: string;
  kind: "image" | "file" | "code" | string;
  mime?: string;
  size?: number;
  path?: string | null;
  previewDataUrl?: string | null;
  startLine?: number;
  endLine?: number;
};

export type AgentUserTimelineEntry = {
  id: string;
  kind: "user";
  text: string;
  attachments?: AgentUserAttachment[];
  pluginIds?: string[];
};

export type AgentTimelineEntry =
  | AgentUserTimelineEntry
  | { id: string; kind: "error" | "mode"; text: string }
  | { id: string; kind: "plan"; text?: string; plan?: AgentPlan }
  | AgentAssistantTimelineEntry
  | ActivityTimelineEntry
  | ToolTimelineEntry
  | {
      id: string;
      kind: "explore_group";
      items: ExploreTimelineItem[];
    }
  | { id: string; kind: "diff"; patch: string }
  | { id: string; kind: "checkpoint"; checkpoint: AgentCheckpoint }
  | { id: string; kind: "status"; text: string }
  | { id: string; kind: "approval"; approval: AgentApproval };

export type AgentOpenFileRequest = {
  path: string;
  /** Unified diff patch so the right editor can show green/red changes. */
  patch?: string;
  line?: number;
};

export interface AgentTimelineItemProps {
  entry: AgentTimelineEntry;
  turnActive: boolean;
  /** Open a path in the right Agent file workspace (Wrote / Edited rows). */
  onOpenFile?: (request: AgentOpenFileRequest) => void;
  /** Open http(s) links in the right Agent browser (not the system browser). */
  onOpenBrowserUrl?: (url: string) => void;
  /** Reveal the native PTY backing a process row. */
  onOpenTerminal?: (terminal: AgentTerminalReference) => void;
}

export type CheckpointFileStat = {
  additions: number;
  deletions: number;
  patch?: string;
};

export type LiveEditPayload =
  | { kind: "write"; code: string }
  | { kind: "replace"; oldText: string; newText: string };

export type TermTone =
  | "cmd"
  | "flag"
  | "string"
  | "number"
  | "path"
  | "op"
  | "comment"
  | "error"
  | "success"
  | "warn"
  | "info"
  | "dim";

export type TermSegment = { text: string; tone?: TermTone };

export type DiffTableRow = {
  kind: "addition" | "deletion" | "context";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};
