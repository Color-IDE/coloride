import { useEffect, useMemo, useRef, useState } from "react";
import { argumentLabel, formatArgument } from "./formatting";
import { type TermSegment, type ToolTimelineEntry } from "./types";

/** Shared edge-fade + max-height scroll shell for long command / output blocks. */
export function useScrollFadeEdges(deps: unknown[]) {
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false });

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const update = () => {
      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
      if (maxScroll <= 1) {
        setFadeEdges({ top: false, bottom: false });
        return;
      }
      setFadeEdges({
        top: node.scrollTop > 2,
        bottom: node.scrollTop < maxScroll - 2,
      });
    };

    update();
    // Content paint can lag one frame after mount / expand.
    const raf = requestAnimationFrame(update);
    node.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes content deps
  }, deps);

  return { scrollRef, fadeEdges };
}

export function CommandSourceBlock({ command }: { command: string }) {
  const { scrollRef, fadeEdges } = useScrollFadeEdges([command]);
  const fadeClass = [
    "agent-command-source-fade",
    fadeEdges.top ? "has-fade-top" : "",
    fadeEdges.bottom ? "has-fade-bottom" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fadeClass}>
      <pre
        ref={scrollRef}
        className="agent-command-source agent-terminal-source"
      >
        <code>
          <span className="agent-term-prompt">$ </span>
          <TerminalHighlighted text={command} mode="command" />
        </code>
      </pre>
    </div>
  );
}

export function CommandOutput({ entry }: { entry: ToolTimelineEntry }) {
  const emptyMessage = entry.failed ? "Command failed without output."
    : entry.complete ? "Command finished without output." : "Waiting for command output…";
  const output = entry.output.trim() ? entry.output : emptyMessage;
  const { scrollRef, fadeEdges } = useScrollFadeEdges([output]);

  const fadeClass = [
    "agent-command-output-fade",
    fadeEdges.top ? "has-fade-top" : "",
    fadeEdges.bottom ? "has-fade-bottom" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fadeClass}>
      <pre
        ref={scrollRef}
        className="agent-event-output agent-tool-output agent-terminal-output whitespace-pre-wrap"
      >
        <TerminalHighlighted text={output} mode="output" />
      </pre>
    </div>
  );
}

export function TerminalHighlighted({
  text,
  mode,
}: {
  text: string;
  mode: "command" | "output";
}) {
  const segments = useMemo(
    () =>
      mode === "command"
        ? highlightShellCommand(text)
        : highlightTerminalOutput(text),
    [mode, text],
  );
  return (
    <>
      {segments.map((segment, index) =>
        segment.tone ? (
          <span
            className={`agent-term-${segment.tone}`}
            key={`${index}-${segment.tone}-${segment.text.slice(0, 12)}`}
          >
            {segment.text}
          </span>
        ) : (
          <span key={`${index}-${segment.text.slice(0, 12)}`}>
            {segment.text}
          </span>
        ),
      )}
    </>
  );
}

