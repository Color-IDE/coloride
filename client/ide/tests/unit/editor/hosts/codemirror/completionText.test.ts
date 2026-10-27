import assert from "node:assert/strict";
import { test } from "node:test";
import { completionLabel, completionOffset, hasSnippetPlaceholders } from "../../../../../src/features/editor/hosts/codemirror/completionText.ts";
import { EditorState } from "@codemirror/state";

test("clangd display indicators never become fallback identifiers", () => {
  assert.equal(completionLabel("•endl"), "endl");
  assert.equal(completionLabel("◦ std::endl"), "std::endl");
  assert.equal(completionLabel("std::endl"), "std::endl");
});

test("plain text in snippet format is usable without falling back to the label", () => {
  assert.equal(hasSnippetPlaceholders("endl"), false);
  assert.equal(hasSnippetPlaceholders("std::endl"), false);
  assert.equal(hasSnippetPlaceholders("func(${1:value})$0"), true);
  assert.equal(hasSnippetPlaceholders("${TM_FILENAME}"), true);
});

test("cached completion replaces the entire growing or shrinking identifier", () => {
  for (const typed of ["endl", "end", "en", "e"]) {
    const state = EditorState.create({ doc: `cout << ${typed};` });
    // Server answered for `end`; user may have typed or deleted before Enter.
    const from = completionOffset(8, 8, 11, 8, 8 + typed.length);
    const to = completionOffset(11, 8, 11, 8, 8 + typed.length);
    assert.equal(state.update({ changes: { from, to, insert: "endl" } }).state.doc.toString(), "cout << endl;");
  }
});

test("replacement suffixes and additional edits retain their relative positions", () => {
  assert.equal(completionOffset(15, 8, 11, 8, 12), 16);
  assert.equal(completionOffset(0, 8, 11, 8, 12), 0);
  assert.equal(completionOffset(8, 8, 11, 10, 14), 10);
});
