import { useEffect, useRef, useState } from "react";
import { AgentMessageText } from "./Markdown";
import { CollapsibleSection, ShimmerActionLabel } from "./Primitives";
import { formatThoughtDuration } from "./formatting";
import { ContextCompactIcon, ExpandChevronIcon, ThoughtIcon } from "./icons";
import { compactThoughtText } from "./model";
import { type AgentTimelineEntry } from "./types";

/** Below this, completed thoughts without a summary use "Thought briefly". */
export const THOUGHT_BRIEF_MS = 2_000;

export function AgentThinkingRow({
  entry,
}: {
  entry: Extract<AgentTimelineEntry, { kind: "activity" }>;
}) {
  const isContext = entry.activityKind === "context";
  const hasDetail = Boolean(entry.detail.trim());
  const running = entry.state === "running";
  const failed = entry.state === "failed";
  const hasDuration = entry.durationMs !== null && entry.durationMs > 0;
  const [expanded, setExpanded] = useState(false);
  /** Once the user toggles, never auto open/close that block. */
  const userTouchedRef = useRef(false);

  // Lifecycle shell and an optional summary:
  // - auto-open while a real summary streams
  // - collapse when complete unless the user took control
  useEffect(() => {
    if (userTouchedRef.current) return;
    if (running && hasDetail) {
      setExpanded(true);
      return;
    }
    if (!running && hasDetail) {
      setExpanded(false);
    }
  }, [running, hasDetail, entry.activityId]);

  // Duration only after thinking finishes, for example "Thought for 8s".
  const durationLabel = hasDuration
    ? formatThoughtDuration(entry.durationMs!)
    : "";

  // Copy: app-owned Thinking state vs optional summary disclosure.
  // Live = lamp + shimmer only ("Thinking"). Timer appears on complete.
  let verb = "Thinking";
  let rest = "";
  if (isContext) {
    if (running) {
      verb = "Compacting context";
      rest = "";
    } else if (failed) {
      verb = "Context";
      rest = "failed";
    } else {
      verb = "Context compacted";
      rest = durationLabel ? `· ${durationLabel}` : "";
    }
  } else if (running) {
    verb = entry.label?.trim() || "Thinking";
    rest = "";
  } else if (failed) {
    verb = "Thought";
    rest = "failed";
  } else if (hasDetail) {
    // Real summary from the provider — expandable Thought + duration.
    verb = "Thought";
    rest = durationLabel ? `for ${durationLabel}` : "";
  } else {
    // No summary (no chevron) — keep the completed lifecycle visible even
    // when an older provider did not report a duration.
    const ms = entry.durationMs ?? 0;
    if (ms > 0 && ms < THOUGHT_BRIEF_MS) {
      verb = "Thought briefly";
      rest = "";
    } else {
      verb = "Thought";
      rest = durationLabel ? `for ${durationLabel}` : "";
    }
  }

  const title = rest ? `${verb} ${rest}` : verb;
  const detailOpen = Boolean(expanded && hasDetail);

  return (
    <div
      className={`agent-thinking ${isContext ? "agent-context-row" : ""} ${running ? "is-running" : ""} ${failed ? "is-failed" : ""}${hasDetail ? " has-detail" : ""}`}
    >
      <button
        aria-expanded={hasDetail ? detailOpen : undefined}
        className="agent-thinking-toggle"
        disabled={!hasDetail}
        onClick={() => {
          if (!hasDetail) return;
          userTouchedRef.current = true;
          setExpanded((current) => !current);
        }}
        title={title}
        type="button"
      >
        {/* Lamp always present for thinking rows (running + after 2s timer + complete). */}
        <span
          className={`agent-thinking-icon ${isContext ? "is-context" : ""}${isContext && running ? " is-spinning" : ""}`}
          aria-hidden="true"
        >
          {isContext ? <ContextCompactIcon /> : <ThoughtIcon />}
        </span>
        <ShimmerActionLabel
          className="agent-thinking-label"
          detail={running ? "" : rest}
          running={running}
          text={title}
          verb={verb}
        />
        {hasDetail ? (
          <span
            className={`agent-thinking-chevron ${detailOpen ? "is-open" : ""}`}
          >
            <ExpandChevronIcon />
          </span>
        ) : null}
      </button>
      <CollapsibleSection className="agent-thinking-detail" open={detailOpen}>
        <AgentMessageText
          streaming={running}
          text={compactThoughtText(entry.detail)}
        />
      </CollapsibleSection>
    </div>
  );
}
