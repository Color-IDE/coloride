import type { GuardPause, TaskBudget } from "@coloride/contracts";
import { openPricingPage } from "../auth/llmCredits";

export function AgentGuardPauseCard({
  pause,
  resolving,
  onResolve,
}: {
  pause: GuardPause;
  resolving: string | null;
  onResolve: (
    action: "retry-strategy" | "continue-once" | "update-budget" | "stop",
    budget?: TaskBudget,
  ) => void;
}) {
  const credits = pause.reason === "out-of-credits";
  return (
    <section className="agent-guard-card" role="status" aria-live="polite">
      <div className="agent-guard-copy">
        <strong>{credits ? "Credits needed" : "Task paused safely"}</strong>
        <span>
          {credits
            ? "Your Coloride AI credits have run out. Your file changes are saved. View plans or stop this paused task."
            : pause.message}
        </span>
      </div>
      <div className="agent-guard-actions">
        {credits ? (
          <button type="button" onClick={() => openPricingPage()}>
            View plans
          </button>
        ) : (
          <>
            <button
              disabled={resolving !== null}
              type="button"
              onClick={() => onResolve("retry-strategy")}
            >
              {resolving === "retry-strategy"
                ? "Retrying…"
                : "Retry automatically"}
            </button>
            <button
              disabled={resolving !== null}
              type="button"
              onClick={() => onResolve("continue-once")}
            >
              {resolving === "continue-once" ? "Continuing…" : "Continue once"}
            </button>
            <button
              disabled={resolving !== null}
              type="button"
              onClick={() =>
                onResolve("update-budget", increasedGuardBudget(pause))
              }
            >
              {resolving === "update-budget" ? "Increasing…" : "Increase limit"}
            </button>
          </>
        )}
        <button
          className="is-secondary"
          disabled={resolving !== null}
          type="button"
          onClick={() => onResolve("stop")}
        >
          Stop
        </button>
      </div>
    </section>
  );
}

export function increasedGuardBudget(pause: GuardPause): TaskBudget {
  const budget = { ...pause.budget };
  switch (pause.reason) {
    case "fresh-tokens":
      budget.maxFreshTokens = Math.max(
        budget.maxFreshTokens + 500_000,
        pause.usage.freshTokens + 500_000,
      );
      break;
    case "runtime":
      budget.maxRuntimeMs = Math.max(
        budget.maxRuntimeMs + 30 * 60_000,
        pause.usage.runtimeMs + 30 * 60_000,
      );
      break;
    case "provider-errors":
      budget.maxConsecutiveProviderErrors += 5;
      break;
    default:
      budget.maxHardStops += 3;
      break;
  }
  return budget;
}
