import { FileDiffIcon } from "@hugeicons/core-free-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { parseUnifiedDiff } from "./formatting";

export function AgentDiffViewer({
  patch,
  preferredPath = "",
  preview = false,
  hideHeader = false,
  animateReveal = false,
  onRevealStateChange,
}: {
  patch: string;
  preferredPath?: string;
  preview?: boolean;
  hideHeader?: boolean;
  animateReveal?: boolean;
  onRevealStateChange?: (state: {
    revealing: boolean;
    additions: number;
    deletions: number;
  }) => void;
}) {
  const parsed = useMemo(
    () => parseUnifiedDiff(patch, preferredPath),
    [patch, preferredPath],
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const onRevealStateChangeRef = useRef(onRevealStateChange);
  onRevealStateChangeRef.current = onRevealStateChange;

  const [visibleCount, setVisibleCount] = useState(() =>
    animateReveal && parsed.rows.length > 4
      ? Math.min(4, parsed.rows.length)
      : parsed.rows.length,
  );

  useEffect(() => {
    if (!animateReveal) {
      setVisibleCount(parsed.rows.length);
      return;
    }
    if (visibleCount >= parsed.rows.length) return;
    const raf = window.requestAnimationFrame(() => {
      setVisibleCount((current) => {
        if (current >= parsed.rows.length) return parsed.rows.length;
        const remaining = parsed.rows.length - current;
        const step = Math.max(2, Math.min(9, Math.ceil(remaining * 0.14)));
        return Math.min(parsed.rows.length, current + step);
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [animateReveal, parsed.rows.length, visibleCount]);

  const clampedCount = animateReveal
    ? Math.max(1, Math.min(visibleCount, parsed.rows.length))
    : parsed.rows.length;
  const revealing = animateReveal && clampedCount < parsed.rows.length;
  const visibleRows = revealing
    ? parsed.rows.slice(0, clampedCount)
    : parsed.rows;

  useEffect(() => {
    const cb = onRevealStateChangeRef.current;
    if (!cb) return;
    if (!revealing) {
      cb({
        revealing: false,
        additions: parsed.additions,
        deletions: parsed.deletions,
      });
      return;
    }
    let add = 0;
    let del = 0;
    for (const row of visibleRows) {
      if (row.kind === "addition") add += 1;
      else if (row.kind === "deletion") del += 1;
    }
    cb({
      revealing: true,
      additions: add,
      deletions: del,
    });
  }, [parsed.additions, parsed.deletions, revealing, visibleRows]);

  useLayoutEffect(() => {
    if (!revealing) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [clampedCount, revealing]);

  return (
    <div className={`agent-diff-viewer ${hideHeader ? "is-headerless" : ""}`}>
      {!hideHeader && (
        <div className="agent-diff-header">
          <Icon icon={FileDiffIcon} size={14} />
          <span className="min-w-0 flex-1 truncate">
            {parsed.path || "File changes"}
          </span>
          {preview && <span className="agent-diff-preview-label">Preview</span>}
          {parsed.additions > 0 && (
            <span className="agent-diff-additions">+{parsed.additions}</span>
          )}
          {parsed.deletions > 0 && (
            <span className="agent-diff-deletions">-{parsed.deletions}</span>
          )}
        </div>
      )}
      <div className="agent-diff-lines" ref={scrollerRef}>
        <div className="agent-diff-lines-inner">
          {visibleRows.map((row, index) => (
            <div
              className={`agent-diff-line is-${row.kind}`}
              key={`${index}-${row.kind}-${row.text.slice(0, 24)}`}
            >
              <span className="agent-diff-line-no">
                {row.newLine ?? row.oldLine ?? ""}
              </span>
              <span className="agent-diff-prefix">
                {row.kind === "addition"
                  ? "+"
                  : row.kind === "deletion"
                    ? "-"
                    : " "}
              </span>
              <code>{row.text}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
