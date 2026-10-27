import assert from "node:assert/strict";
import { test } from "node:test";
import { checkpointPathsWithLaterEdits, restoreCheckpointBatch, resolveCheckpointPaths } from "../../../src/features/agents/checkpointReview.ts";

test("Undo restores overlapping edits newest first", async () => {
  let disk = "third";
  const settled: string[] = [];
  await restoreCheckpointBatch([
    { id: "first", before: "original" },
    { id: "second", before: "second" },
  ], async (checkpoint) => { disk = checkpoint.before; }, (checkpoint) => settled.push(checkpoint.id));
  assert.equal(disk, "original");
  assert.deepEqual(settled, ["second", "first"]);
});

test("a failed batch leaves completed restores settled and retry only restores the remainder", async () => {
  const checkpoints = [{ id: "old" }, { id: "middle" }, { id: "new" }];
  const settled = new Set<string>();
  const calls: string[] = [];
  await assert.rejects(restoreCheckpointBatch(checkpoints, async (checkpoint) => {
    calls.push(checkpoint.id);
    if (checkpoint.id === "middle") throw new Error("write failed");
  }, (checkpoint) => { settled.add(checkpoint.id); }), /write failed/);
  assert.deepEqual([...settled], ["new"]);
  await restoreCheckpointBatch(checkpoints.filter(c => !settled.has(c.id)), async (checkpoint) => {
    calls.push(checkpoint.id);
  }, (checkpoint) => { settled.add(checkpoint.id); });
  assert.deepEqual(calls, ["new", "middle", "middle", "old"]);
});

test("duplicate history checkpoint IDs cannot restore the same edit twice", async () => {
  const calls: string[] = [];
  await restoreCheckpointBatch([{ id: "one" }, { id: "one" }], async c => { calls.push(c.id); }, () => {});
  assert.deepEqual(calls, ["one"]);
});

test("IDE resolution settles older turns but never accepts a future edit of the same file", () => {
  const resolved = new Map<string, Set<string>>();
  assert.deepEqual(resolveCheckpointPaths([{ id: "old", paths: ["/a"] }], ["/a"], resolved), ["old"]);
  assert.deepEqual(resolveCheckpointPaths([{ id: "new", paths: ["/a", "/b"] }], ["/b"], resolved), []);
  assert.deepEqual(resolveCheckpointPaths([{ id: "new", paths: ["/a", "/b"] }], ["/a"], resolved), ["new"]);
});


test("an old card cannot clear or undo a later edit, including an accepted one", () => {
  const checkpoints = [{ id: "old", paths: ["/a", "/b"] }, { id: "later", paths: ["/a"] }];
  assert.deepEqual([...checkpointPathsWithLaterEdits(checkpoints, new Set(["old"]))], ["/a"]);
  assert.deepEqual([...checkpointPathsWithLaterEdits(checkpoints, new Set(["old", "later"]))], []);
  assert.deepEqual([...checkpointPathsWithLaterEdits(checkpoints, new Set(["later"]))], []);
});
