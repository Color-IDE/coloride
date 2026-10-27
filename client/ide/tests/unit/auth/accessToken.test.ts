/**
 * Run from client/ide:
 *   npx --yes tsx --test tests/unit/auth/accessToken.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessTokenExpiresAtMs, accessTokenNeedsRefresh } from "../../../src/features/auth/accessToken";

function jwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp }), "utf8")
    .toString("base64url");
  return `header.${payload}.sig`;
}

describe("accessToken", () => {
  it("reads JWT exp as milliseconds", () => {
    assert.equal(accessTokenExpiresAtMs(jwt(1_700_000_090)), 1_700_000_090_000);
  });

  it("treats opaque tokens as not expiring", () => {
    assert.equal(accessTokenExpiresAtMs("not-a-jwt"), null);
    assert.equal(accessTokenNeedsRefresh("opaque-token", 1_700_000_000_000), false);
  });

  it("refreshes missing or nearly expired JWTs", () => {
    const now = 1_700_000_000_000;
    assert.equal(accessTokenNeedsRefresh("", now), true);
    assert.equal(accessTokenNeedsRefresh(jwt(1_700_000_030), now), true);
    assert.equal(accessTokenNeedsRefresh(jwt(1_700_000_200), now), false);
  });
});
