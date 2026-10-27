import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

test("local voice input streams PCM into the draft and releases capture", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const { stdout } = await promisify(execFile)(process.execPath,
    [resolve(root, "tests/electron/smoke/voice-input.mjs"), "--source"],
    { cwd: root, timeout: 80_000, maxBuffer: 1_000_000 });
  expect(stdout).toContain("WhisperLiveKit: live PCM");
  expect(stdout).toContain("cancellation PASS");
});
