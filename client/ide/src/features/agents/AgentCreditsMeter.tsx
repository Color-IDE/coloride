import {
  creditsLevel,
  creditsUsagePercent,
  formatCreditsNumber,
  formatPeriodEnd,
  openPricingPage,
  type LlmCreditsSnapshot,
} from "../auth/llmCredits";

type Props = {
  snapshot: LlmCreditsSnapshot | null;
  status: "loading" | "ready" | "error";
  onRetry?: () => void;
  compact?: boolean;
};

/**
 * Monthly Coloride AI credits meter (cloud truth).
 * Separate from the per-turn context % ring next to attach.
 */
export function AgentCreditsMeter({ snapshot, status, onRetry, compact = true }: Props) {
  const level = creditsLevel(snapshot, status === "loading" && !snapshot ? "loading" : status === "error" && !snapshot ? "error" : "ready");
  const pct = creditsUsagePercent(snapshot);
  const resetLabel = formatPeriodEnd(snapshot?.periodEnd ?? null);

  if (level === "loading") {
    return (
      <span className="agent-credits-meter is-loading" aria-busy="true" aria-label="Loading AI credits">
        <span className="agent-credits-meter-bar" />
        <span className="agent-credits-meter-label">…</span>
      </span>
    );
  }

  if (level === "unavailable") {
    return (
      <button
        type="button"
        className="agent-credits-meter is-unavailable"
        onClick={() => onRetry?.()}
        title="Could not load AI credits. Click to retry."
      >
        <span className="agent-credits-meter-label">Credits unavailable</span>
      </button>
    );
  }

  if (level === "disabled") {
    return (
      <button
        type="button"
        className="agent-credits-meter is-disabled"
        onClick={() => openPricingPage()}
        title="AI is not enabled on your plan"
      >
        <span className="agent-credits-meter-label">View plans</span>
      </button>
    );
  }

  if (level === "unmetered") {
    return (
      <span
        className="agent-credits-meter is-unmetered"
        title="Unmetered admin access"
      >
        <span className="agent-credits-meter-label">
          {compact ? "Unmetered" : "Unmetered admin access"}
        </span>
      </span>
    );
  }

  const used = snapshot!.creditsUsed;
  const limit = snapshot!.creditsLimit;
  const remaining = snapshot!.creditsRemaining;
  const tip = [
    `AI credits: ${formatCreditsNumber(used)} / ${formatCreditsNumber(limit)} used`,
    `${formatCreditsNumber(remaining)} remaining`,
    resetLabel ? `Resets ${resetLabel}` : null,
    "Usage varies with the selected model, context size, reasoning effort and number of agent steps.",
  ].filter(Boolean).join("\n");

  return (
    <span
      className={`agent-credits-meter is-${level}`}
      title={tip}
      aria-label={`AI credits ${formatCreditsNumber(used)} of ${formatCreditsNumber(limit)} used (${pct}%)`}
    >
      <span className="agent-credits-meter-track" aria-hidden="true">
        <span className="agent-credits-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="agent-credits-meter-label">
        {compact
          ? `${formatCreditsNumber(remaining)} left`
          : `${formatCreditsNumber(used)} / ${formatCreditsNumber(limit)}`}
      </span>
      <span aria-hidden="true" className="agent-credits-meter-tip">
        <strong>AI credits</strong>
        <span>{formatCreditsNumber(used)} / {formatCreditsNumber(limit)} used</span>
        <span>{formatCreditsNumber(remaining)} remaining</span>
        {resetLabel ? <span>Resets {resetLabel}</span> : null}
        <span className="agent-credits-meter-tip-note">
          Usage varies with the selected model, context size, reasoning effort and number of agent steps.
        </span>
      </span>
    </span>
  );
}

type DialogProps = {
  open: boolean;
  periodEnd: string | null;
  onDismiss: () => void;
};

export function OutOfCreditsDialog({ open, periodEnd, onDismiss }: DialogProps) {
  if (!open) return null;
  const reset = formatPeriodEnd(periodEnd);
  return (
    <div className="agent-credits-dialog-backdrop" role="presentation" onClick={onDismiss}>
      <div
        className="agent-credits-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="agent-credits-dialog-title"
        aria-describedby="agent-credits-dialog-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="agent-credits-dialog-title" className="agent-credits-dialog-title">
          Monthly AI credits used
        </h2>
        <p id="agent-credits-dialog-body" className="agent-credits-dialog-body">
          You&apos;ve used all AI credits included in your current plan.
          {reset
            ? ` Your allowance resets on ${reset}.`
            : " Your allowance resets at the start of the next billing period."}
        </p>
        <div className="agent-credits-dialog-actions">
          <button
            type="button"
            className="agent-credits-dialog-primary"
            onClick={() => {
              openPricingPage();
              onDismiss();
            }}
          >
            View plans
          </button>
          <button type="button" className="agent-credits-dialog-secondary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
