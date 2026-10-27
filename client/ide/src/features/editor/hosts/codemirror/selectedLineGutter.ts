import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

/** Marks gutter cells on lines touched by the selection. */
const selectedGutterMarker = new (class extends GutterMarker {
  elementClass = "coloride-selected-line-gutter";
})();

/**
 * Line-number highlight for selected lines (brighter / white digits).
 */
export function highlightSelectedLineGutter(): Extension {
  return gutterLineClass.compute(["selection"], (state) => {
    const builder = new RangeSetBuilder<GutterMarker>();
    const seen = new Set<number>();

    for (const range of state.selection.ranges) {
      const fromLine = state.doc.lineAt(range.from).number;
      // Empty ranges: only the caret line. Non-empty: cover every line in range.
      const toPos = range.empty ? range.from : Math.max(range.from, range.to - 1);
      const toLine = state.doc.lineAt(toPos).number;

      for (let n = fromLine; n <= toLine; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        builder.add(state.doc.line(n).from, state.doc.line(n).from, selectedGutterMarker);
      }
    }

    return builder.finish();
  });
}
