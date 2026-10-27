/** clangd prefixes display labels with include indicators, not source code. */
export function completionLabel(label: string): string {
  return label.replace(/^[•◦]\s*/, "");
}

/** Format 2 also covers plain identifiers; only actual placeholders need fallback. */
export function hasSnippetPlaceholders(text: string): boolean {
  return /\$(?:\d+|\{|[A-Za-z_])/.test(text);
}

/** Rebase server offsets when CodeMirror reuses a list as the prefix changes. */
export function completionOffset(
  offset: number, queryFrom: number, queryTo: number, from: number, to: number,
): number {
  if (offset >= queryTo) return to + offset - queryTo;
  if (offset <= queryFrom) return from + offset - queryFrom;
  return Math.min(from + offset - queryFrom, to);
}
