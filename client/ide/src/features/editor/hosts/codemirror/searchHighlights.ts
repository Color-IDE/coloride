import { getSearchQuery } from "@codemirror/search";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const matchMark = Decoration.mark({ class: "cm-searchMatch" });
const selectedMatchMark = Decoration.mark({
  class: "cm-searchMatch cm-searchMatch-selected",
});

/**
 * Highlight every search match while a query is active.
 *
 * CodeMirror’s built-in highlighter only runs when its search *panel* is open
 * (`if (!panel) return none`). We use a custom React find bar, so we paint
 * matches ourselves from `getSearchQuery`.
 */
export const searchMatchHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMatchDecorations(view);
    }

    update(update: ViewUpdate) {
      const prev = getSearchQuery(update.startState);
      const next = getSearchQuery(update.state);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        !prev.eq(next)
      ) {
        this.decorations = buildMatchDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

function buildMatchDecorations(view: EditorView): DecorationSet {
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection.ranges;

  for (let i = 0; i < view.visibleRanges.length; i += 1) {
    let { from, to } = view.visibleRanges[i]!;
    // Merge nearby visible ranges (same idea as CM’s highlighter).
    while (
      i < view.visibleRanges.length - 1 &&
      to > view.visibleRanges[i + 1]!.from - 500
    ) {
      i += 1;
      to = view.visibleRanges[i]!.to;
    }

    const cursor = query.getCursor(view.state, from, to);
    for (;;) {
      const step = cursor.next();
      if (step.done) break;
      const match = step.value;
      const selected = selection.some((r) => r.from === match.from && r.to === match.to);
      builder.add(match.from, match.to, selected ? selectedMatchMark : matchMark);
    }
  }

  return builder.finish();
}
