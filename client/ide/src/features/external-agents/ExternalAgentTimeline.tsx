import { useLayoutEffect, useRef } from "react";
import { AgentTimelineTurn, groupTimelineTurns } from "../agents/AgentTimeline";
import type { ExternalTranscriptItem } from "./externalAgentReducer";
import { toAgentTimelineEntries } from "./presentExternalTimeline";

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
  const entries = items.flatMap((item, index) =>
    toAgentTimelineEntries(
      item,
      turnActive && index === items.length - 1,
      !turnActive && (index === items.length - 1 || items[index + 1]?.kind === "user"),
    ),
  );
  const latest = items.at(-1);
  const lastUserIndex = items.reduce((last, item, index) => item.kind === "user" ? index : last, 0);
  const currentTurn = items.slice(lastUserIndex);
  const pendingTool = currentTurn.some(item => item.kind === "tool" && !["completed", "failed"].includes(item.status));
  if (turnActive && latest?.kind !== "thought" && !pendingTool) {
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
