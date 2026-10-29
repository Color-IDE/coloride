import type { FileTreeItem } from "../../explorer/filetree/FileTree";
import type { ConnDirectRequest, Profile } from "../../../shared/api/types";

export type AuthMethod = "password" | "ssh-key" | "ssh-agent";

export type ConnectionState = "idle" | "connecting" | "connected" | "failed";

export type EditorBuffer = {
  dirty: boolean;
  error: string;
  etag: string | null;
  imageUrl: string | null;
  truncated: boolean;
  value: string;
  /** Agent is streaming writes into this buffer — not user-dirty. */
  agentStreaming?: boolean;
  /** Remote path no longer exists. The tab stays open, struck through. */
  missing?: boolean;
};

export type AgentFileStreamPhase = "streaming" | "final" | "failed" | "deleted";

export type ApplyAgentFileStreamInput = {
  path: string;
  /** Full content so far (write_file) or complete file after replace. */
  content?: string;
  /** Partial or complete old_text / new_text during replace_in_file streaming. */
  oldText?: string;
  newText?: string;
  replaceAll?: boolean;
  phase: AgentFileStreamPhase;
  /** Force read from remote on final (ignore provided content). */
  reload?: boolean;
  /** Checkpoint Undo: refresh disk state without creating another agent review. */
  restored?: boolean;
  /** Remote etag when restoring a failed optimistic write. */
  etag?: string;
};

export type TreeUndoFileSnapshot = {
  path: string;
  contentBase64: string;
};

export type TreeUndoDeleteEntry = {
  type: "delete";
  rootPaths: string[];
  /** Directory paths shortest-first (parents before children). */
  dirs: string[];
  files: TreeUndoFileSnapshot[];
};

export type TreeUndoCreateEntry = {
  type: "create";
  items: { path: string; kind: FileTreeItem["kind"] }[];
};

export type TreeUndoMoveEntry = {
  type: "move";
  source: string;
  destination: string;
  kind: FileTreeItem["kind"];
};

export type TreeUndoEntry = TreeUndoDeleteEntry | TreeUndoCreateEntry | TreeUndoMoveEntry;

export type PendingConnection =
  | { kind: "direct"; connection: ConnDirectRequest }
  | { kind: "profile"; profile: Profile };
