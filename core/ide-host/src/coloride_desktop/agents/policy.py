from __future__ import annotations

import os
import posixpath
import shlex
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Iterable

from .domain import AgentMode, AgentSession
from .tools import ToolDefinition, ToolRisk, tool_catalog


COMMAND_CAPABILITIES = frozenset({"execute_command", "start_process", "stop_process", "run_terminal_command", "create_terminal"})


class PolicyOutcome(StrEnum):
    ALLOW = "ALLOW"
    ASK = "ASK"
    DENY = "DENY"


@dataclass(frozen=True, slots=True)
class AgentPolicy:
    sandbox: str
    approval_policy: str
    collaboration_mode: str
    automatic_decision: str | None


@dataclass(frozen=True, slots=True)
class ScopedGrant:
    capability: str
    executable: str = ""
    argument_class: str = ""
    cwd: str = ""
    connection_id: str = ""
    network_scope: str = "none"
    expires_at: datetime | None = None

    def is_active(self) -> bool:
        return self.expires_at is None or self.expires_at > datetime.now(UTC)

    def for_session(self) -> ScopedGrant:
        """Keep the same scope until the Coloride session boundary is invalidated."""
        return ScopedGrant(
            capability=self.capability,
            executable=self.executable,
            argument_class=self.argument_class,
            cwd=self.cwd,
            connection_id=self.connection_id,
            network_scope=self.network_scope,
            expires_at=None,
        )

    def for_all_commands_session(self) -> ScopedGrant:
        """Authorize every shell/process command on this connection for the session."""
        return ScopedGrant(
            capability="command:*",
            executable="*",
            argument_class="*",
            cwd="*",
            connection_id=self.connection_id,
            network_scope="*",
            expires_at=None,
        )

    def matches(self, other: ScopedGrant) -> bool:
        if not self.is_active():
            return False
        capability_matches = (
            self.capability == other.capability
            or self.capability == "*"
            or (
                self.capability == "command:*"
                and other.capability in COMMAND_CAPABILITIES
            )
        )
        if not capability_matches:
            return False
        return all(
            not expected or expected == "*" or expected == actual
            for expected, actual in (
                (self.executable, other.executable),
                (self.argument_class, other.argument_class),
                (self.cwd, other.cwd),
                (self.connection_id, other.connection_id),
                (self.network_scope, other.network_scope),
            )
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "executable": self.executable,
            "argumentClass": self.argument_class,
            "cwd": self.cwd,
            "connectionId": self.connection_id,
            "networkScope": self.network_scope,
            "expiresAt": self.expires_at.isoformat() if self.expires_at else None,
        }

    @classmethod
    def from_dict(cls, value: object) -> ScopedGrant | None:
        if not isinstance(value, dict):
            return None
        expires = value.get("expiresAt")
        expires_at: datetime | None = None
        if isinstance(expires, str) and expires:
            try:
                expires_at = datetime.fromisoformat(expires)
            except ValueError:
                expires_at = None
        capability = str(value.get("capability") or "").strip()
        if not capability:
            return None
        return cls(
            capability=capability,
            executable=str(value.get("executable") or ""),
            argument_class=str(value.get("argumentClass") or ""),
            cwd=str(value.get("cwd") or ""),
            connection_id=str(value.get("connectionId") or ""),
            network_scope=str(value.get("networkScope") or "none"),
            expires_at=expires_at,
        )


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    outcome: PolicyOutcome
    reason: str
    risk: str
    filesystem_scope: str
    network_scope: str
    suggested_grant: ScopedGrant | None = None


POLICIES: dict[AgentMode, AgentPolicy] = {
    AgentMode.ASK: AgentPolicy("read-only", "never", "ask", "decline"),
    AgentMode.PLAN: AgentPolicy("read-only", "never", "plan", "decline"),
    AgentMode.DEBUG: AgentPolicy("workspace-write", "on-request", "debug", None),
    AgentMode.ACT: AgentPolicy("workspace-write", "on-request", "default", None),
}


def policy_for(mode: AgentMode) -> AgentPolicy:
    return POLICIES[mode]


