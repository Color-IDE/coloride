from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

LEGACY_DEFAULT_TOKEN_BUDGET = 40_000
DEFAULT_TOKEN_BUDGET = 1_000_000


@dataclass(slots=True)
class TaskBudget:
    """Extraordinary turn guards; normal work is progress-driven, not call-limited."""

    max_fresh_tokens: int = DEFAULT_TOKEN_BUDGET
    max_runtime_ms: int = 60 * 60 * 1_000
    max_hard_stops: int = 3
    max_consecutive_provider_errors: int = 5

    def to_dict(self) -> dict[str, int]:
        return {
            "maxFreshTokens": self.max_fresh_tokens,
            "maxRuntimeMs": self.max_runtime_ms,
            "maxHardStops": self.max_hard_stops,
            "maxConsecutiveProviderErrors": self.max_consecutive_provider_errors,
        }

    @classmethod
    def from_dict(cls, value: object, *, legacy_tokens: object = None) -> TaskBudget:
        raw = value if isinstance(value, dict) else {}
        legacy = _int(legacy_tokens, LEGACY_DEFAULT_TOKEN_BUDGET)
        # The old 40k value was the per-request context ceiling, not a real turn budget.
        migrated_tokens = DEFAULT_TOKEN_BUDGET if legacy == LEGACY_DEFAULT_TOKEN_BUDGET else legacy
        return cls(
            max_fresh_tokens=max(1, _int(raw.get("maxFreshTokens"), migrated_tokens)),
            max_runtime_ms=max(1_000, _int(raw.get("maxRuntimeMs"), 60 * 60 * 1_000)),
            max_hard_stops=max(1, _int(raw.get("maxHardStops"), 3)),
            max_consecutive_provider_errors=max(
                1, _int(raw.get("maxConsecutiveProviderErrors"), 5)
            ),
        )


@dataclass(slots=True)
class TaskBudgetUsage:
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    fresh_tokens: int = 0
    model_calls: int = 0
    tool_calls: int = 0
    runtime_ms: int = 0
    consecutive_provider_errors: int = 0

    def record_model_usage(self, *, input_tokens: int, cached_tokens: int, output_tokens: int) -> None:
        input_tokens = max(0, int(input_tokens or 0))
        cached_tokens = min(input_tokens, max(0, int(cached_tokens or 0)))
        output_tokens = max(0, int(output_tokens or 0))
        self.input_tokens += input_tokens
        self.cached_input_tokens += cached_tokens
        self.output_tokens += output_tokens
        self.fresh_tokens += max(0, input_tokens - cached_tokens) + output_tokens
        self.model_calls += 1
        self.consecutive_provider_errors = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "inputTokens": self.input_tokens,
            "cachedInputTokens": self.cached_input_tokens,
            "outputTokens": self.output_tokens,
            "freshTokens": self.fresh_tokens,
            "modelCalls": self.model_calls,
            "toolCalls": self.tool_calls,
            "runtimeMs": self.runtime_ms,
            "consecutiveProviderErrors": self.consecutive_provider_errors,
        }

    @classmethod
    def from_dict(cls, value: object) -> TaskBudgetUsage:
        raw = value if isinstance(value, dict) else {}
        return cls(
            input_tokens=max(0, _int(raw.get("inputTokens"), 0)),
            cached_input_tokens=max(0, _int(raw.get("cachedInputTokens"), 0)),
            output_tokens=max(0, _int(raw.get("outputTokens"), 0)),
            fresh_tokens=max(0, _int(raw.get("freshTokens"), 0)),
            model_calls=max(0, _int(raw.get("modelCalls"), 0)),
            tool_calls=max(0, _int(raw.get("toolCalls"), 0)),
            runtime_ms=max(0, _int(raw.get("runtimeMs"), 0)),
            consecutive_provider_errors=max(
                0, _int(raw.get("consecutiveProviderErrors"), 0)
            ),
        )


