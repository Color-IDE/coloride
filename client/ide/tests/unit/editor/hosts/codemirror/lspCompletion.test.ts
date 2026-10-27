import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { applyItem } from "../../../../../src/features/editor/hosts/codemirror/lspCompletion";

for (const [language, prefix, symbol, extra] of [
  ["C++", "#include <iostream>\n", "endl", "#include <ostream>\n"],
  ["TypeScript", "", "useState", "import { useState } from 'react';\n"],
  ["Python", "", "Path", "from pathlib import Path\n"],
  ["Go", "package main\n", "Println", 'import "fmt"\n'],
]) {
  test(`${language}: accept replaces a growing prefix without adding imports`, () => {
    const typed = symbol.slice(0, -1);
    const query = EditorState.create({ doc: prefix + typed });
    let state = EditorState.create({ doc: prefix + symbol, selection: { anchor: prefix.length + symbol.length } });
    const view = {
      get state() { return state; },
      dispatch(spec: Parameters<EditorState["update"]>[0]) { state = state.update(spec).state; },
    } as unknown as EditorView;
    const line = query.doc.lineAt(query.doc.length);
    applyItem({
      label: language === "C++" ? "•endl" : symbol,
      insertTextFormat: 2,
      textEdit: {
        range: { start: { line: line.number - 1, character: 0 }, end: { line: line.number - 1, character: typed.length } },
        newText: symbol,
      },
      additionalTextEdits: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: extra,
      }],
    }, query.doc, prefix.length, query.doc.length)(view, { label: symbol }, prefix.length, state.doc.length);
    assert.equal(state.doc.toString(), prefix + symbol);
    assert.equal(state.selection.main.head, state.doc.length);
  });
}
