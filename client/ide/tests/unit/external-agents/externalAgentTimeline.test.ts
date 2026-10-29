import assert from "node:assert/strict";
import test from "node:test";
import { filePatch, toAgentTimelineEntries, toAgentTimelineEntry } from "../../../src/features/external-agents/presentExternalTimeline";
import type { ExternalTranscriptItem } from "../../../src/features/external-agents/externalAgentReducer";

const edit: Extract<ExternalTranscriptItem, { kind: "tool" }> = {
  id: "edit", kind: "tool", toolCallId: "edit", toolKind: "edit", title: "Editing files", status: "completed",
  content: [
    { type: "diff", path: "index.html", oldText: null, newText: "<main>Hello</main>\n" },
    { type: "diff", path: "style.css", oldText: "keep\nold\nend\n", newText: "keep\nnew\nend\n" },
  ],
};
test("each edited file uses a native diff card and only changed lines count", () => {
  const entries = toAgentTimelineEntries(edit, false);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, "tool");
  if (entries[0]?.kind !== "tool" || entries[1]?.kind !== "tool") throw Error("Expected tools");
  assert.equal(entries[0].tool, "write_file");
  assert.equal(entries[0].arguments.path, "index.html");
  assert.match(entries[0].diff, /\+<main>Hello<\/main>/);
  assert.equal(entries[1].tool, "replace_in_file");
  assert.match(entries[1].diff, /@@ -2,1 \+2,1 @@\n-old\n\+new/);
  assert.doesNotMatch(entries[1].diff, /[-+]keep|[-+]end/);
  assert.equal(entries[1].output, "");
});
test("empty, unchanged and removed files produce valid diff ranges", () => {
  assert.equal(filePatch("a", "same", "same"), "--- a/a\n+++ b/a");
  assert.match(filePatch("a", "old\n", ""), /@@ -1,1 \+0,0 @@\n-old/);
  assert.match(filePatch("a", "", "new\n"), /@@ -0,0 \+1,1 @@\n\+new/);
});
test("guardian results keep their details in the compact review row", () => {
  const entry = toAgentTimelineEntry({ ...edit, toolCallId: "guardian_assessment:1", toolKind: "think", title: "Guardian Review", status: "failed", content: [{ type: "content", content: { type: "text", text: "Status: Denied\nRationale: Needs permission" } }] }, false);
  assert.equal(entry.kind, "tool");
  if (entry.kind !== "tool") throw Error("Expected tool");
  assert.equal(entry.tool, "guardian_review");
  assert.equal(entry.failed, true);
  assert.match(entry.output, /Needs permission/);
});

test("terminal chunks take precedence over exit-only metadata and terminal references", () => {
  const entry = toAgentTimelineEntry({ ...edit, toolKind: "execute", terminalOutput: "actual command output\n", rawOutput: { exit_code: 0 }, content: [{ type: "terminal", terminalId: "exec-1" }] }, false);
  assert.equal(entry.kind, "tool");
  if (entry.kind !== "tool") throw Error("Expected tool");
  assert.equal(entry.output, "actual command output\n");
});

test("interrupting a preview server is distinct from an execution failure", () => {
  const stopped = toAgentTimelineEntry({ ...edit, toolKind: "execute", status: "failed", terminalExit: { exitCode: 130 }, terminalOutput: "VITE ready\n" }, false);
  const failed = toAgentTimelineEntry({ ...edit, toolKind: "execute", status: "failed", terminalExit: { exitCode: 1 }, terminalOutput: "Error: listen EPERM\n" }, false);
  if (stopped.kind !== "tool" || failed.kind !== "tool") throw Error("Expected tools");
  assert.equal(stopped.failed, false);
  assert.equal(stopped.metadata.interrupted, true);
  assert.equal(stopped.metadata.exitCode, 130);
  assert.equal(failed.failed, true);
  assert.equal(failed.metadata.interrupted, false);
  assert.match(failed.output, /EPERM/);
});

test("MCP execution results use the native plugin row and preserve returned text", () => {
  const entry = toAgentTimelineEntry({ ...edit, toolKind: "execute", rawInput: { server: "cua_repl", tool: "js", arguments: { code: "preview" } }, rawOutput: { result: { content: [{ type: "text", text: "Browser ready" }, { type: "image", data: "binary-payload", mimeType: "image/png" }] } } }, false);
  if (entry.kind !== "tool") throw Error("Expected tool");
  assert.equal(entry.tool, "mcp__cua_repl__js");
  assert.equal(entry.output, "Browser ready\n\nImage returned by tool.");
  assert.doesNotMatch(entry.output, /binary-payload/);
  assert.deepEqual(entry.arguments, { code: "preview" });
});