@dataclass(slots=True)
class ProgressState:
    files_discovered: list[str] = field(default_factory=list)
    files_read: list[str] = field(default_factory=list)
    files_modified: list[str] = field(default_factory=list)
    result_fingerprints: list[str] = field(default_factory=list)
    diff_hashes: list[str] = field(default_factory=list)
    error_signatures: list[str] = field(default_factory=list)
    last_test_failures: int | None = None
    progress_events: int = 0
    no_progress_iterations: int = 0
    loop_score: int = 0
    strategy_id: int = 1
    soft_replans: int = 0
    hard_stops: int = 0
    hard_stops_baseline: int = 0
    avoid_action_fingerprints: list[str] = field(default_factory=list)
    require_new_strategy_action: bool = False
    action_result_counts: dict[str, int] = field(default_factory=dict)
    soft_replan_no_progress_at: int | None = None
    recent_no_progress_call_ids: list[str] = field(default_factory=list)
    superseded_call_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "filesDiscovered": self.files_discovered[-64:],
            "filesRead": self.files_read[-64:],
            "filesModified": self.files_modified[-64:],
            "resultFingerprints": self.result_fingerprints[-64:],
            "diffHashes": self.diff_hashes[-32:],
            "errorSignatures": self.error_signatures[-32:],
            "lastTestFailures": self.last_test_failures,
            "progressEvents": self.progress_events,
            "noProgressIterations": self.no_progress_iterations,
            "loopScore": self.loop_score,
            "strategyId": self.strategy_id,
            "softReplans": self.soft_replans,
            "hardStops": self.hard_stops,
            "hardStopsBaseline": self.hard_stops_baseline,
            "avoidActionFingerprints": self.avoid_action_fingerprints[-16:],
            "requireNewStrategyAction": self.require_new_strategy_action,
            "actionResultCounts": dict(list(self.action_result_counts.items())[-64:]),
            "softReplanNoProgressAt": self.soft_replan_no_progress_at,
            "recentNoProgressCallIds": self.recent_no_progress_call_ids[-32:],
            "supersededCallIds": self.superseded_call_ids[-128:],
        }

    @classmethod
    def from_dict(cls, value: object) -> ProgressState:
        raw = value if isinstance(value, dict) else {}
        last_failures = raw.get("lastTestFailures")
        return cls(
            files_discovered=_string_list(raw.get("filesDiscovered"), 64),
            files_read=_string_list(raw.get("filesRead"), 64),
            files_modified=_string_list(raw.get("filesModified"), 64),
            result_fingerprints=_string_list(raw.get("resultFingerprints"), 64),
            diff_hashes=_string_list(raw.get("diffHashes"), 32),
            error_signatures=_string_list(raw.get("errorSignatures"), 32),
            last_test_failures=(
                _int(last_failures, 0) if last_failures is not None else None
            ),
            progress_events=max(0, _int(raw.get("progressEvents"), 0)),
            no_progress_iterations=max(0, _int(raw.get("noProgressIterations"), 0)),
            loop_score=max(0, _int(raw.get("loopScore"), 0)),
            strategy_id=max(1, _int(raw.get("strategyId"), 1)),
            soft_replans=max(0, _int(raw.get("softReplans"), 0)),
            hard_stops=max(0, _int(raw.get("hardStops"), 0)),
            hard_stops_baseline=max(0, _int(raw.get("hardStopsBaseline"), 0)),
            avoid_action_fingerprints=_string_list(
                raw.get("avoidActionFingerprints"), 16
            ),
            require_new_strategy_action=bool(raw.get("requireNewStrategyAction", False)),
            action_result_counts={
                str(key): max(0, _int(count, 0))
                for key, count in list(
                    (raw.get("actionResultCounts") or {}).items()
                    if isinstance(raw.get("actionResultCounts"), dict)
                    else []
                )[-64:]
                if str(key)
            },
            soft_replan_no_progress_at=(
                max(0, _int(raw.get("softReplanNoProgressAt"), 0))
                if raw.get("softReplanNoProgressAt") is not None
                else None
            ),
            recent_no_progress_call_ids=_string_list(
                raw.get("recentNoProgressCallIds"), 32
            ),
            superseded_call_ids=_string_list(raw.get("supersededCallIds"), 128),
        )


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AgentTaskStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    PAUSED_GUARD = "paused-guard"
    DONE = "done"
    FAILED = "failed"


