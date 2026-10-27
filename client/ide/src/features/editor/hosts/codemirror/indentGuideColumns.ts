/** One guide per complete tab-width of leading whitespace. */
export function indentGuideColumns(lines: readonly string[], tabSize: number): number[][] {
  const result: number[][] = lines.map(() => []);
  let previousLine = -1;
  const width = Math.max(1, tabSize);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    if (!text.trim()) continue;
    let indent = 0;
    for (const char of text) {
      if (char === ' ') indent++;
      else if (char === '\t') indent += width - indent % width;
      else break;
    }
    const columns: number[] = [];
    for (let col = 0; col + width <= indent; col += width) columns.push(col);
    result[i] = columns;

    // Only continue scopes shared by both sides of a blank gap. Otherwise a
    // finished nested block leaks its guides into the following outer block.
    if (previousLine >= 0) {
      const shared = result[previousLine]!.filter(col => columns.includes(col));
      for (let blank = previousLine + 1; blank < i; blank++) result[blank] = shared;
    }
    previousLine = i;
  }
  return result;
}
