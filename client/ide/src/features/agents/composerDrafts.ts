/**
 * In-memory composer drafts keyed by agent session.
 * Survives AgentView unmount (switching app tabs Explorer ↔ Agents)
 * and restores the right text when switching chat sessions in the sidebar.
 */

const NEW_TASK_KEY = "__new__";

const drafts = new Map<string, string>();

function keyFor(sessionId: string | null | undefined): string {
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  return id || NEW_TASK_KEY;
}

export function getComposerDraft(sessionId: string | null | undefined): string {
  return drafts.get(keyFor(sessionId)) ?? "";
}

export function setComposerDraft(sessionId: string | null | undefined, text: string): void {
  const key = keyFor(sessionId);
  const value = text; // keep whitespace so partial edits restore exactly
  if (!value) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, value);
}

export function clearComposerDraft(sessionId: string | null | undefined): void {
  drafts.delete(keyFor(sessionId));
}

export function composerDraftKeyFor(sessionId: string | null | undefined): string {
  return keyFor(sessionId);
}
