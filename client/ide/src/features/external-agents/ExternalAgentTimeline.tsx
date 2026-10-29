import { useLayoutEffect, useRef } from "react";
import type { ExternalTranscriptItem } from "./externalAgentReducer";

function toolDetails(content: unknown): string {
  if (!Array.isArray(content))
    return content == null
      ? ""
      : typeof content === "string"
        ? content
        : JSON.stringify(content, null, 2);
  return content
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

export function ExternalAgentTimeline({
  items,
  name = "External agent",
  ready = false,
}: {
  items: ExternalTranscriptItem[];
  name?: string;
  ready?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [items]);
  if (!items.length) {
    return (
      <p className="min-h-0 flex-1 px-4 py-6 text-sm text-[var(--agent-muted)]">
        {ready ? `${name} is ready in this project.` : `Connecting to ${name}…`}
      </p>
    );
  }
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
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4"
    >
      {items.map((item) => {
        if (item.kind === "tool") {
          return (
            <article
              className="rounded-control border border-[var(--agent-border,#333)] px-3 py-2 text-sm"
              key={item.id}
            >
              <header className="flex justify-between gap-3">
                <span>{item.title}</span>
                <span className="text-xs uppercase text-[#8d8d8d]">
                  {item.status}
                </span>
              </header>
              {item.content != null ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--agent-muted)]">
                    Details
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {toolDetails(item.content)}
                  </pre>
                </details>
              ) : null}
            </article>
          );
        }
        if (item.kind === "plan") {
          return (
            <ol
              className="rounded-control border border-[var(--agent-border,#333)] px-3 py-2 text-sm"
              key={item.id}
            >
              {item.entries.map((entry) => (
                <li key={entry.content}>
                  {entry.status}: {entry.content}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <article className="text-sm text-[var(--agent-text)]" key={item.id}>
            {item.kind === "thought" ? (
              <span className="mb-1 block text-xs uppercase text-[#8d8d8d]">
                Thinking
              </span>
            ) : null}
            <p className="whitespace-pre-wrap">{item.text}</p>
          </article>
        );
      })}
    </div>
  );
}
