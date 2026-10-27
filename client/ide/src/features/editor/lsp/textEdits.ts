/** 1-based line/column edits on a full document string. */

export type LineTextEdit = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  newText: string;
};

export function offsetAtString(text: string, line1: number, col1: number): number {
  let line = 1;
  let i = 0;
  while (i < text.length && line < line1) {
    if (text.charCodeAt(i) === 10) line += 1;
    i += 1;
  }
  const col = Math.max(1, col1);
  return Math.min(text.length, i + col - 1);
}

export function applyLineEdits(text: string, edits: LineTextEdit[]): string {
  const mapped = edits
    .map((edit) => ({
      from: offsetAtString(text, edit.startLine, edit.startColumn),
      to: offsetAtString(text, edit.endLine, edit.endColumn),
      insert: edit.newText,
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let next = text;
  for (const edit of mapped) {
    const from = Math.max(0, Math.min(edit.from, next.length));
    const to = Math.max(from, Math.min(edit.to, next.length));
    next = next.slice(0, from) + edit.insert + next.slice(to);
  }
  return next;
}
