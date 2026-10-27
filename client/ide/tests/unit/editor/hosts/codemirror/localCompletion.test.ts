import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { cpp } from "@codemirror/lang-cpp";
import { localKeywordCompletion } from "../../../../../src/features/editor/hosts/codemirror/localCompletion.ts";

function complete(doc: string, readonly = false) {
  const state = EditorState.create({ doc, extensions: [cpp(), EditorState.readOnly.of(readonly)] });
  return localKeywordCompletion(new CompletionContext(state, doc.length, false), "cpp");
}
test("C++ suggests if and int from the first i without a language server", () => {
  const result = complete("i");
  assert.equal(result?.from, 0);
  assert.ok(result?.options.some((item) => item.label === "if"));
  assert.ok(result?.options.some((item) => item.label === "int"));
});
test("keyword fallback stays out of strings, comments, member access and readonly files", () => {
  for (const doc of ['"i', '// i', '/* i', 'object.i', 'std::i']) assert.equal(complete(doc), null, doc);
  assert.equal(complete('i', true), null);
});
