import {
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { AgentTimelineEntry, AgentUserTimelineEntry } from "./AgentTimeline";

export type TimelineScrubTurn = {
  id: string;
  user: AgentUserTimelineEntry | null;
  items: AgentTimelineEntry[];
};

type ScrubMark = {
  id: string;
  index: number;
  userText: string;
  previewText: string;
  files: string[];
};

type HoverState = {
  mark: ScrubMark;
  x: number;
  y: number;
};

function firstAssistantText(items: AgentTimelineEntry[]): string {
  for (const item of items) {
    if (item.kind === "assistant" && item.text.trim()) return item.text.trim();
  }
  return "";
}

function editedFiles(items: AgentTimelineEntry[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (item.tool !== "write_file" && item.tool !== "replace_in_file") continue;
    const path = typeof item.arguments.path === "string" ? item.arguments.path.trim() : "";
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push(path.split("/").filter(Boolean).at(-1) || path);
    if (files.length >= 3) break;
  }
  return files;
}

function truncate(value: string, max = 72) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

interface AgentTimelineScrubberProps {
  turns: TimelineScrubTurn[];
  visible: boolean;
  activeIndex: number;
  onJump: (index: number) => void;
}

/**
 * Simple jump buttons drawn as lines — one per turn.
 * Not a scrollbar: no drag, no progress thumb, no scroll tracking UI.
 */
export function AgentTimelineScrubber({
  turns,
  visible,
  activeIndex,
  onJump,
}: AgentTimelineScrubberProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const marks = useMemo(() => {
    return turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => turn.user || turn.items.length > 0)
      .map(({ turn, index }) => ({
        id: turn.id,
        index,
        userText: turn.user?.text?.trim() || "",
        previewText: firstAssistantText(turn.items),
        files: editedFiles(turn.items),
      }));
  }, [turns]);

  const showMarkPreview = (mark: ScrubMark, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setHover({
      mark,
      x: rect.right + 18,
      y: rect.top + rect.height / 2,
    });
  };

  const clearHover = () => setHover(null);

  /** Wave strength 0–3: peak on hovered line, falloff on neighbors (length only). */
  const waveLevel = (index: number) => {
    if (hover == null) return 0;
    const distance = Math.abs(index - hover.mark.index);
    if (distance === 0) return 3;
    if (distance === 1) return 2;
    if (distance === 2) return 1;
    return 0;
  };

  /**
   * White highlight: only the active/selected tick.
   * While hovering, the hovered line is selected; otherwise the scroll-active turn.
   */
  const selectedIndex = hover?.mark.index ?? activeIndex;

  if (!visible || marks.length === 0) return null;

  return (
    <>
      <div
        aria-label="Jump through conversation"
        className={`agent-timeline-scrubber${hover ? " is-wave" : ""}`}
        onMouseLeave={clearHover}
        role="navigation"
      >
        <div className="agent-timeline-scrubber-track">
          {marks.map((mark) => {
            const level = waveLevel(mark.index);
            const selected = mark.index === selectedIndex;
            return (
              <button
                key={mark.id}
                aria-current={selected ? "true" : undefined}
                aria-label={truncate(mark.userText || mark.previewText || `Turn ${mark.index + 1}`, 80)}
                className={[
                  "agent-timeline-scrubber-tick",
                  selected ? "is-selected" : "",
                  level > 0 ? `is-wave-${level}` : "",
                ].filter(Boolean).join(" ")}
                type="button"
                onClick={() => onJump(mark.index)}
                onBlur={clearHover}
                onFocus={(event) => showMarkPreview(mark, event.currentTarget)}
                onMouseEnter={(event) => showMarkPreview(mark, event.currentTarget)}
              />
            );
          })}
        </div>
      </div>

      {hover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="agent-timeline-scrubber-card"
            style={{
              left: hover.x,
              top: hover.y,
              transform: "translateY(-50%)",
            }}
          >
            {hover.mark.userText ? (
              <div className="agent-timeline-scrubber-card-user">
                {truncate(hover.mark.userText, 90)}
              </div>
            ) : null}
            {hover.mark.previewText ? (
              <div className="agent-timeline-scrubber-card-preview">
                {truncate(hover.mark.previewText, 120)}
              </div>
            ) : null}
            {hover.mark.files.length > 0 ? (
              <div className="agent-timeline-scrubber-card-files">
                {hover.mark.files.map((file) => (
                  <span className="agent-timeline-scrubber-card-file" key={file}>
                    <span aria-hidden="true">#</span> {file}
                  </span>
                ))}
              </div>
            ) : null}
            {!hover.mark.userText && !hover.mark.previewText && hover.mark.files.length === 0 ? (
              <div className="agent-timeline-scrubber-card-preview">Jump to this turn</div>
            ) : null}
          </div>,
          document.body,
        )}
    </>
  );
}
