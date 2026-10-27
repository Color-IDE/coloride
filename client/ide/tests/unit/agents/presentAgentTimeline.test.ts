import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phaseGroupMeta, presentTurnItems } from "../../../src/features/agents/presentAgentTimeline.ts";
import type { AgentTimelineEntry, ExploreTimelineItem } from "../../../src/features/agents/AgentTimeline";

function thought(id: string, ms = 3_800): ExploreTimelineItem {
  return {
    id,
    kind: "activity",
    activityId: id,
    activityKind: "thinking",
    label: "Thinking",
    detail: "",
    state: "completed",
    durationMs: ms,
    startedAt: null,
  };
}

function runningThought(id: string): ExploreTimelineItem {
  return {
    ...thought(id, 0),
    state: "running",
    durationMs: null,
  };
}

function tool(
  id: string,
  name: string,
  extra: Partial<Extract<AgentTimelineEntry, { kind: "tool" }>> = {},
): Extract<AgentTimelineEntry, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    itemId: id,
    tool: name,
    title: name,
    arguments: extra.arguments ?? {},
    output: extra.output ?? "",
    metadata: extra.metadata ?? {},
    diff: extra.diff ?? "",
    preview: extra.preview ?? "",
    complete: extra.complete ?? true,
    failed: extra.failed ?? false,
    waitingApproval: extra.waitingApproval ?? false,
  };
}

