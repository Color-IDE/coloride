import type { ExternalTranscriptItem } from "./externalAgentReducer";

export function ExternalAgentTimeline({ items }: { items: ExternalTranscriptItem[] }) {
  if (!items.length) {
    return <p className="px-4 py-6 text-sm text-[#8d8d8d]">Codex is ready in this project.</p>;
  }
  return (
    <div aria-label="Codex conversation" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
      {items.map((item) => {
        if (item.kind === "tool") {
          return (
            <article className="rounded-control border border-[var(--agent-border,#333)] px-3 py-2 text-sm" key={item.id}>
              <header className="flex justify-between gap-3">
                <span>{item.title}</span>
                <span className="text-xs uppercase text-[#8d8d8d]">{item.status}</span>
              </header>
            </article>
          );
        }
        if (item.kind === "plan") {
          return (
            <ol className="rounded-control border border-[var(--agent-border,#333)] px-3 py-2 text-sm" key={item.id}>
              {item.entries.map((entry) => (
                <li key={entry.content}>{entry.status}: {entry.content}</li>
              ))}
            </ol>
          );
        }
        return (
          <article className={item.kind === "user" ? "text-sm" : "text-sm text-[#d7d7d7]"} key={item.id}>
            {item.kind === "thought" ? <span className="mb-1 block text-xs uppercase text-[#8d8d8d]">Thinking</span> : null}
            <p className="whitespace-pre-wrap">{item.text}</p>
          </article>
        );
      })}
    </div>
  );
}
