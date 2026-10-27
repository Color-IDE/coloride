from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal


def utc_now() -> datetime:
    return datetime.now(UTC)


class AgentMode(StrEnum):
    ASK = "ask"
    PLAN = "plan"
    DEBUG = "debug"
    ACT = "act"


class AgentSessionState(StrEnum):
    STARTING = "starting"
    IDLE = "idle"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting-approval"
    PAUSED_GUARD = "paused-guard"
    STOPPED = "stopped"
    FAILED = "failed"


class ApprovalState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class AgentPlanStepStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    SKIPPED = "skipped"


class AgentPlanStatus(StrEnum):
    DRAFTING = "drafting"
    READY = "ready"
    IMPLEMENTING = "implementing"
    COMPLETED = "completed"
    DISMISSED = "dismissed"


FILESYSTEM_SCOPES = frozenset({"workspace", "server"})

WorkspaceKind = Literal["local", "ssh"]
FilesystemScope = Literal["workspace", "server"]
AccessLevel = Literal["request", "agent", "full"]
ReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]
PreferredLinuxUser = Literal["admin", "coloride"]


def normalize_filesystem_scope(
    value: object,
    *,
    default: FilesystemScope = "workspace",
) -> FilesystemScope:
    raw = str(value or "").strip()
    if raw == "server":
        return "server"
    if raw == "workspace":
        return "workspace"
    return default


def normalize_workspace_kind(
    value: object,
    *,
    default: WorkspaceKind = "ssh",
) -> WorkspaceKind:
    raw = str(value or "").strip()
    if raw == "local":
        return "local"
    if raw == "ssh":
        return "ssh"
    return default


def normalize_access_level(
    value: object,
    *,
    default: AccessLevel = "request",
) -> AccessLevel:
    raw = str(value or "").strip()
    if raw == "agent":
        return "agent"
    if raw == "full":
        return "full"
    if raw == "request":
        return "request"
    return default


def normalize_reasoning_effort(value: object) -> ReasoningEffort:
    from .reasoning import normalize_reasoning_effort as snap_reasoning_effort

    snapped = snap_reasoning_effort(value)
    if snapped in {"none", "low", "medium", "high", "xhigh", "max"}:
        return snapped  # type: ignore[return-value]
    return "medium"


def normalize_preferred_linux_user(value: object) -> PreferredLinuxUser | None:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "admin":
            return "admin"
        if normalized == "coloride":
            return "coloride"
    return None


@dataclass(slots=True)
class AgentPlanStep:
    id: str
    title: str
    status: AgentPlanStepStatus = AgentPlanStepStatus.PENDING
    detail: str | None = None
    note: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "detail": self.detail,
            "status": self.status.value,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentPlanStep:
        return cls(
            id=str(value["id"]),
            title=str(value.get("title") or "").strip() or "Step",
            detail=_optional_string(value.get("detail")),
            status=AgentPlanStepStatus(
                str(value.get("status", AgentPlanStepStatus.PENDING.value))
            ),
            note=_optional_string(value.get("note")),
        )