class AgentTaskPhase(StrEnum):
    IDLE = "idle"
    RECAP = "recap"
    INVESTIGATION = "investigation"
    IMPLEMENTATION = "implementation"
    VERIFICATION = "verification"


_READ_TOOLS = frozenset(
    {
        "read_file",
        "list_files",
        "search_files",
        "search_chat_history",
        "read_tool_output",
        "git_status",
        "git_diff",
        "get_diagnostics",
        "fetch_url",
    }
)
_WRITE_TOOLS = frozenset(
    {
        "write_file",
        "replace_in_file",
        "create_directory",
        "rename_path",
        "move_path",
        "delete_path",
    }
)
_VERIFY_TOOLS = frozenset({"execute_command", "start_process", "get_diagnostics"})


@dataclass(slots=True)
class AgentTask:
    """Working memory for the current job. Independent of the message array."""

    task_id: str
    conversation_id: str
    workspace_id: str
    status: AgentTaskStatus = AgentTaskStatus.IDLE
    goal: str = ""
    phase: AgentTaskPhase = AgentTaskPhase.IDLE
    current_objective: str = ""
    current_step: str = ""
    last_action: str = ""
    hypothesis: str = ""
    files_inspected: list[str] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    active_symbols: list[str] = field(default_factory=list)
    recent_commands: list[str] = field(default_factory=list)
    unresolved_questions: list[str] = field(default_factory=list)
    important_observations: list[dict[str, Any]] = field(default_factory=list)
    consolidated_observation_count: int = 0
    decisions: list[str] = field(default_factory=list)
    last_error: str = ""
    next_action: str = ""
    completion: dict[str, Any] = field(default_factory=dict)
    verification_required: bool = False
    verification_attempted: bool = False
    token_budget: int = DEFAULT_TOKEN_BUDGET
    budget: TaskBudget = field(default_factory=TaskBudget)
    budget_usage: TaskBudgetUsage = field(default_factory=TaskBudgetUsage)
    progress: ProgressState = field(default_factory=ProgressState)
    scoped_grants: list[dict[str, Any]] = field(default_factory=list)
    guard_pause: dict[str, Any] | None = None
    cost_budget_usd: float | None = None
    spent_usd: float = 0.0
    turn_index: int = 0
    created_at: datetime = field(default_factory=_utc_now)
    updated_at: datetime = field(default_factory=_utc_now)

    @classmethod
    def create(
        cls,
        *,
        conversation_id: str,
        workspace_id: str,
        goal: str = "",
        cost_budget_usd: float | None = None,
    ) -> AgentTask:
        return cls(
            task_id=f"task_{secrets.token_hex(8)}",
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            goal=goal.strip(),
            cost_budget_usd=cost_budget_usd,
        )

    def remember_path(self, path: str, *, changed: bool = False) -> None:
        cleaned = str(path or "").strip()
        if not cleaned or cleaned in {".", "/"}:
            return
        target = self.files_changed if changed else self.files_inspected
        if cleaned not in target:
            target.append(cleaned)
            if len(target) > 24:
                del target[:-24]

    def remember_decision(self, decision: str) -> None:
        line = " ".join(str(decision or "").split())[:180]
        if not line:
            return
        if line not in self.decisions:
            self.decisions.append(line)
        if len(self.decisions) > 8:
            del self.decisions[:-8]

    def remember_observation(self, observation: dict[str, Any]) -> None:
        observation_id = str(observation.get("observation_id") or "")
        if observation_id and any(
            str(item.get("observation_id") or "") == observation_id
            for item in self.important_observations
        ):
            return
        self.important_observations.append(dict(observation))
        if len(self.important_observations) > 24:
            removed = len(self.important_observations) - 24
            del self.important_observations[:removed]
            self.consolidated_observation_count = max(
                0, self.consolidated_observation_count - removed
            )

    def remember_command(self, command: str) -> None:
        cleaned = " ".join(str(command or "").split())[:240]
        if cleaned and cleaned not in self.recent_commands:
            self.recent_commands.append(cleaned)
        if len(self.recent_commands) > 8:
            del self.recent_commands[:-8]

    def note_action(
        self,
        tool_name: str,
        *,
        path: str = "",
        failed: bool = False,
        verified: bool = False,
    ) -> None:
        name = str(tool_name or "tool").strip() or "tool"
        target = str(path or "").strip()
        if name in _WRITE_TOOLS and target:
            self.last_action = f"edit {target}"
            self.phase = AgentTaskPhase.IMPLEMENTATION
            self.current_objective = self.current_objective or f"Apply changes to {target}"
            self.next_action = "Validate the change"
            if not failed:
                self.verification_required = True
                self.verification_attempted = False
        elif name in _VERIFY_TOOLS:
            self.last_action = f"run {name}" + (f" in {target}" if target else "")
            self.phase = AgentTaskPhase.VERIFICATION
            self.next_action = "Inspect the result"
        elif name in _READ_TOOLS:
            self.last_action = f"read {target}" if target else name
            if self.phase in {AgentTaskPhase.IDLE, AgentTaskPhase.RECAP}:
                self.phase = AgentTaskPhase.INVESTIGATION
            if target and not self.current_objective:
                self.current_objective = f"Inspect {target}"
            self.next_action = "Continue investigation"
        else:
            self.last_action = f"{name} {target}".strip()
            self.next_action = "continue"
        self.current_step = self.last_action
        if verified and not failed:
            self.verification_required = False
            self.verification_attempted = True
        if failed:
            self.next_action = "Inspect the error and recover"

    def prompt_block(self) -> str:
        inspected = ", ".join(self.files_inspected[-12:]) or "(none)"
        changed = ", ".join(self.files_changed[-12:]) or "(none)"
        decisions = "; ".join(self.decisions[-6:]) or "(none)"
        symbols = ", ".join(self.active_symbols[-12:]) or "(none)"
        commands = "; ".join(self.recent_commands[-4:]) or "(none)"
        unresolved = "; ".join(self.unresolved_questions[-6:]) or "(none)"
        return (
            "CURRENT TASK\n"
            f"Goal: {self.goal or '(not stated)'}\n"
            f"Phase: {self.phase.value}\n"
            f"Current objective: {self.current_objective or '(none)'}\n"
            f"Last action: {self.last_action or self.current_step or '(none)'}\n"
            f"Next: {self.next_action or '(none)'}\n\n"
            "TASK STATE\n"
            f"Hypothesis: {self.hypothesis or '(none)'}\n"
            f"Files inspected: {inspected}\n"
            f"Files changed: {changed}\n"
            f"Active symbols: {symbols}\n"
            f"Recent commands: {commands}\n"
            f"Decisions: {decisions}\n"
            f"Unresolved: {unresolved}\n"
            f"Last error: {self.last_error or '(none)'}\n"
            f"Post-change validation pending: {'yes' if self.verification_required else 'no'}\n"
            f"Turn: {self.turn_index}\n"
            f"TASK COMPLETION: {self.completion}"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "taskId": self.task_id,
            "conversationId": self.conversation_id,
            "workspaceId": self.workspace_id,
            "status": self.status.value,
            "goal": self.goal,
            "phase": self.phase.value,
            "currentObjective": self.current_objective,
            "currentStep": self.current_step,
            "lastAction": self.last_action,
            "hypothesis": self.hypothesis,
            "filesInspected": list(self.files_inspected),
            "filesChanged": list(self.files_changed),
            "activeSymbols": list(self.active_symbols),
            "recentCommands": list(self.recent_commands),
            "unresolvedQuestions": list(self.unresolved_questions),
            "importantObservations": list(self.important_observations),
            "consolidatedObservationCount": self.consolidated_observation_count,
            "decisions": list(self.decisions),
            "lastError": self.last_error,
            "nextAction": self.next_action,
            "completion": self.completion,
            "verificationRequired": self.verification_required,
            "verificationAttempted": self.verification_attempted,
            "tokenBudget": self.token_budget,
            "budget": self.budget.to_dict(),
            "budgetUsage": self.budget_usage.to_dict(),
            "progress": self.progress.to_dict(),
            "scopedGrants": list(self.scoped_grants),
            "guardPause": self.guard_pause,
            "costBudgetUsd": self.cost_budget_usd,
            "spentUsd": self.spent_usd,
            "turnIndex": self.turn_index,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentTask:
        status_raw = str(value.get("status") or AgentTaskStatus.IDLE.value).replace(
            "paused_guard", "paused-guard"
        )
        try:
            status = AgentTaskStatus(status_raw)
        except ValueError:
            status = AgentTaskStatus.IDLE
        phase_raw = str(value.get("phase") or AgentTaskPhase.IDLE.value)
        try:
            phase = AgentTaskPhase(phase_raw)
        except ValueError:
            phase = AgentTaskPhase.IDLE
        last_action = str(value.get("lastAction") or value.get("last_action") or "")
        current_step = str(value.get("currentStep") or last_action or "")
        return cls(
            task_id=str(value.get("taskId") or f"task_{secrets.token_hex(4)}"),
            conversation_id=str(value.get("conversationId") or ""),
            workspace_id=str(value.get("workspaceId") or ""),
            status=status,
            goal=str(value.get("goal") or ""),
            phase=phase,
            current_objective=str(value.get("currentObjective") or value.get("current_objective") or ""),
            current_step=current_step,
            last_action=last_action or current_step,
            hypothesis=str(value.get("hypothesis") or ""),
            files_inspected=_string_list(value.get("filesInspected")),
            files_changed=_string_list(value.get("filesChanged")),
            active_symbols=_string_list(value.get("activeSymbols"), limit=24),
            recent_commands=_string_list(value.get("recentCommands"), limit=8),
            unresolved_questions=_string_list(value.get("unresolvedQuestions"), limit=12),
            important_observations=_dict_list(value.get("importantObservations"), limit=24),
            consolidated_observation_count=_int(
                value.get("consolidatedObservationCount"), 0
            ),
            decisions=_string_list(value.get("decisions"), limit=8),
            last_error=str(value.get("lastError") or ""),
            next_action=str(value.get("nextAction") or ""),
            completion=dict(value.get("completion") or {}),
            verification_required=bool(value.get("verificationRequired", False)),
            verification_attempted=bool(value.get("verificationAttempted", False)),
            token_budget=TaskBudget.from_dict(
                value.get("budget"), legacy_tokens=value.get("tokenBudget")
            ).max_fresh_tokens,
            budget=TaskBudget.from_dict(
                value.get("budget"), legacy_tokens=value.get("tokenBudget")
            ),
            budget_usage=TaskBudgetUsage.from_dict(value.get("budgetUsage")),
            progress=ProgressState.from_dict(value.get("progress")),
            scoped_grants=_dict_list(value.get("scopedGrants"), limit=64),
            guard_pause=_optional_dict(value.get("guardPause")),
            cost_budget_usd=_optional_float(value.get("costBudgetUsd")),
            spent_usd=float(value.get("spentUsd") or 0.0),
            turn_index=_int(value.get("turnIndex"), 0),
            created_at=_datetime(value.get("createdAt")),
            updated_at=_datetime(value.get("updatedAt")),
        )


def _string_list(value: object, limit: int = 24) -> list[str]:
    if not isinstance(value, list):
        return []
    items = [str(item).strip() for item in value if str(item).strip()]
    return items[:limit]


def _dict_list(value: object, limit: int = 64) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in (_optional_dict(entry) for entry in value) if item is not None][:limit]


def _optional_dict(value: object) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    return {str(key): item for key, item in value.items()}


def _int(value: object, default: int) -> int:
    try:
        if isinstance(value, (int, float, str)):
            return int(value)
        return default
    except (TypeError, ValueError):
        return default


def _optional_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float, str)):
            return float(value)
        return None
    except (TypeError, ValueError):
        return None


def _datetime(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return _utc_now()
