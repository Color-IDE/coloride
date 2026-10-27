import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as any).window = {};
const { AgentCheckpointDock } = await import("../../../src/features/agents/AgentTimeline");

for (const variant of ["full", "sidebar"] as const) {
  for (const state of ["idle", "running", "restoring"] as const) {
    test(`${variant}: Keep and Undo are ${state === "idle" ? "enabled" : "disabled"} when ${state}`, () => {
      const html = renderToStaticMarkup(createElement(AgentCheckpointDock, {
        checkpoints: [{ id: "checkpoint_test", sessionId: "session", callId: "call", cwd: "/project", createdAt: "", tool: "write_file", paths: [{ path: "/project/a.ts", kind: "file" }] }],
        onKeepAll() {}, onUndoAll() {}, onReview() {},
        restoring: state === "restoring", turnActive: state === "running", reviewOpen: false, variant,
      }));
      const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
        .filter(match => /Keep [aA]ll|Undo/.test(match[2]!));
      assert.equal(buttons.length, 2);
      for (const button of buttons) assert.equal(button[1]!.includes('disabled=""'), state !== "idle");
    });
  }
}
