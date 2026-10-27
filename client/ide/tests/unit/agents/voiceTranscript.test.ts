import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceTranscript } from "../../../src/features/agents/voiceTranscript.ts";

test("streams confirmed and provisional multilingual text", () => {
  assert.equal(voiceTranscript({ lines: [{ text: "Hola," }], buffer_transcription: "¿cómo estás?" }), "Hola, ¿cómo estás?");
  assert.equal(voiceTranscript({ lines: [{ text: "مرحبا" }], buffer_transcription: "بالعالم" }), "مرحبا بالعالم");
});
test("terminal flush excludes the stale provisional tail", () => {
  assert.equal(voiceTranscript({ lines: [{ text: "Revisa el proyecto." }], buffer_transcription: "proyecto." }, true), "Revisa el proyecto.");
});
test("preserves legitimate repeated words and punctuation in confirmed speech", () => {
  assert.equal(voiceTranscript({ lines: [{ text: "Muy, muy bien." }, { text: null }], buffer_transcription: "bien." }, true), "Muy, muy bien.");
});
test("keeps provisional speech if the server has not committed any lines", () => {
  assert.equal(voiceTranscript({ buffer_transcription: "Bonjour" }, true), "Bonjour");
  assert.equal(voiceTranscript({ lines: [] }, true), "");
});
