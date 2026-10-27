import assert from "node:assert/strict";
import { test } from "node:test";
import { providerFailureMessage } from "../../../src/features/agents/providerFailure.ts";

test("preserves the account suspension instead of suggesting another request", () => {
  const detail = "Coloride's provider account is suspended. Choose a model from another provider.";
  const message = providerFailureMessage(detail);
  assert.equal(message, `${detail} Your message was restored.`);
  assert.equal(message.includes("try again"), false);
});

test("preserves model access errors in restored sessions", () => {
  const detail = "Google does not allow this account to use the selected Gemini 2.5 model.";
  assert.equal(providerFailureMessage(`  ${detail}  `), `${detail} Your message was restored.`);
});

test("legacy guards without details still have a readable fallback", () => {
  for (const detail of [undefined, null, {}, "", "  "]) {
    assert.match(providerFailureMessage(detail), /The model could not respond/);
  }
});