class PolicyEngine:
    """The only classifier between a model tool call and execution."""

    def evaluate(
        self,
        call: Any,
        session: AgentSession,
        definition: ToolDefinition,
        *,
        details: dict[str, Any] | None = None,
        grants: Iterable[ScopedGrant] = (),
    ) -> PolicyDecision:
        name = str(getattr(call, "name", "") or "")
        risk = definition.risk.value
        fs_scope = "workspace" if session.workspace_kind == "local" else session.filesystem_scope
        proposed = scoped_grant_for(call, session, definition, details=details)
        network_scope = proposed.network_scope

        if session.mode not in definition.modes:
            return PolicyDecision(
                PolicyOutcome.DENY,
                f"{name} is not available in {session.mode.value} mode",
                risk,
                fs_scope,
                network_scope,
            )
        if session.mode in {AgentMode.ASK, AgentMode.PLAN} and definition.risk in {
            ToolRisk.WRITE,
            ToolRisk.EXECUTE,
            ToolRisk.PRODUCTION,
        }:
            return PolicyDecision(
                PolicyOutcome.DENY,
                "This mode is read-only",
                risk,
                fs_scope,
                network_scope,
            )
        if definition.risk == ToolRisk.PRODUCTION:
            return PolicyDecision(
                PolicyOutcome.ASK,
                "Production operations always require explicit approval",
                risk,
                fs_scope,
                network_scope,
                proposed,
            )
        if any(grant.matches(proposed) for grant in grants):
            return PolicyDecision(
                PolicyOutcome.ALLOW,
                "A matching scoped grant is active",
                risk,
                fs_scope,
                network_scope,
                proposed,
            )
        if network_scope != "none":
            return PolicyDecision(
                PolicyOutcome.ASK,
                (
                    "Local network isolation is best-effort and requires approval"
                    if session.workspace_kind == "local"
                    else "This operation requests network access"
                ),
                risk,
                fs_scope,
                network_scope,
                proposed,
            )
        if definition.risk == ToolRisk.WRITE and session.access_level == "request":
            return PolicyDecision(
                PolicyOutcome.ASK,
                "Workspace mutation requires approval in Request approval",
                risk,
                fs_scope,
                network_scope,
                proposed,
            )
        if definition.risk == ToolRisk.EXECUTE and session.access_level != "full":
            return PolicyDecision(
                PolicyOutcome.ASK,
                "Command execution requires approval at this autonomy level",
                risk,
                fs_scope,
                network_scope,
                proposed,
            )
        return PolicyDecision(
            PolicyOutcome.ALLOW,
            "Allowed inside the configured Coloride perimeter",
            risk,
            fs_scope,
            network_scope,
            proposed,
        )

    def allow(self, call: Any, session: AgentSession) -> str:
        """Compatibility adapter for older callers/tests."""
        from .tools import TOOL_DEFINITIONS

        definition = next(
            (item for item in TOOL_DEFINITIONS if item.name == str(getattr(call, "name", ""))),
            None,
        )
        if definition is None:
            return "deny"
        outcome = self.evaluate(call, session, definition).outcome
        return {
            PolicyOutcome.ALLOW: "allow",
            PolicyOutcome.ASK: "approve",
            PolicyOutcome.DENY: "deny",
        }[outcome]


def scoped_grant_for(
    call: Any,
    session: AgentSession,
    definition: ToolDefinition,
    *,
    details: dict[str, Any] | None = None,
    ttl_minutes: int = 30,
) -> ScopedGrant:
    arguments = getattr(call, "arguments", None)
    args = arguments if isinstance(arguments, dict) else {}
    executable = ""
    argument_class = ""
    command = str(args.get("command") or args.get("cmd") or "").strip()
    if command:
        try:
            tokens = shlex.split(command)
        except ValueError:
            tokens = command.split()
        if tokens:
            executable = os.path.basename(tokens[0])
            argument_class = _argument_class(executable, tokens[1:])
    raw_cwd = str(args.get("cwd") or "").strip()
    if not raw_cwd:
        cwd = str(session.cwd or "/")
    elif raw_cwd.startswith("/"):
        cwd = raw_cwd
    else:
        cwd = posixpath.join(str(session.cwd or "/"), raw_cwd)
    cwd = posixpath.normpath(cwd) or "/"
    network = _network_scope(executable, argument_class, command, details or {})
    return ScopedGrant(
        capability=definition.name,
        executable=executable,
        argument_class=argument_class,
        cwd=cwd,
        connection_id=str(session.connection_id or "local"),
        network_scope=network,
        expires_at=datetime.now(UTC) + timedelta(minutes=max(1, ttl_minutes)),
    )


def _argument_class(executable: str, arguments: list[str]) -> str:
    semantic = [item for item in arguments if not item.startswith("-")]
    subcommand = semantic[0].lower() if semantic else "default"
    if executable in {"npm", "pnpm", "yarn", "bun", "pip", "pip3", "cargo", "git"}:
        return subcommand
    return "command"


def _network_scope(
    executable: str,
    argument_class: str,
    command: str,
    details: dict[str, Any],
) -> str:
    explicit = str(details.get("networkScope") or details.get("network_scope") or "").strip()
    if explicit in {"none", "package-registry", "configured-domains", "any"}:
        return explicit
    if executable in {"npm", "pnpm", "yarn", "bun", "pip", "pip3", "cargo"} and argument_class in {
        "install",
        "add",
        "update",
        "publish",
    }:
        return "package-registry"
    if executable == "git" and argument_class in {"clone", "fetch", "pull", "push"}:
        return "configured-domains"
    if executable in {"curl", "wget", "ssh", "scp", "rsync", "nc", "ncat"}:
        return "any"
    lowered = command.lower()
    if "http://" in lowered or "https://" in lowered:
        return "any"
    return "none"


AGENT_TOOLS: tuple[dict[str, object], ...] = tuple(tool_catalog())
