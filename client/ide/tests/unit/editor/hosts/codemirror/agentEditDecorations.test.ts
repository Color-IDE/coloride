import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { addedLineChangeKind, agentEditField, applyAgentEditMarks, acceptAgentEditHunk, computeAgentEditHunks, rejectAllAgentEditHunks } from "../../../../../src/features/editor/hosts/codemirror/agentEditDecorations.ts";

function editor(text: string) {
  const view = {
    state: EditorState.create({ doc: text, extensions: [agentEditField] }),
    dispatch(spec: Parameters<EditorState["update"]>[0]) { this.state = this.state.update(spec).state; },
  };
  return view as unknown as EditorView;
}

test("Keep a block then Undo remaining preserves the kept block", () => {
  const before = "old one\na\nb\nc\nd\nold two";
  const after = "new one\na\nb\nc\nd\nnew two";
  const view = editor(after);
  applyAgentEditMarks(view, before, after);
  const hunks = view.state.field(agentEditField).hunks;
  assert.equal(hunks.length, 2);
  const accepted = acceptAgentEditHunk(view, hunks[0]!.id);
  assert.equal(accepted.baseline, "new one\na\nb\nc\nd\nold two");
  const undone = rejectAllAgentEditHunks(view);
  assert.equal(undone.content, accepted.baseline);
});

test("Undo supports an originally empty file", () => {
  const view = editor("new content");
  applyAgentEditMarks(view, "", "new content");
  assert.equal(rejectAllAgentEditHunks(view).content, "");
});

test("a deleted line beside a new block is not an in-place edit", () => {
  const hunks = computeAgentEditHunks(
    "cout << old;\n",
    "if (bestMatch == '?') {\n  cout << unknown;\n} else {\n  cout << found;\n}\n",
  );
  assert.equal(hunks.length, 1);
  assert.equal(addedLineChangeKind(hunks[0]!), "add");
});

test("one replaced line stays a modification", () => {
  const hunks = computeAgentEditHunks("const int ROWS = 5;\n", "const int ROWS = 8;\n");
  assert.equal(hunks.length, 1);
  assert.equal(addedLineChangeKind(hunks[0]!), "mod");
});

test("clearing a new line next to a deletion stays green", () => {
  const hunks = computeAgentEditHunks(
    "char recognizeCharacter(const std::vector<int>& img);\n",
    "\n",
  );
  assert.equal(hunks.length, 1);
  assert.equal(addedLineChangeKind(hunks[0]!), "add");
});

test("agent review paints a change bar on every added line", () => {
  const view = editor("alpha\nbeta");
  applyAgentEditMarks(view, "", "alpha\nbeta");
  const bars = view.state.field(agentEditField).gutter;
  assert.equal(bars.size, 2);
});

test("ordinary typing does not create an agent review", () => {
  const view = editor("");
  view.dispatch({ changes: { from: 0, insert: "hello" } });
  assert.equal(view.state.field(agentEditField).hunks.length, 0);
});

test("accepted blocks stay accepted after rebuilding review decorations", () => {
  const before = "old one\na\nb\nc\nd\nold two";
  const after = "new one\na\nb\nc\nd\nnew two";
  const view = editor(after);
  applyAgentEditMarks(view, before, after);
  const result = acceptAgentEditHunk(view, view.state.field(agentEditField).hunks[0]!.id);
  const restored = editor(result.content);
  applyAgentEditMarks(restored, result.baseline, result.content);
  assert.equal(restored.state.field(agentEditField).hunks.length, 1);
  assert.equal(rejectAllAgentEditHunks(restored).content, "new one\na\nb\nc\nd\nold two");
});

test("typing during review keeps the left number and fold marks", () => {
  const view = editor("const int MIN_CONFIDENCE = 18;\n");
  applyAgentEditMarks(view, "const int MIN_CONFIDENCE = 10;\n", view.state.doc.toString());
  view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" } });
  const field = view.state.field(agentEditField);
  assert.ok(field.hunks.length > 0);
  assert.ok(field.gutter.size > 0);
  assert.ok(field.fold.size > 0);
});

test("user edits keep the pre-AI baseline and replacements are green", () => {
  const view = editor("from typing import Any, cast");
  applyAgentEditMarks(view, "from typing import Any", view.state.doc.toString());
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "from typing import Any, Optional" } });
  const field = view.state.field(agentEditField);
  assert.equal(field.baseline, "from typing import Any");
  assert.equal(field.hunks[0]!.dels[0]!.text, "from typing import Any");
  const classes: string[] = [];
  field.deco.between(0, view.state.doc.length, (_from, _to, deco) => {
    if (deco.spec.class) classes.push(deco.spec.class);
  });
  assert.deepEqual(classes, ["cm-agent-line-add"]);
  assert.equal(rejectAllAgentEditHunks(view).content, "from typing import Any");
});

test("typing the original content removes all review decorations", () => {
  const view = editor("new");
  applyAgentEditMarks(view, "old", "new");
  view.dispatch({ changes: { from: 0, to: 3, insert: "old" } });
  const field = view.state.field(agentEditField);
  assert.equal(field.hunks.length, 0);
  assert.equal(field.deco.size, 0);
  assert.equal(field.gutter.size, 0);
});

test("rejecting an earlier block shifts the later block correctly", async () => {
  const { rejectAgentEditHunk } = await import("../../../../../src/features/editor/hosts/codemirror/agentEditDecorations.ts");
  const before = "a\nb\nc\nd\ne\nf";
  const after = "a\ninserted\nb\nc\nd\ne\nchanged";
  const view = editor(after);
  applyAgentEditMarks(view, before, after);
  const hunks = view.state.field(agentEditField).hunks;
  assert.equal(hunks[0]!.startLine, 2);
  assert.equal(hunks[1]!.startLine, 7);
  rejectAgentEditHunk(view, hunks[0]!.id);
  assert.equal(view.state.field(agentEditField).hunks[0]!.startLine, 6);
  assert.equal(rejectAllAgentEditHunks(view).content, before);
});

test("a one-line edit in a large file preserves the original on Undo", () => {
  const before = Array.from({length: 750}, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 350", "changed 350");
  const view = editor(after);
  applyAgentEditMarks(view, before, after);
  assert.equal(view.state.field(agentEditField).hunks[0]!.startLine, 351);
  assert.equal(rejectAllAgentEditHunks(view).content, before);
});

test("large complete replacements retain deleted content for Undo", () => {
  const before = Array.from({length: 700}, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({length: 700}, (_, i) => `new ${i}`).join("\n");
  const view = editor(after);
  applyAgentEditMarks(view, before, after);
  assert.equal(rejectAllAgentEditHunks(view).content, before);
});
