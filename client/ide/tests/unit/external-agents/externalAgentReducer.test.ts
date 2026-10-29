import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalAgentEvent } from "@coloride/contracts";
import {
  hydrateExternalAgentEvents,
  reduceExternalAgentUpdate,
  emptyExternalAgentState,
} from "../../../src/features/external-agents/externalAgentReducer";

test("tool updates merge by toolCallId and the turn ends on the ACP response", () => {
  let state = emptyExternalAgentState();
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Edit file",
    status: "pending",
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Done" },
  });
  assert.equal(state.items.filter((item) => item.kind === "tool").length, 1);
  assert.equal(state.turnActive, true);
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "turn_complete",
    stopReason: "end_turn",
  });
  assert.equal(state.turnActive, false);
});

test("replay ignores events at or below the stored sequence", () => {
  const events: ExternalAgentEvent[] = [
    {
      sessionId: "s",
      sequence: 1,
      createdAt: "",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Hi" },
      },
    },
    {
      sessionId: "s",
      sequence: 1,
      createdAt: "",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Again" },
      },
    },
  ];
  const state = hydrateExternalAgentEvents(events);
  assert.equal(state.items.length, 1);
  assert.equal(
    state.items[0]?.kind === "user" ? state.items[0].text : "",
    "Hi",
  );
});

test("resolved permissions disappear immediately and a closed execution stops the composer", () => {
  let state = emptyExternalAgentState();
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "Run" },
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "permission_request",
    requestId: "one",
    sessionId: "s",
    options: [],
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "permission_request",
    requestId: "two",
    sessionId: "s",
    options: [],
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "permission_resolved",
    requestId: "one",
  });
  assert.deepEqual(
    state.permissions.map((permission) => permission.requestId),
    ["two"],
  );
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "execution_closed",
  });
  assert.equal(state.turnActive, false);
  assert.equal(state.permissions.length, 0);
});

test("tool status updates retain original command arguments and captured output", () => {
  let state = reduceExternalAgentUpdate(emptyExternalAgentState(), {
    sessionUpdate: "tool_call", toolCallId: "command", kind: "execute",
    title: "pwd && ls", rawInput: { command: "pwd && ls", cwd: "/project" },
    content: [{ type: "terminal", terminalId: "exec-1" }],
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "tool_call_update", toolCallId: "command", title: "Ran command pwd",
    status: "completed", rawOutput: { stdout: "/project", exit_code: 0 },
  });
  state = reduceExternalAgentUpdate(state, {
    sessionUpdate: "tool_call_update", toolCallId: "command", status: "completed",
  });
  const tool = state.items[0];
  assert.equal(tool.kind, "tool");
  if (tool.kind !== "tool") throw new Error("Expected tool");
  assert.deepEqual(tool.rawInput, { command: "pwd && ls", cwd: "/project" });
  assert.deepEqual(tool.rawOutput, { stdout: "/project", exit_code: 0 });
});

test("streamed terminal chunks survive status updates and replay without duplicates", () => {
  const events: ExternalAgentEvent[] = [
    { sessionId: "s", sequence: 1, createdAt: "", update: { sessionUpdate: "tool_call", toolCallId: "exec-1", kind: "execute", title: "pwd", status: "in_progress" } },
    { sessionId: "s", sequence: 2, createdAt: "", update: { sessionUpdate: "tool_call_update", toolCallId: "exec-1", _meta: { terminal_output_delta: { terminal_id: "exec-1", data: "/project\n" } } } },
    { sessionId: "s", sequence: 3, createdAt: "", update: { sessionUpdate: "tool_call_update", toolCallId: "exec-1", _meta: { terminal_output: { terminal_id: "exec-1", data: "café ✓\n" } } } },
    { sessionId: "s", sequence: 4, createdAt: "", update: { sessionUpdate: "tool_call_update", toolCallId: "exec-1", status: "completed", rawOutput: { exit_code: 0 }, _meta: { terminal_exit: { terminal_id: "exec-1", exit_code: 0 } } } },
  ];
  const state = hydrateExternalAgentEvents([...events, ...events]);
  const tool = state.items[0];
  assert.equal(tool.kind, "tool");
  if (tool.kind !== "tool") throw Error("Expected tool");
  assert.equal(tool.terminalOutput, "/project\ncafé ✓\n");
  assert.equal(tool.status, "completed");
});

test("image-only and text/image prompts stay in a single user message", () => {
  let state = reduceExternalAgentUpdate(emptyExternalAgentState(), { sessionUpdate: "user_message_chunk", content: { type: "image", data: "aGk=", mimeType: "image/png", name: "reference.png" } });
  state = reduceExternalAgentUpdate(state, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Use this layout" } });
  assert.equal(state.items.length, 1);
  const user = state.items[0];
  assert.equal(user.kind, "user");
  if (user.kind !== "user") throw Error("Expected user");
  assert.equal(user.text, "Use this layout");
  assert.equal(user.images?.[0]?.name, "reference.png");
});
