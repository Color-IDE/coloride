import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { AgentTimelineEntry } from "../agents/AgentTimeline";
import type { ExternalTranscriptItem } from "./externalAgentReducer";

function toolDetails(content: unknown): string {
  if (!Array.isArray(content))
    return content == null
      ? ""
      : typeof content === "string"
        ? content
        : JSON.stringify(content, null, 2);
  return content
    .filter((entry: Record<string, unknown>) => entry.type !== "terminal")
    .map((entry: Record<string, unknown>) => {
      if (
        entry.type === "content" &&
        entry.content &&
        typeof entry.content === "object" &&
        "text" in entry.content
      )
        return String(entry.content.text);
      if (entry.type === "diff")
        return `${entry.path ?? "File change"}\n--- Before\n${entry.oldText ?? ""}\n+++ After\n${entry.newText ?? ""}`;
      return JSON.stringify(entry, null, 2);
    })
    .join("\n\n");
}

/** ACP only adapts data; Coloride owns the conversation presentation. */
export function toAgentTimelineEntry(
  item: ExternalTranscriptItem,
  live: boolean,
  final = false,
): AgentTimelineEntry {
  if (item.kind === "user") return { id: item.id, kind: "user", text: item.text };
  if (item.kind === "agent") return {
    id: item.id, kind: "assistant", text: item.text,
    streaming: live, final, finishedAt: null,
  };
  if (item.kind === "thought") return {
    id: item.id, kind: "activity", activityId: item.id, activityKind: "thinking",
    label: "Thinking", detail: item.text, state: live ? "running" : "completed",
    durationMs: null, startedAt: null,
  };
  if (item.kind === "notice") return { id: item.id, kind: "status", text: item.text };
  if (item.kind === "plan") return {
    id: item.id, kind: "plan", plan: {
      id: item.id, sessionId: "", title: "Plan", createdAt: "", updatedAt: "",
      status: item.entries.length > 0 && item.entries.every(entry => entry.status === "completed")
        ? "completed" : "implementing",
      steps: item.entries.map((entry, index) => ({
        id: `${item.id}-${index}`, title: entry.content,
        status: entry.status === "completed" ? "done"
          : entry.status === "in_progress" ? "in_progress" : "pending",
      })),
    },
  };
  if (item.kind !== "tool") return { id: item.id, kind: "status", text: item.text };
  const review = item.toolKind === "think" && item.toolCallId.startsWith("guardian_assessment:");
  const command = item.toolKind === "execute";
  const args = item.rawInput ?? {};
  const tool = review ? "guardian_review" : command ? "execute_command"
    : item.toolKind === "edit" ? "write_file"
    : /^list files$/i.test(item.title) ? "list_files"
    : item.toolKind === "read" && (args.path || args.file_path) ? "read_file"
    : item.toolKind === "search" ? "search_files"
    : `acp_${item.toolKind || "tool"}`;
  const rawOutput = item.rawOutput;
  const output = typeof rawOutput === "string" ? rawOutput
    : rawOutput && typeof rawOutput === "object"
      ? ["stdout", "stderr", "output"].map((key) => (rawOutput as Record<string, unknown>)[key]).filter((value) => typeof value === "string").join("\n")
      : "";
  return {
    id: item.id, kind: "tool", itemId: item.toolCallId,
    tool,
    title: item.title,
    arguments: command ? { ...args, command: args.command ?? item.title }
      : { ...args, ...(args.file_path && !args.path ? { path: args.file_path } : {}) },
    output: item.terminalOutput || output || toolDetails(item.content), metadata: review ? { reviewStatus: item.status === "completed" ? "Approved" : item.status === "failed" ? "Not approved" : "Reviewing" } : {}, diff: "", preview: "",
    complete: item.status === "completed" || item.status === "failed",
    failed: item.status === "failed", waitingApproval: false,
  };
}


/** Convert each ACP file change into the same per-file diff card as native edits. */
export function toAgentTimelineEntries(item: ExternalTranscriptItem, live: boolean, final = false): AgentTimelineEntry[] {
  if (item.kind !== "tool" || item.toolKind !== "edit" || !Array.isArray(item.content)) {
    return [toAgentTimelineEntry(item, live, final)];
  }
  const edits = item.content.filter((entry) => entry?.type === "diff" && typeof entry.path === "string" && typeof entry.newText === "string");
  if (!edits.length) return [toAgentTimelineEntry(item, live, final)];
  return edits.map((edit) => {
    const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
    const newText = edit.newText as string;
    const base = toAgentTimelineEntry(item, live, final);
    if (base.kind !== "tool") return base;
    return {
      ...base, id: `${item.id}:file:${edit.path}`, tool: edit.oldText == null ? "write_file" : "replace_in_file",
      arguments: { path: edit.path, old_text: oldText, new_text: newText },
      output: "", diff: filePatch(edit.path, oldText, newText),
    };
  });
}

export function filePatch(path: string, before: string, after: string): string {
  const a = Text.of(before.split("\n"));
  const b = Text.of(after.split("\n"));
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const chunk of Chunk.build(a, b)) {
    const oldLines = chunk.fromA === chunk.toA ? [] : a.sliceString(chunk.fromA, chunk.endA).split("\n");
    const newLines = chunk.fromB === chunk.toB ? [] : b.sliceString(chunk.fromB, chunk.endB).split("\n");
    const oldStart = a.lineAt(Math.min(chunk.fromA, a.length)).number;
    const newStart = b.lineAt(Math.min(chunk.fromB, b.length)).number;
    lines.push(`@@ -${oldLines.length ? oldStart : oldStart - 1},${oldLines.length} +${newLines.length ? newStart : newStart - 1},${newLines.length} @@`, ...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`));
  }
  return lines.join("\n");
}
