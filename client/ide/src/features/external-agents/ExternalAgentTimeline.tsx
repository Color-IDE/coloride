import { useLayoutEffect, useRef } from "react";
import { AgentTimelineTurn, groupTimelineTurns, type AgentTimelineEntry } from "../agents/AgentTimeline";
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
  const command = item.toolKind === "execute";
  const args = item.rawInput ?? {};
  const tool = command ? "execute_command"
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
    output: output || toolDetails(item.content), metadata: {}, diff: "", preview: "",
    complete: item.status === "completed" || item.status === "failed",
    failed: item.status === "failed", waitingApproval: false,
  };
}

export function ExternalAgentTimeline({
  items,
  name = "External agent",
  ready = false,
  turnActive = false,
}: {
  items: ExternalTranscriptItem[];
  name?: string;
  ready?: boolean;
  turnActive?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [items]);
  if (!items.length && !turnActive) {
    if (ready) return <div className="min-h-0 flex-1" />;
    return (
      <p className="min-h-0 flex-1 px-4 py-6 text-sm text-[var(--agent-muted)]">
        {`Connecting to ${name}…`}
      </p>
    );
  }
  const entries = items.map((item, index) =>
    toAgentTimelineEntry(
      item,
      turnActive && index === items.length - 1,
      !turnActive && (index === items.length - 1 || items[index + 1]?.kind === "user"),
    ),
  );
  const latest = items.at(-1);
  if (turnActive && (!latest || latest.kind === "user" || (latest?.kind === "tool" && ["completed", "failed"].includes(latest.status)))) {
    entries.push({ id: "external-agent-waiting", kind: "activity", activityId: "external-agent-waiting", activityKind: "thinking", label: "Thinking", detail: "", state: "running", durationMs: null, startedAt: null });
  }
  const turns = groupTimelineTurns(entries);
  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const element = scrollRef.current;
        if (element)
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            96;
      }}
      aria-label={`${name} conversation`}
      className="agent-main agent-timeline agent-timeline-native agent-chat-column min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
    >
      <div className="agent-timeline-virtual-header" />
      {turns.map((turn, index) => (
        <div key={turn.id} className="agent-timeline-virtual-item agent-chat-measure">
          <AgentTimelineTurn
            user={turn.user}
            items={turn.items}
            turnActive={turnActive && index === turns.length - 1}
          />
        </div>
      ))}
      <div className="agent-timeline-virtual-footer" />
    </div>
  );
}