@dataclass(slots=True)
class AgentPlan:
    plan_id: str
    session_id: str
    title: str
    steps: list[AgentPlanStep]
    status: AgentPlanStatus = AgentPlanStatus.READY
    summary: str | None = None
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    @classmethod
    def create(
        cls,
        *,
        session_id: str,
        title: str,
        steps: list[AgentPlanStep],
        summary: str | None = None,
        status: AgentPlanStatus = AgentPlanStatus.READY,
    ) -> AgentPlan:
        return cls(
            plan_id=f"plan_{secrets.token_hex(8)}",
            session_id=session_id,
            title=title,
            summary=summary,
            steps=steps,
            status=status,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.plan_id,
            "sessionId": self.session_id,
            "title": self.title,
            "summary": self.summary,
            "steps": [step.to_dict() for step in self.steps],
            "status": self.status.value,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentPlan:
        raw_steps = value.get("steps") or []
        steps = [
            AgentPlanStep.from_dict(item)
            for item in raw_steps
            if isinstance(item, dict)
        ]
        return cls(
            plan_id=str(value.get("id") or value.get("planId") or f"plan_{secrets.token_hex(4)}"),
            session_id=str(value["sessionId"]),
            title=str(value.get("title") or "Plan").strip() or "Plan",
            summary=_optional_string(value.get("summary")),
            steps=steps,
            status=AgentPlanStatus(str(value.get("status", AgentPlanStatus.READY.value))),
            created_at=_datetime(value.get("createdAt")),
            updated_at=_datetime(value.get("updatedAt")),
        )

    def refresh_completion(self) -> None:
        """Mark plan completed when every step is terminal."""
        if not self.steps:
            return
        terminal = {AgentPlanStepStatus.DONE, AgentPlanStepStatus.SKIPPED}
        if all(step.status in terminal for step in self.steps):
            self.status = AgentPlanStatus.COMPLETED


@dataclass(slots=True)
class AgentSession:
    session_id: str
    agent: str
    cwd: str
    mode: AgentMode
    workspace_kind: WorkspaceKind = "ssh"
    connection_id: str | None = None
    filesystem_scope: FilesystemScope = "workspace"
    access_level: AccessLevel = "request"
    task: str = ""
    state: AgentSessionState = AgentSessionState.STARTING
    provider_thread_id: str | None = None
    active_turn_id: str | None = None
    model: str | None = None
    spent_usd: float = 0.0
    budget_usd: float | None = None
    reasoning_effort: ReasoningEffort = "medium"
    preferred_linux_user: PreferredLinuxUser | None = None
    last_error: str | None = None
    active_plan_id: str | None = None
    archived: bool = False
    started_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    @classmethod
    def create(
        cls,
        *,
        agent: str,
        cwd: str,
        mode: AgentMode,
        access_level: str = "request",
        task: str = "",
        budget_usd: float | None = None,
        reasoning_effort: str = "medium",
        workspace_kind: str = "ssh",
        connection_id: str | None = None,
        filesystem_scope: str = "workspace",
    ) -> AgentSession:
        return cls(
            session_id=f"sess_{secrets.token_hex(8)}",
            agent=agent,
            cwd=cwd,
            workspace_kind=normalize_workspace_kind(workspace_kind),
            connection_id=connection_id,
            filesystem_scope=(
                "workspace"
                if normalize_workspace_kind(workspace_kind) == "local"
                else normalize_filesystem_scope(filesystem_scope)
            ),
            mode=mode,
            access_level=normalize_access_level(access_level),
            task=task,
            budget_usd=budget_usd,
            reasoning_effort=normalize_reasoning_effort(reasoning_effort),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "agent": self.agent,
            "cwd": self.cwd,
            "workspaceKind": self.workspace_kind,
            "connectionId": self.connection_id,
            "filesystemScope": self.filesystem_scope,
            "mode": self.mode.value,
            "accessLevel": self.access_level,
            "task": self.task,
            "state": self.state.value,
            "providerThreadId": self.provider_thread_id,
            "activeTurnId": self.active_turn_id,
            "model": self.model,
            "spentUsd": self.spent_usd,
            "budgetUsd": self.budget_usd,
            "reasoningEffort": self.reasoning_effort,
            "preferredLinuxUser": self.preferred_linux_user,
            "lastError": self.last_error,
            "activePlanId": self.active_plan_id,
            "archived": self.archived,
            "startedAt": self.started_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentSession:
        return cls(
            session_id=str(value["sessionId"]),
            agent=str(value["agent"]),
            cwd=str(value["cwd"]),
            workspace_kind=normalize_workspace_kind(value.get("workspaceKind")),
            connection_id=_optional_string(value.get("connectionId")),
            filesystem_scope=(
                "workspace"
                if normalize_workspace_kind(value.get("workspaceKind")) == "local"
                else normalize_filesystem_scope(value.get("filesystemScope"))
            ),
            # Sessions saved before Full access was removed remain usable, but
            # always resume under the approval-gated Act policy.
            mode=AgentMode(
                AgentMode.ACT.value
                if value.get("mode") == "autonomous"
                else str(value.get("mode", AgentMode.ACT.value))
            ),
            access_level=normalize_access_level(value.get("accessLevel")),
            task=str(value.get("task", "")),
            state=AgentSessionState(str(value.get("state", AgentSessionState.IDLE.value))),
            provider_thread_id=_optional_string(value.get("providerThreadId")),
            active_turn_id=_optional_string(value.get("activeTurnId")),
            model=_optional_string(value.get("model")),
            spent_usd=float(value.get("spentUsd", 0.0)),
            budget_usd=_optional_float(value.get("budgetUsd")),
            reasoning_effort=normalize_reasoning_effort(value.get("reasoningEffort")),
            preferred_linux_user=normalize_preferred_linux_user(value.get("preferredLinuxUser")),
            last_error=_optional_string(value.get("lastError")),
            active_plan_id=_optional_string(value.get("activePlanId")),
            archived=bool(value.get("archived", False)),
            started_at=_datetime(value.get("startedAt")),
            updated_at=_datetime(value.get("updatedAt")),
        )


@dataclass(slots=True)
class AgentEvent:
    event_id: str
    session_id: str
    sequence: int
    type: str
    data: dict[str, Any]
    created_at: datetime = field(default_factory=utc_now)

    @classmethod
    def create(
        cls,
        *,
        session_id: str,
        sequence: int,
        type: str,
        data: dict[str, Any],
    ) -> AgentEvent:
        return cls(
            event_id=f"evt_{secrets.token_hex(8)}",
            session_id=session_id,
            sequence=sequence,
            type=type,
            data=data,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.event_id,
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "type": self.type,
            "data": self.data,
            "createdAt": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentEvent:
        return cls(
            event_id=str(value["id"]),
            session_id=str(value["sessionId"]),
            sequence=int(value["sequence"]),
            type=str(value["type"]),
            data=dict(value.get("data") or {}),
            created_at=_datetime(value.get("createdAt")),
        )


@dataclass(slots=True)
class AgentApproval:
    approval_id: str
    session_id: str
    kind: str
    title: str
    details: dict[str, Any]
    state: ApprovalState = ApprovalState.PENDING
    created_at: datetime = field(default_factory=utc_now)
    resolved_at: datetime | None = None

    @classmethod
    def create(
        cls,
        *,
        session_id: str,
        kind: str,
        title: str,
        details: dict[str, Any],
    ) -> AgentApproval:
        return cls(
            approval_id=f"approval_{secrets.token_hex(8)}",
            session_id=session_id,
            kind=kind,
            title=title,
            details=details,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.approval_id,
            "sessionId": self.session_id,
            "kind": self.kind,
            "title": self.title,
            "details": self.details,
            "state": self.state.value,
            "createdAt": self.created_at.isoformat(),
            "resolvedAt": self.resolved_at.isoformat() if self.resolved_at else None,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> AgentApproval:
        return cls(
            approval_id=str(value["id"]),
            session_id=str(value["sessionId"]),
            kind=str(value["kind"]),
            title=str(value["title"]),
            details=dict(value.get("details") or {}),
            state=ApprovalState(str(value.get("state", ApprovalState.PENDING.value))),
            created_at=_datetime(value.get("createdAt")),
            resolved_at=_optional_datetime(value.get("resolvedAt")),
        )


def _datetime(value: object) -> datetime:
    parsed = _optional_datetime(value)
    return parsed or utc_now()


def _optional_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _optional_float(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None



