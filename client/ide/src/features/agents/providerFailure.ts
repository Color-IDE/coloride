/** Preserve the provider's actionable error when restoring a failed prompt. */
export function providerFailureMessage(detail: unknown): string {
  const message = typeof detail === "string" ? detail.trim() : "";
  return message
    ? `${message} Your message was restored.`
    : "The model could not respond. Your message was restored — try again.";
}
