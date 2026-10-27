from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .task import AgentTask


class GuardReason(StrEnum):
    RUNAWAY = "runaway"
    FRESH_TOKENS = "fresh-tokens"
    RUNTIME = "runtime"
    PROVIDER_ERRORS = "provider-errors"
    CONTEXT = "context"
    OUT_OF_CREDITS = "out-of-credits"


@dataclass(slots=True, frozen=True)
class GuardDecision:
    reason: GuardReason
    message: str


class ResourceGuard:
    """Emergency-only guards. Normal completion is determined by progress."""

    def evaluate(self, task: AgentTask, *, runtime_ms: int) -> GuardDecision | None:
        usage = task.budget_usage
        budget = task.budget
        usage.runtime_ms = max(usage.runtime_ms, max(0, int(runtime_ms)))
        # Fresh-token usage is accounting/telemetry only. Reaching this value must
        # never turn an internal model budget into a user-facing decision.
        # Economic enforcement remains authoritative in the cloud credits layer.
        if usage.runtime_ms >= budget.max_runtime_ms:
            return GuardDecision(
                GuardReason.RUNTIME,
                "This task reached the configured runtime budget.",
            )
        if usage.consecutive_provider_errors >= budget.max_consecutive_provider_errors:
            return GuardDecision(
                GuardReason.PROVIDER_ERRORS,
                "The model provider failed repeatedly.",
            )
        if (
            task.progress.hard_stops - task.progress.hard_stops_baseline
            >= budget.max_hard_stops
        ):
            return GuardDecision(
                GuardReason.RUNAWAY,
                "The agent repeatedly failed to make progress after changing strategy. "
                "Execution has been paused to prevent a tool loop.",
            )
        return None


def guard_actions(reason: GuardReason) -> list[str]:
    if reason == GuardReason.OUT_OF_CREDITS:
        return ["view-plans", "stop"]
    return ["retry-strategy", "continue-once", "update-budget", "stop"]
