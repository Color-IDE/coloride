import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalAgentEvent } from "@coloride/contracts";
import { hydrateExternalAgentEvents, reduceExternalAgentUpdate, emptyExternalAgentState } from "../../../src/features/external-agents/externalAgentReducer";

test("tool updates merge by toolCallId and the turn ends on the ACP response", () => {
  let state = emptyExternalAgentState();
  state = reduceExternalAgentUpdate(state, { sessionUpdate: "tool_call", toolCallId: "call-1", title: "Edit file", status: "pending" });
  state = reduceExternalAgentUpdate(state, { sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" });
  state = reduceExternalAgentUpdate(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } });
  assert.equal(state.items.filter((item) => item.kind === "tool").length, 1);
  assert.equal(state.turnActive, true);
  state = reduceExternalAgentUpdate(state, { sessionUpdate: "turn_complete", stopReason: "end_turn" });
  assert.equal(state.turnActive, false);
});

test("replay ignores events at or below the stored sequence", () => {
  const events: ExternalAgentEvent[] = [
    { sessionId: "s", sequence: 1, createdAt: "", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hi" } } },
    { sessionId: "s", sequence: 1, createdAt: "", update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Again" } } },
  ];
  const state = hydrateExternalAgentEvents(events);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0]?.kind === "user" ? state.items[0].text : "", "Hi");
});
