/**
 * Gray inline type hints from vtsls.
 */

import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { LspInlayHint } from "../../lsp/LspSessionManager";
import { lspDocumentLanguageId } from "../../lsp/pathUri";

export type LspInlayHintsFn = (
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number },
) => Promise<LspInlayHint[]>;

class InlayHintWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly padLeft: boolean,
    readonly padRight: boolean,
  ) {
    super();
  }
  eq(other: InlayHintWidget) {
    return other.text === this.text && other.padLeft === this.padLeft && other.padRight === this.padRight;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-inlay-hint";
    el.textContent = `${this.padLeft ? "\u00a0" : ""}${this.text}${this.padRight ? "\u00a0" : ""}`;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function decoForHints(view: EditorView, hints: LspInlayHint[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const seen = new Set<number>();
  const sorted = [...hints].sort((a, b) => a.line - b.line || a.column - b.column);
  for (const hint of sorted) {
    const lineNo = Math.max(1, Math.min(view.state.doc.lines, hint.line));
    const line = view.state.doc.line(lineNo);
    const pos = Math.max(line.from, Math.min(line.to, line.from + Math.max(0, hint.column - 1)));
    if (seen.has(pos)) continue;
    seen.add(pos);
    builder.add(
      pos,
      pos,
      Decoration.widget({
        widget: new InlayHintWidget(hint.label, hint.paddingLeft, hint.paddingRight),
        side: 1,
      }),
    );
  }
  return builder.finish();
}

export function lspInlayHintsExtension(
  getPath: () => string,
  fetchHints: LspInlayHintsFn,
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private timer = 0;
      private seq = 0;

      constructor(readonly view: EditorView) {
        this.schedule(40);
      }

      update(update: { docChanged: boolean; viewportChanged: boolean }) {
        if (update.docChanged || update.viewportChanged) this.schedule(update.docChanged ? 280 : 160);
      }

      destroy() {
        if (this.timer) window.clearTimeout(this.timer);
      }

      private schedule(delay: number) {
        if (this.timer) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = 0;
          void this.refresh();
        }, delay);
      }

      private async refresh() {
        const path = getPath();
        if (!lspDocumentLanguageId(path)) {
          this.decorations = Decoration.none;
          this.view.dispatch({ effects: [] });
          return;
        }
        const { from, to } = this.view.viewport;
        const start = this.view.state.doc.lineAt(from);
        const end = this.view.state.doc.lineAt(to);
        const seq = ++this.seq;
        const hints = await fetchHints({
          startLine: start.number,
          startColumn: 1,
          endLine: end.number,
          endColumn: end.length + 1,
        });
        if (seq !== this.seq) return;
        this.decorations = decoForHints(this.view, hints);
        this.view.dispatch({ effects: [] });
      }
    },
    { decorations: (value) => value.decorations },
  );
}
