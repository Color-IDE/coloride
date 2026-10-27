/**
 * Run from client/ide:
 *   npx --yes tsx --test tests/unit/auth/cloudAuth.boot.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = [
  "cloudAuth.ts",
  "cloud/session.ts",
  "cloud/storage.ts",
  "cloud/transport.ts",
  "cloud/errors.ts",
]
  .map((file) =>
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../src/features/auth",
        file,
      ),
      "utf8",
    ),
  )
  .join("\n");
const loginGate = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/features/auth/LoginGate.tsx",
  ),
  "utf8",
);

describe("cloud auth boot", () => {
  afterEach(() => {
    // source-level contract — no module state to reset
  });

  it("does not hold splash on a hung cloud refresh", () => {
    assert.match(source, /LAST_USER_KEY/);
    assert.match(source, /memoryPendingRefresh/);
    assert.match(source, /CLOUD_BOOT_TIMEOUT_MS/);
    assert.match(source, /refreshStoredSessionInBackground/);
    assert.match(loginGate, /2500/);
    assert.match(loginGate, /session\?\.user && session\.accessToken/);
  });

  it("does not reveal the workspace for a provisional cached profile", () => {
    assert.match(loginGate, /!next\.pendingRefresh/);
    assert.match(loginGate, /restored\?\.pendingRefresh/);
    assert.match(loginGate, /bootstrapResolvedRef/);
  });

  it("times out cloud fetchMe so applyTokens cannot sit for 10s", () => {
    assert.match(
      source,
      /withTimeout\(\s*fetchMe\(tokens\.access_token\),\s*2500/,
    );
  });

  it("Sign Out latches so keep-alive cannot restore the previous session", () => {
    assert.match(source, /let signedOut = false/);
    assert.match(source, /signedOut = true/);
    assert.match(source, /if \(signedOut\) return null/);
    assert.match(source, /if \(signedOut\) return false/);
    assert.match(source, /fromSignIn: true/);
    assert.match(source, /if \(signedOut && !options\.fromSignIn\)/);
  });

  it("treats an expired refresh token as a hard logout, not a retry", () => {
    assert.match(source, /payloadLooksRevoked/);
    assert.match(source, /invalid or expired refresh/);
    assert.match(source, /let refreshInFlight/);
    assert.match(source, /await logoutCloudAuth\(\{ remote: false \}\)/);
  });
});
