export type VoiceSnapshot = {
  lines?: { text?: string | null }[];
  buffer_transcription?: string;
};

/** A terminal snapshot prefers committed segments over provisional hypotheses. */
export function voiceTranscript(data: VoiceSnapshot, final = false): string {
  const confirmed = (data.lines ?? []).map(line => line.text ?? "").filter(Boolean).join(" ").trim();
  const provisional = data.buffer_transcription?.trim() ?? "";
  if (final && confirmed) return confirmed;
  return [confirmed, provisional].filter(Boolean).join(" ");
}