describe("presentTurnItems", () => {
  it("hides recoverable malformed tool calls outside Verbose", () => {
    const failedRead = tool("r1", "read_file", {
      arguments: { path: "login-form.tsx", start_line: 540, end_line: 80 },
      output: "Error: invalid line range",
      metadata: { internalRecoverableFailure: true },
      failed: true,
    });

    assert.deepEqual(presentTurnItems([failedRead], "normal"), []);
    assert.deepEqual(presentTurnItems([failedRead], "minimal"), []);
    assert.equal(presentTurnItems([failedRead], "verbose").length, 1);
  });

  it("Normal hides internal history recovery while preserving the answer", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1", 3_800),
      tool("s1", "search_chat_history", {
        arguments: { query: "desktop security secrets" },
        metadata: { scanned: 214, hits: 6 },
      }),
      thought("t2", 3_300),
      tool("s2", "search_chat_history", {
        arguments: { query: "Linear OAuth" },
        metadata: { scanned: 214, hits: 4 },
      }),
      thought("t3", 1_700),
      tool("s3", "search_chat_history", {
        arguments: { query: "VPS API admin users" },
        metadata: { scanned: 214, hits: 5 },
      }),
      { id: "a1", kind: "assistant", text: "Resumen…", finishedAt: null, streaming: false, final: true },
    ];
    const presented = presentTurnItems(items, "normal");
    assert.equal(presented.length, 1);
    assert.equal(presented[0]?.kind, "assistant");
  });

  it("Normal hides context maintenance and keeps file edits visible", () => {
    const items: AgentTimelineEntry[] = [
      {
        id: "c1",
        kind: "activity",
        activityId: "c1",
        activityKind: "context",
        label: "Context compacted",
        detail: "12 older items summarized",
        state: "completed",
        durationMs: 400,
        startedAt: null,
      },
      thought("t1"),
      tool("r1", "read_file", { arguments: { path: "auth.ts" } }),
      tool("r2", "read_file", { arguments: { path: "middleware.ts" } }),
      tool("w1", "replace_in_file", { arguments: { path: "middleware.ts" } }),
      { id: "a1", kind: "assistant", text: "Hecho.", finishedAt: null, streaming: false, final: true },
    ];
    const presented = presentTurnItems(items, "normal");
    assert.equal(presented.some((item) => item.kind === "activity" && item.activityKind === "context"), false);
    assert.equal(presented.some((item) => item.kind === "tool" && item.tool === "replace_in_file"), true);
    assert.equal(presented.at(-1)?.kind, "assistant");
  });

  it("Normal renders one explore operation directly instead of an Explored 1 wrapper", () => {
    const listed = tool("l1", "list_files", {
      arguments: { path: "/var/www/coloride/sites" },
    });

    const presented = presentTurnItems([listed], "normal");

    assert.deepEqual(presented, [listed]);
  });

  it("Normal keeps a completed lone thought in settled history", () => {
    const thinking = thought("t1");

    const presented = presentTurnItems([thinking], "normal");

    assert.deepEqual(presented, [thinking]);
  });

  it("Normal keeps a completed thought even when the provider omits duration", () => {
    const thinking = thought("t1", 0);

    const presented = presentTurnItems([thinking], "normal");

    assert.deepEqual(presented, [thinking]);
  });

  it("Normal keeps only the latest completed thought when there are no tools", () => {
    const first = thought("t1");
    const latest = thought("t2");

    const presented = presentTurnItems([first, latest], "normal");

    assert.deepEqual(presented, [latest]);
  });

  it("Normal keeps one live thinking indicator only while the turn is active", () => {
    const thinking = runningThought("t1");

    assert.deepEqual(presentTurnItems([thinking], "normal", true), [thinking]);
    assert.deepEqual(presentTurnItems([thinking], "normal", false), []);
  });

  it("Normal nests thinking inside Exploring when a tool starts", () => {
    const thinking = thought("t1");
    const listed = tool("l1", "list_files", {
      arguments: { path: "/var/www/coloride/sites" },
    });

    const presented = presentTurnItems([thinking, listed], "normal");

    assert.equal(presented.length, 1);
    assert.equal(presented[0]?.kind, "explore_group");
    if (presented[0]?.kind === "explore_group") {
      assert.equal(presented[0].items.some((item) => item.kind === "activity"), true);
      assert.equal(presented[0].items.some((item) => item.kind === "tool" && item.tool === "list_files"), true);
    }
  });

  it("Normal groups multiple exploration operations with thoughts inside", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1"),
      tool("r1", "read_file", { arguments: { path: "auth.ts" } }),
      thought("t2"),
      tool("s1", "search_files", { arguments: { query: "session" } }),
    ];

    const presented = presentTurnItems(items, "normal");

    assert.equal(presented.filter((item) => item.kind === "activity").length, 0);
    const group = presented.find((item) => item.kind === "explore_group");
    assert.equal(group?.kind, "explore_group");
    if (group?.kind === "explore_group") {
      const meta = phaseGroupMeta(group.items, false);
      assert.equal(meta.verb, "Explored");
      assert.equal(meta.hideThoughts, false);
      assert.equal(group.items.filter((item) => item.kind === "activity").length, 2);
      assert.equal(group.items.filter((item) => item.kind === "tool").length, 2);
    }
  });

  it("Normal preserves narration between exploration groups", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1"),
      tool("r1", "read_file", { arguments: { path: "route.ts", start_line: 1, end_line: 80 } }),
      { id: "a1", kind: "assistant", text: "Sigo leyendo el POST.", finishedAt: null, streaming: false, final: false },
      thought("t2"),
      tool("r2", "read_file", { arguments: { path: "route.ts", start_line: 81, end_line: 160 } }),
      { id: "a2", kind: "assistant", text: "Encontré el problema.", finishedAt: null, streaming: false, final: true },
    ];

    const presented = presentTurnItems(items, "normal");

    assert.equal(presented.length, 4);
    assert.equal(presented[0]?.kind, "explore_group");
    assert.equal(presented[1]?.kind, "assistant");
    assert.equal(presented[2]?.kind, "explore_group");
    assert.equal(presented[3]?.kind, "assistant");
    if (presented[1]?.kind === "assistant") {
      assert.equal(presented[1].text, "Sigo leyendo el POST.");
    }
    if (presented[0]?.kind === "explore_group") {
      const meta = phaseGroupMeta(presented[0].items, false);
      assert.equal(meta.detail, "1 file");
      assert.equal(presented[0].items.filter((item) => item.kind === "tool").length, 1);
    }
  });

  it("Normal keeps each file edit as its own row", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1"),
      tool("w1", "write_file", { arguments: { path: "auth.ts" } }),
      thought("t2"),
      tool("w2", "replace_in_file", { arguments: { path: "middleware.ts" } }),
    ];

    const presented = presentTurnItems(items, "normal");

    assert.equal(presented.filter((item) => item.kind === "activity").length, 2);
    assert.equal(presented.some((item) => item.kind === "explore_group"), false);
    assert.equal(presented.filter((item) => item.kind === "tool" && item.tool === "write_file").length, 1);
    assert.equal(presented.filter((item) => item.kind === "tool" && item.tool === "replace_in_file").length, 1);
  });

  it("Minimal keeps only working summary, writes, and the answer", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1"),
      tool("s1", "search_chat_history"),
      tool("w1", "write_file", { arguments: { path: "auth.ts" } }),
      tool("w2", "replace_in_file", { arguments: { path: "middleware.ts" } }),
      { id: "a1", kind: "assistant", text: "Listo.", finishedAt: null, streaming: false, final: true },
    ];
    const presented = presentTurnItems(items, "minimal");
    assert.equal(presented.some((item) => item.kind === "tool" && item.tool === "search_chat_history"), false);
    assert.ok(presented.some((item) => item.kind === "explore_group" || (item.kind === "tool" && item.tool === "write_file")));
    assert.equal(presented.at(-1)?.kind, "assistant");
  });

  it("Verbose keeps every row including thoughts", () => {
    const items: AgentTimelineEntry[] = [
      thought("t1"),
      tool("s1", "search_chat_history"),
      {
        id: "c1",
        kind: "activity",
        activityId: "c1",
        activityKind: "context",
        label: "Context compacted",
        detail: "12 older items summarized",
        state: "completed",
        durationMs: 400,
        startedAt: null,
      },
      thought("t2"),
    ];
    const presented = presentTurnItems(items, "verbose");
    assert.equal(presented.length, 4);
  });
});

