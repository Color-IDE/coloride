/**
 * Run from client/ide:
 *   npx --yes tsx --test tests/unit/auth/llmCreditsCore.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  creditsLevel,
  creditsUsagePercent,
  formatCreditsNumber,
  formatPeriodEnd,
  isOutOfCreditsError,
  mapManagedLlmUserMessage,
  parseLlmCreditsPayload,
} from "../../../src/features/auth/llmCreditsCore";

describe("parseLlmCreditsPayload", () => {
  it("parses new credits_* contract", () => {
    const snap = parseLlmCreditsPayload({
      plan: "basic",
      role: "user",
      llm: {
        enabled: true,
        credits_used: 1250,
        credits_limit: 6000,
        credits_remaining: 4750,
        period_start: "2026-07-01T00:00:00Z",
        period_end: "2026-08-01T00:00:00Z",
        unmetered: false,
      },
    });
    assert.ok(snap);
    assert.equal(snap!.plan, "basic");
    assert.equal(snap!.creditsUsed, 1250);
    assert.equal(snap!.creditsLimit, 6000);
    assert.equal(snap!.creditsRemaining, 4750);
    assert.equal(snap!.unmetered, false);
    assert.equal(snap!.enabled, true);
  });

  it("prefers credits_* over legacy tokens_*", () => {
    const snap = parseLlmCreditsPayload({
      llm: {
        credits_used: 10,
        credits_limit: 100,
        credits_remaining: 90,
        tokens_used: 9999,
        tokens_limit: 99999,
      },
    });
    assert.ok(snap);
    assert.equal(snap!.creditsUsed, 10);
    assert.equal(snap!.creditsLimit, 100);
  });

  it("falls back to legacy tokens_*", () => {
    const snap = parseLlmCreditsPayload({
      plan: "pro",
      usage: {
        tokens_used: 100,
        tokens_limit: 10000,
        resets_at: "2026-08-01T00:00:00Z",
      },
    });
    assert.ok(snap);
    assert.equal(snap!.creditsUsed, 100);
    assert.equal(snap!.creditsLimit, 10000);
    assert.equal(snap!.creditsRemaining, 9900);
    assert.equal(snap!.periodEnd, "2026-08-01T00:00:00Z");
  });

  it("derives remaining when missing", () => {
    const snap = parseLlmCreditsPayload({
      llm: { credits_used: 80, credits_limit: 100 },
    });
    assert.ok(snap);
    assert.equal(snap!.creditsRemaining, 20);
  });

  it("handles unmetered admin", () => {
    const snap = parseLlmCreditsPayload({
      plan: "ultimate",
      role: "admin",
      llm: {
        enabled: true,
        credits_used: 0,
        credits_limit: 0,
        credits_remaining: 0,
        unmetered: true,
      },
    });
    assert.ok(snap);
    assert.equal(snap!.unmetered, true);
    assert.equal(creditsLevel(snap), "unmetered");
  });

  it("returns null for empty payload", () => {
    assert.equal(parseLlmCreditsPayload(null), null);
    assert.equal(parseLlmCreditsPayload({}), null);
  });
});

describe("credits levels", () => {
  const base = {
    plan: "basic",
    role: "user",
    enabled: true,
    periodStart: null as string | null,
    periodEnd: null as string | null,
    unmetered: false,
    fetchedAt: Date.now(),
  };

  it("0% normal", () => {
    const snap = { ...base, creditsUsed: 0, creditsLimit: 1000, creditsRemaining: 1000 };
    assert.equal(creditsUsagePercent(snap), 0);
    assert.equal(creditsLevel(snap), "normal");
  });

  it("80% warning", () => {
    const snap = { ...base, creditsUsed: 800, creditsLimit: 1000, creditsRemaining: 200 };
    assert.equal(creditsUsagePercent(snap), 80);
    assert.equal(creditsLevel(snap), "warning");
  });

  it("95% critical", () => {
    const snap = { ...base, creditsUsed: 950, creditsLimit: 1000, creditsRemaining: 50 };
    assert.equal(creditsUsagePercent(snap), 95);
    assert.equal(creditsLevel(snap), "critical");
  });

  it("100% exhausted", () => {
    const snap = { ...base, creditsUsed: 1000, creditsLimit: 1000, creditsRemaining: 0 };
    assert.equal(creditsUsagePercent(snap), 100);
    assert.equal(creditsLevel(snap), "exhausted");
  });

  it("loading / unavailable", () => {
    assert.equal(creditsLevel(null, "loading"), "loading");
    assert.equal(creditsLevel(null, "error"), "unavailable");
  });
});

describe("errors", () => {
  it("detects out_of_credits", () => {
    assert.equal(isOutOfCreditsError("out_of_credits"), true);
    assert.equal(isOutOfCreditsError("Out of plan credits. Upgrade"), true);
    assert.equal(isOutOfCreditsError("fail", { error: "out_of_credits" }), true);
    assert.equal(isOutOfCreditsError("stream stalled"), false);
  });

  it("maps managed LLM messages", () => {
    assert.match(
      mapManagedLlmUserMessage("Coloride session expired. Sign in again."),
      /session has expired/i,
    );
    assert.match(mapManagedLlmUserMessage("Rate limited"), /Too many AI requests/i);
    assert.match(
      mapManagedLlmUserMessage("misconfigured"),
      /temporarily unavailable for this model/i,
    );
  });
});

describe("formatters", () => {
  it("formats numbers", () => {
    assert.equal(formatCreditsNumber(1250), "1,250");
  });

  it("formats period end", () => {
    const label = formatPeriodEnd("2026-08-01T00:00:00.000Z");
    assert.ok(label && label.length > 4);
  });
});
