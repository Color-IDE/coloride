"""Persisted and wire models for external ACP agents."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


DistributionKind = Literal["npx", "uvx", "binary"]
InstallationStatus = Literal["installed", "installing", "failed", "missing-runtime"]
ConnectionPhase = Literal[
    "installed",
    "starting",
    "needs-login",
    "authenticating",
    "ready",
    "failed",
    "closed",
    "unsupported",
]
TurnState = Literal["idle", "running", "cancelling"]
AuthMethodType = Literal["agent", "terminal", "env"]


class AuthMethodRecord(BaseModel):
    id: str
    name: str
    description: str | None = None
    type: AuthMethodType
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


class ConfigChoice(BaseModel):
    value: str
    name: str
    description: str | None = None
    group: str | None = None
    group_name: str | None = Field(default=None, alias="groupName")

    model_config = {"populate_by_name": True}


class ConfigOptionRecord(BaseModel):
    id: str
    name: str
    description: str | None = None
    category: str | None = None
    type: Literal["select", "boolean"]
    current_value: str | bool = Field(alias="currentValue")
    options: list[ConfigChoice] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class InstallationRecord(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    name: str
    version: str
    distribution: DistributionKind
    status: InstallationStatus
    error: str | None = None
    installed_at: str | None = Field(default=None, alias="installedAt")
    package_spec: str | None = Field(default=None, alias="packageSpec")
    executable: str | None = None
    args: list[str] = Field(default_factory=list)
    location: str | None = None

    model_config = {"populate_by_name": True}


class RegistryEntryRecord(BaseModel):
    id: str
    name: str
    version: str
    description: str = ""
    repository: str | None = None
    license: str | None = None
    license_url: str | None = Field(default=None, alias="licenseUrl")
    icon: str | None = None
    distribution_kind: DistributionKind = Field(alias="distributionKind")
    package_spec: str | None = Field(default=None, alias="packageSpec")
    command: list[str] = Field(default_factory=list)
    archive_url: str | None = None
    archive_sha256: str | None = None
    installed: bool = False
    installed_version: str | None = Field(default=None, alias="installedVersion")

    model_config = {"populate_by_name": True}


class SessionRecord(BaseModel):
    id: str
    agent_id: str = Field(alias="agentId")
    installation_id: str = Field(alias="installationId")
    installation_version: str = Field(alias="installationVersion")
    acp_session_id: str | None = Field(default=None, alias="acpSessionId")
    workspace_path: str = Field(alias="workspacePath")
    execution_target: Literal["local"] = Field(default="local", alias="executionTarget")
    title: str = "Codex"
    phase: ConnectionPhase = "installed"
    turn: TurnState = "idle"
    process_id: str | None = Field(default=None, alias="processId")
    supports_load: bool = Field(default=False, alias="supportsLoad")
    auth_methods: list[AuthMethodRecord] = Field(default_factory=list, alias="authMethods")
    config_options: list[ConfigOptionRecord] = Field(default_factory=list, alias="configOptions")
    pending_config: dict[str, str | bool] = Field(default_factory=dict, alias="pendingConfig")
    error: str | None = None
    last_sequence: int = Field(default=0, alias="lastSequence")
    updated_at: str = Field(default_factory=utc_now, alias="updatedAt")

    model_config = {"populate_by_name": True}

    def public(self) -> dict[str, Any]:
        payload = self.model_dump(by_alias=True)
        for key in ("configOptions", "pendingConfig", "lastSequence"):
            payload.pop(key, None)
        return payload


class StoredEvent(BaseModel):
    session_id: str = Field(alias="sessionId")
    sequence: int
    update: dict[str, Any]
    created_at: str = Field(default_factory=utc_now, alias="createdAt")

    model_config = {"populate_by_name": True}


class PermissionRecord(BaseModel):
    request_id: str = Field(alias="requestId")
    session_id: str = Field(alias="sessionId")
    tool_call_id: str | None = Field(default=None, alias="toolCallId")
    title: str | None = None
    kind: str | None = None
    options: list[dict[str, str]] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class InstallRequest(BaseModel):
    agent_id: str = Field(alias="agentId")
    version: str | None = None

    model_config = {"populate_by_name": True}


class OpenSessionRequest(BaseModel):
    session_id: str | None = Field(default=None, alias="sessionId")
    agent_id: str = Field(default="codex-acp", alias="agentId")
    workspace_path: str = Field(alias="workspacePath")
    execution_target: Literal["local"] = Field(default="local", alias="executionTarget")

    model_config = {"populate_by_name": True}


class AuthenticateRequestBody(BaseModel):
    method_id: str = Field(alias="methodId")

    model_config = {"populate_by_name": True}


class ConfigPatch(BaseModel):
    config_id: str = Field(alias="configId")
    value: str | bool

    model_config = {"populate_by_name": True}


class PromptBody(BaseModel):
    text: str


class PermissionDecision(BaseModel):
    option_id: str | None = Field(default=None, alias="optionId")
    outcome: Literal["selected", "cancelled"] = "selected"

    model_config = {"populate_by_name": True}
