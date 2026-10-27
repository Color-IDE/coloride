import assert from "node:assert/strict";
import { test } from "node:test";
import { queueAgentEditHighlight, updateAgentEditReviewAfter, getAgentEditReview, clearAgentEditReview, resolveReviewBufferText, getAllAgentEditReviews, reconcileAgentEditReviewDirectory, subscribeAgentEditReviews } from "../../../src/features/editor/agentEditBridge.ts";

test("user edits persist across review hydration and reverting never restores AI text", () => {
  const values = new Map<string, string>();
  (globalThis as any).window = {localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }};
  try {
    queueAgentEditHighlight("/test.py", "original", "AI version");
    updateAgentEditReviewAfter("/test.py", "user version");
    clearAgentEditReview(undefined, {persist: false});
    assert.deepEqual(getAgentEditReview("/test.py"), {path: "/test.py", before: "original", after: "user version"});
    updateAgentEditReviewAfter("/test.py", "original");
    assert.equal(getAgentEditReview("/test.py"), null);
    assert.equal(resolveReviewBufferText("/test.py", "original"), "original");
  } finally { clearAgentEditReview(); delete (globalThis as any).window; }
});


test("deleted files cannot leave green review markers on their ancestor folders", () => {
  clearAgentEditReview();
  try {
    queueAgentEditHighlight("/project/src/deleted.ts", "old", "new");
    queueAgentEditHighlight("/elsewhere/keep.ts", "old", "new");
    let notifications = 0;
    const unsubscribe = subscribeAgentEditReviews(() => { notifications++; });
    reconcileAgentEditReviewDirectory("/project", ["/project/src"]);
    assert.ok(getAgentEditReview("/project/src/deleted.ts"), "keep reviews below collapsed existing folders");
    reconcileAgentEditReviewDirectory("/project/src", ["/project/src/current.ts"]);
    assert.equal(getAgentEditReview("/project/src/deleted.ts"), null);
    assert.deepEqual(getAllAgentEditReviews().map(r => r.path), ["/elsewhere/keep.ts"]);
    assert.equal(notifications, 1);
    unsubscribe();
  } finally { clearAgentEditReview(); }
});

test("removing a whole directory clears its descendant reviews without touching sibling roots", () => {
  clearAgentEditReview();
  try {
    queueAgentEditHighlight("/project/src/deep/file.ts", "old", "new");
    queueAgentEditHighlight("/project-other/file.ts", "old", "new");
    reconcileAgentEditReviewDirectory("/project/", ["/project/package.json"]);
    assert.equal(getAgentEditReview("/project/src/deep/file.ts"), null);
    assert.ok(getAgentEditReview("/project-other/file.ts"));
  } finally { clearAgentEditReview(); }
});
