import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFilePath } from "../../../src/features/external-agents/workspaceFilePath";

test("edited files resolve against their agent workspace and must belong to the current editor", () => {
  assert.equal(workspaceFilePath("src/./file.ts", "/project", "/project"), "/project/src/file.ts");
  assert.equal(workspaceFilePath("/project/src/../file.ts", "/project/"), "/project/file.ts");
  for (const path of ["/project-other/file.ts", "/project/../other/file.ts", "../other/file.ts", "file:///project/file.ts", "/project", "src/../../outside"]) {
    assert.equal(workspaceFilePath(path, "/project", "/project"), null, path);
  }
  assert.equal(workspaceFilePath("file.ts", "/current", "/previous"), null);
  assert.equal(workspaceFilePath("/project/file.ts", null, "/project"), null);
  assert.equal(workspaceFilePath("file.ts", "/project", null), null);
});
