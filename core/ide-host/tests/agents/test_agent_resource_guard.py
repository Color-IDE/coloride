from __future__ import annotations

from coloride_desktop.agents.resource_guard import GuardReason, ResourceGuard, guard_actions
from coloride_desktop.agents.task import (
    DEFAULT_TOKEN_BUDGET,
    AgentTask,
    TaskBudget,
    TaskBudgetUsage,
)


def _task() -> AgentTask:
    return AgentTask.create(conversation_id="session", workspace_id="/srv/app", goal="Fix app")


def test_fresh_tokens_exclude_cached_input_and_include_output() -> None:
    usage = TaskBudgetUsage()
    usage.record_model_usage(input_tokens=80_000, cached_tokens=75_000, output_tokens=2_000)
    assert usage.input_tokens == 80_000
    assert usage.cached_input_tokens == 75_000
    assert usage.fresh_tokens == 7_000


def test_resource_guard_bounds_unsuccessful_loop_recovery() -> None:
    task = _task()
    task.budget = TaskBudget(
        max_fresh_tokens=10_000,
        max_runtime_ms=60_000,
        max_hard_stops=3,
        max_consecutive_provider_errors=5,
    )
    assert ResourceGuard().evaluate(task, runtime_ms=500) is None
    task.progress.hard_stops = 3
    decision = ResourceGuard().evaluate(task, runtime_ms=500)
    assert decision is not None
    assert decision.reason == GuardReason.RUNAWAY
    task.progress.hard_stops_baseline = 3
    assert ResourceGuard().evaluate(task, runtime_ms=500) is None


def test_fresh_token_accounting_never_pauses_the_user() -> None:
    task = _task()
    task.budget.max_fresh_tokens = 10
    task.budget_usage.fresh_tokens = 50_000
    assert ResourceGuard().evaluate(task, runtime_ms=100) is None


def test_provider_error_guard_allows_recovery_before_fifth_failure() -> None:
    task = _task()
    guard = ResourceGuard()
    task.budget_usage.consecutive_provider_errors = 4
    assert guard.evaluate(task, runtime_ms=100) is None
    task.budget_usage.consecutive_provider_errors = 5
    decision = guard.evaluate(task, runtime_ms=100)
    assert decision is not None
    assert decision.reason == GuardReason.PROVIDER_ERRORS


def test_out_of_credits_has_no_fake_budget_actions() -> None:
    assert guard_actions(GuardReason.OUT_OF_CREDITS) == ["view-plans", "stop"]


def test_legacy_default_token_budget_migrates_but_custom_value_is_preserved() -> None:
    assert TaskBudget.from_dict({}, legacy_tokens=40_000).max_fresh_tokens == DEFAULT_TOKEN_BUDGET
    assert TaskBudget.from_dict({}, legacy_tokens=275_000).max_fresh_tokens == 275_000
