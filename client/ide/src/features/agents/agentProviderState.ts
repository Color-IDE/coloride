import type { AgentMode } from "@coloride/contracts";
import {
  mapManagedLlmUserMessage,
  type LlmCreditsSnapshot,
} from "../auth/llmCredits";

export function hasModelCredits(
  snapshot: LlmCreditsSnapshot | null | undefined,
): boolean {
  if (!snapshot || !snapshot.enabled) return false;
  if (snapshot.unmetered) return true;
  if (snapshot.creditsLimit <= 0) return false;
  return snapshot.creditsRemaining > 0;
}

export const defaultMode = (): AgentMode => "act";

export const messageFromError = (error: unknown) => {
  const raw =
    error instanceof Error
      ? error.message.replace(/^Coloride API \d+:\s*/, "")
      : "Agent request failed";
  return mapManagedLlmUserMessage(raw);
};

export const isTurnStillSettlingError = (message: string) =>
  /agents\.turn_active|active turn to finish|turn is still active/i.test(
    message,
  );