it("keeps every visible tool as output is read and the turn completes", () => {
  const entries: AgentTimelineEntry[] = [
    thought("t1"), tool("list", "list_files"), thought("t2"),
    tool("output", "read_tool_output"), thought("t3"), tool("read", "read_file"),
    thought("t4"),
    { id: "answer", kind: "assistant", text: "Analysis", final: true, streaming: false, finishedAt: null },
  ];
  for (let count = 1; count <= entries.length; count++) {
    for (const active of [true, false]) {
      const presented = presentTurnItems(entries.slice(0, count), "normal", active);
      const tools = presented.flatMap((entry) => entry.kind === "explore_group" ? entry.items : [entry])
        .filter((entry) => entry.kind === "tool").map((entry) => entry.id);
      assert.deepEqual(tools, entries.slice(0, count).filter((entry) => entry.kind === "tool").map((entry) => entry.id));
    }
  }
});

it("hiding history lookup preserves earlier tools and narration", () => {
  const entries: AgentTimelineEntry[] = [
    thought("t1"), tool("list", "list_files"),
    { id: "progress", kind: "assistant", text: "Reading project", final: false, streaming: false, finishedAt: null },
    thought("t2"), tool("history", "search_chat_history"),
    thought("t3"), tool("read", "read_file"),
  ];
  const presented = presentTurnItems(entries, "normal");
  const flat = presented.flatMap((entry) => entry.kind === "explore_group" ? entry.items : [entry]);
  assert.deepEqual(flat.filter((entry) => entry.kind === "tool").map((entry) => entry.id), ["list", "read"]);
  assert.ok(flat.some((entry) => entry.id === "progress"));
});


it("keeps introductory text above tools throughout streaming and completion", () => {
  const entries: AgentTimelineEntry[] = [
    { id: "intro", kind: "assistant", text: "Voy a revisar la terminal.", final: false, streaming: false, finishedAt: null },
    thought("t1"), tool("list", "list_files"), tool("read", "read_file"),
  ];
  for (let count = 1; count <= entries.length; count++) {
    for (const active of [true, false]) {
      const presented = presentTurnItems(entries.slice(0, count), "normal", active);
      assert.equal(presented[0]?.id, "intro");
    }
  }
});
