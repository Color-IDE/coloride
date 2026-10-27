/**
 * Shift+Alt+F — format document / selection via vtsls.
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorShortcut } from "./shortcutBinding";
import type { LineTextEdit } from "../../lsp/textEdits";
import { lspDocumentLanguageId } from "../../lsp/pathUri";

export type LspFormatFn = (options: {
  tabSize: number;
  insertSpaces: boolean;
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}) => Promise<LineTextEdit[]>;

function posAt(doc: { line: (n: number) => { from: number; to: number } }, line1: number, col1: number): number {
  const line = doc.line(Math.max(1, line1));
  return Math.min(line.to, line.from + Math.max(1, col1) - 1);
}

function applyFormat(view: EditorView, edits: LineTextEdit[]) {
  if (!edits.length) return;
  const changes = edits
    .map((edit) => ({
      from: posAt(view.state.doc, edit.startLine, edit.startColumn),
      to: posAt(view.state.doc, edit.endLine, edit.endColumn),
      insert: edit.newText,
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  view.dispatch({ changes, userEvent: "input.format" });
}

export function lspFormatExtension(
  getPath: () => string,
  getOptions: () => { tabSize: number; insertSpaces: boolean },
  format: LspFormatFn,
  organize?: () => Promise<LineTextEdit[]>,
): Extension {
  const run = (view: EditorView) => {
    const path = getPath();
    if (!lspDocumentLanguageId(path) || view.state.readOnly) return false;
    const sel = view.state.selection.main;
    const opts = getOptions();
    const payload: Parameters<LspFormatFn>[0] = {
      tabSize: opts.tabSize,
      insertSpaces: opts.insertSpaces,
    };
    if (!sel.empty) {
      const fromLine = view.state.doc.lineAt(sel.from);
      const toLine = view.state.doc.lineAt(sel.to);
      payload.range = {
        startLine: fromLine.number,
        startColumn: sel.from - fromLine.from + 1,
        endLine: toLine.number,
        endColumn: sel.to - toLine.from + 1,
      };
    }
    void format(payload).then((edits) => applyFormat(view, edits));
    return true;
  };

  const runOrganize = (view: EditorView) => {
    const path = getPath();
    if (!organize || !lspDocumentLanguageId(path) || view.state.readOnly) return false;
    void organize().then((edits) => applyFormat(view, edits));
    return true;
  };

  return Prec.high(
    keymap.of([
      editorShortcut("editor.format", run),
      editorShortcut("editor.organize-imports", runOrganize),
    ]),
  );
}