export function highlightShellCommand(command: string): TermSegment[] {
  const segments: TermSegment[] = [];
  const pattern =
    /(\s+)|(\\|&&|\|\||[|;<>&])|(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-{1,2}[A-Za-z0-9][\w-]*(?:=[^\s"']*)?)|(\.?\.?\/[^\s"']+|~\/[^\s"']+|\/[^\s"']+)|(\d+(?:\.\d+)?)|([^\s"']+)/g;
  let match: RegExpExecArray | null;
  let firstWord = true;
  while ((match = pattern.exec(command)) !== null) {
    const [raw, ws, op, comment, str, flag, path, num, word] = match;
    if (ws) {
      segments.push({ text: ws });
      continue;
    }
    if (op) {
      segments.push({ text: op, tone: "op" });
      firstWord = true;
      continue;
    }
    if (comment) {
      segments.push({ text: comment, tone: "comment" });
      continue;
    }
    if (str) {
      segments.push({ text: str, tone: "string" });
      firstWord = false;
      continue;
    }
    if (flag) {
      segments.push({ text: flag, tone: "flag" });
      firstWord = false;
      continue;
    }
    if (path) {
      segments.push({ text: path, tone: "path" });
      firstWord = false;
      continue;
    }
    if (num) {
      segments.push({ text: num, tone: "number" });
      firstWord = false;
      continue;
    }
    if (word) {
      if (word.includes("=") && !word.startsWith("-")) {
        const eq = word.indexOf("=");
        segments.push({ text: word.slice(0, eq), tone: "flag" });
        segments.push({ text: "=", tone: "op" });
        segments.push({ text: word.slice(eq + 1), tone: "string" });
      } else {
        segments.push({ text: word, tone: firstWord ? "cmd" : undefined });
      }
      firstWord = false;
      continue;
    }
    segments.push({ text: raw });
  }
  return segments.length ? segments : [{ text: command }];
}

export function highlightTerminalOutput(output: string): TermSegment[] {
  const lines = output.split("\n");
  const segments: TermSegment[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) segments.push({ text: "\n" });
    if (!line) return;

    const lower = line.toLowerCase();
    if (
      /error|failed|exception|traceback|fatal|errno|not found|denied|cannot|couldn't|unable/i.test(
        line,
      )
    ) {
      segments.push({ text: line, tone: "error" });
      return;
    }
    if (/warning|warn\b|deprecated/i.test(line)) {
      segments.push({ text: line, tone: "warn" });
      return;
    }
    if (
      /^(ok|success|done|passed|✓|✔|√)/i.test(line.trim()) ||
      /\b(success|passed|completed)\b/i.test(lower)
    ) {
      segments.push({ text: line, tone: "success" });
      return;
    }
    if (
      /^(info|hint|note):/i.test(line.trim()) ||
      /\b(listening on|serving|ready)\b/i.test(lower)
    ) {
      segments.push({ text: line, tone: "info" });
      return;
    }
    if (/^\s*(#|\/\/|--)/.test(line) || /^\s*>/.test(line)) {
      segments.push({ text: line, tone: "comment" });
      return;
    }

    // Inline token coloring for paths, strings, numbers, urls.
    const pattern =
      /(https?:\/\/[^\s]+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\.?\.?\/[^\s:"']+|~\/[^\s:"']+|\/(?:usr|home|var|tmp|opt|etc|Users|Users\/)[^\s:"']*)|(-?\d+(?:\.\d+)?)|(\s+)|([^\s]+)/g;
    let match: RegExpExecArray | null;
    let any = false;
    while ((match = pattern.exec(line)) !== null) {
      any = true;
      const [, url, str, path, num, ws, word] = match;
      if (ws) segments.push({ text: ws, tone: "dim" });
      else if (url) segments.push({ text: url, tone: "info" });
      else if (str) segments.push({ text: str, tone: "string" });
      else if (path) segments.push({ text: path, tone: "path" });
      else if (num) segments.push({ text: num, tone: "number" });
      else if (word) segments.push({ text: word, tone: "dim" });
    }
    if (!any) segments.push({ text: line, tone: "dim" });
  });
  return segments.length ? segments : [{ text: output, tone: "dim" }];
}

export function ListFilesOutput({
  expanded,
  output,
}: {
  expanded: boolean;
  output: string;
}) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false });

  const updateFadeEdges = () => {
    const element = scrollRef.current;
    if (!element) return;
    if (expanded) {
      const maxScroll = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
      if (maxScroll <= 2) {
        setFadeEdges({ top: false, bottom: false });
        return;
      }
      setFadeEdges({
        top: element.scrollTop > 2,
        bottom: maxScroll - element.scrollTop > 2,
      });
      return;
    }
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    setFadeEdges({
      top: element.scrollTop > 2,
      bottom: maxScroll - element.scrollTop > 2,
    });
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const frame = requestAnimationFrame(updateFadeEdges);
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "max-height") updateFadeEdges();
    };
    element.addEventListener("transitionend", onEnd);

    // Keep fades in sync while height animates.
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      updateFadeEdges();
      if (performance.now() - start < 320) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(raf);
      element.removeEventListener("transitionend", onEnd);
    };
  }, [expanded, output]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => updateFadeEdges());
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, output]);

  return (
    <div
      className={`agent-list-files-output ${expanded ? "is-expanded" : "is-collapsed"}`}
    >
      <pre
        className="agent-list-files-scroll"
        onScroll={updateFadeEdges}
        ref={scrollRef}
      >
        {output}
      </pre>
      <span
        aria-hidden="true"
        className={`scroll-edge-fade agent-list-files-fade pointer-events-none absolute left-0 right-0 top-0 z-10 h-4 transition-opacity duration-150 ${fadeEdges.top ? "opacity-100" : "opacity-0"}`}
        data-edge="top"
      />
      <span
        aria-hidden="true"
        className={`scroll-edge-fade agent-list-files-fade pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-4 transition-opacity duration-150 ${fadeEdges.bottom ? "opacity-100" : "opacity-0"}`}
        data-edge="bottom"
      />
    </div>
  );
}

export function ToolOutput({ output }: { output: string }) {
  return (
    <pre className="agent-event-output agent-tool-output whitespace-pre-wrap text-[11px] leading-5">
      {output}
    </pre>
  );
}

export function ArgumentDetails({
  arguments: values,
}: {
  arguments: Record<string, unknown>;
}) {
  const rows = Object.entries(values).filter(
    ([, value]) => typeof value !== "object" || value === null,
  );
  if (!rows.length) return null;
  return (
    <div className="agent-argument-list">
      {rows.map(([key, value]) => (
        <div className="agent-argument-row" key={key}>
          <span>{argumentLabel(key)}</span>
          <code>{formatArgument(value)}</code>
        </div>
      ))}
    </div>
  );
}
