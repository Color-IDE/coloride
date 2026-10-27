/**
 * Indent guides: one vertical line per complete tab-width, merged across
 * consecutive lines so a block reads as a single solid rule.
 */

import { foldState } from "@codemirror/language";
import { indentGuideColumns } from "./indentGuideColumns";
import type { Text, Extension } from "@codemirror/state";
import { EditorView, RectangleMarker, layer, type ViewUpdate } from "@codemirror/view";

function layerBase(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

const columnsCache = new WeakMap<Text, { tabSize: number; columns: number[][] }>();

function guideColumns(doc: Text, tabSize: number): number[][] {
  const cached = columnsCache.get(doc);
  if (cached?.tabSize === tabSize) return cached.columns;
  const columns = indentGuideColumns(doc.toString().split("\n"), tabSize);
  columnsCache.set(doc, { tabSize, columns });
  return columns;
}

export function scopeGuides(): Extension {
  return layer({
    above: false,
    class: "cm-scopeGuideLayer",
    update(update: ViewUpdate) {
      return (
        update.docChanged
        || update.viewportChanged
        || update.geometryChanged
        || update.selectionSet
        || update.startState.field(foldState, false) !== update.state.field(foldState, false)
      );
    },
    markers(view) {
      const tabSize = view.state.tabSize;
      const charW = view.defaultCharacterWidth;
      if (tabSize < 1 || charW < 1) return [];

      const base = layerBase(view);
      const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
      const columns = guideColumns(view.state.doc, tabSize);
      const activeCol = columns[cursorLine - 1]?.at(-1) ?? -1;
      const cursorCoords = view.coordsAtPos(view.state.doc.line(cursorLine).from);
      const cursorY = cursorCoords ? (cursorCoords.top + cursorCoords.bottom) / 2 - base.top : -Infinity;

      type Run = { col: number; left: number; top: number; bottom: number; active: boolean };
      const open = new Map<number, Run>();
      const done: Run[] = [];

      const flushUnused = (keep: Set<number>) => {
        for (const [col, run] of open) {
          if (keep.has(col)) continue;
          done.push(run);
          open.delete(col);
        }
      };

      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          const block = view.lineBlockAt(line.from);
          // Folded body shares the opener's line block — don't paint guides through it.
          if (block.from !== line.from) {
            pos = line.to + 1;
            continue;
          }
          const lineColumns = columns[line.number - 1] ?? [];
          const start = view.coordsAtPos(line.from, 1) ?? view.coordsAtPos(line.from, -1);
          const keep = new Set<number>();

          if (start && lineColumns.length) {
            const top = start.top - base.top;
            const height = Math.max(
              start.bottom - start.top,
              block.height <= view.defaultLineHeight * 1.45 ? block.height : view.defaultLineHeight,
            );
            const bottom = top + height;
            const lineLeft = start.left - base.left;

            for (const col of lineColumns) {
              keep.add(col);
              // Inset column 0 so the rule isn't clipped by the content edge.
              const left = lineLeft + col * charW + (col === 0 ? 1 : 0);
              const run = open.get(col);
              if (run && Math.abs(run.left - left) < 1 && top <= run.bottom + 2) {
                run.bottom = Math.max(run.bottom, bottom);
                run.active = run.active || (col === activeCol && cursorY >= top && cursorY < bottom);
              } else {
                if (run) done.push(run);
                open.set(col, { col, left, top, bottom, active: col === activeCol && cursorY >= top && cursorY < bottom });
              }
            }
          }

          flushUnused(keep);
          pos = line.to + 1;
        }
      }
      for (const run of open.values()) done.push(run);

      return done.map(
        (run) =>
          new RectangleMarker(
            run.active ? "cm-scopeGuide cm-scopeGuide-active" : "cm-scopeGuide",
            run.left,
            run.top,
            1,
            Math.max(1, run.bottom - run.top),
          ),
      );
    },
  });
}
