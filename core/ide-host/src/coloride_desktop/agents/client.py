from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import secrets
import time
from collections.abc import Awaitable, Callable
from pathlib import PurePosixPath
from typing import Any, cast

from ..browser import BrowserService
from ..files.local import WorkspaceFileService
from ..files.search import ProjectSearchService
from ..files.service import RemoteFileService
from ..models import AgentInfo, AgentPlanModel, SessionSummary, TaskBudgetModel, TaskBudgetUsageModel
from .config import AgentConfigStore, AgentProviderSettings
from .debug_log import agent_debug, log_agent_emit, read_agent_debug_records, write_agent_dump
from .domain import (
    AgentApproval,
    AgentMode,
    AgentPlan,
    AgentPlanStatus,
    AgentPlanStep,
    AgentPlanStepStatus,
    AgentSession,
    AgentSessionState,
    ApprovalState,
    normalize_access_level,
    normalize_filesystem_scope,
    normalize_preferred_linux_user,
    normalize_reasoning_effort,
    normalize_workspace_kind,
    utc_now,
)
from .engine import ColorideAgentEngine
from .evals import evaluate_session
from .loop_detect import analyze_event_records
from .policy import COMMAND_CAPABILITIES, ScopedGrant
from .project_memory import ProjectMemoryRegistry
from .provider import (
    AgentModelProvider,
    ModelToolCall,
)
from .store import AgentSessionStore
from .task import AgentTaskStatus, TaskBudget
from .telemetry import AgentTelemetryStore
from .tools import RemoteWorkspaceTools, tool_catalog

Publish = Callable[[str, dict[str, object]], Awaitable[None]]
AgentFileService = WorkspaceFileService | RemoteFileService
RunCommand = Callable[[str], Awaitable[object]]
ProviderFactory = Callable[[], Awaitable[AgentModelProvider]]

_SSH_WORKSPACE_INVALIDATED_ERROR = (
    "This chat workspace is no longer authorized for the active SSH profile. "
    "Choose or prepare an allowed workspace before continuing."
)


class AgentTurnActiveError(RuntimeError):
    pass


class AgentProxyClient:
    """Coordinate Coloride's native model loop, tools, approvals and session history."""

    def __init__(
        self,
        run_command: RunCommand | None = None,
        publish: Publish | None = None,
        files: AgentFileService | None = None,
        browsers: BrowserService | None = None,
        store: AgentSessionStore | None = None,
        config: AgentConfigStore | None = None,
        provider_factory: ProviderFactory | None = None,
        telemetry: AgentTelemetryStore | None = None,
    ) -> None:
        self._publish = publish
        self._store = store or AgentSessionStore()
        self._project_memory = ProjectMemoryRegistry(
            self._store.root.parent / "project-memory"
        )
        self._config = config or AgentConfigStore()
        self._provider_factory = provider_factory
        self._telemetry = telemetry or AgentTelemetryStore()
        self._browsers = browsers
        self._files = files
        self._tools = (
            RemoteWorkspaceTools(
                files=files,
                run_command=run_command,
                browsers=browsers,
                store=self._store,
                on_plan_updated=self._on_plan_updated,
            )
            if files is not None and run_command is not None
            else None
        )
        if self._tools is not None:
            self._tools.bind_project_memory(self._project_memory)
        self._turn_tasks: dict[str, asyncio.Task[None]] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._approval_waiters: dict[str, asyncio.Future[str]] = {}
        self._session_grants: dict[str, list[ScopedGrant]] = {}
        self._production_resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None = None

    def bind_terminals(self, terminals: Any) -> None:
        if self._tools is not None:
            self._tools.terminals = terminals

    def bind_production(
        self,
        *,
        resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None,
        controller: Any | None,
    ) -> None:
        self._production_resolver = resolver
        if self._tools is not None:
            self._tools.bind_production(resolver=resolver, controller=controller)

    def bind_filesystem_roots(
        self,
        resolver: Callable[[AgentSession], Awaitable[dict[str, Any] | None]] | None,
    ) -> None:
        if self._tools is not None:
            self._tools.bind_filesystem_roots(resolver)

    def bind_lsp(self, registry: Any | None) -> None:
        if self._tools is None or registry is None:
            return

        async def symbols(session: AgentSession, path: str) -> list[dict[str, Any]]:
            return await registry.document_symbols(session.cwd, path)

        self._tools.bind_symbol_provider(symbols)

    def bind_search(self, service: ProjectSearchService) -> None:
        if self._tools is not None:
            self._tools.search_service = service

    async def forget_server_memory(self, connection_id: str) -> int:
        return await asyncio.to_thread(
            self._project_memory.purge_connection,
            connection_id,
        )

    @property
    def config(self) -> AgentConfigStore:
        return self._config

    async def available(self) -> list[AgentInfo]:
        status = await self._config.status()
        configured = bool(status["configured"])
        return [
            AgentInfo(
                id="coloride",
                name="Coloride Agent",
                version=str(status["model"]),
                installed=True,
                needsKey=not configured,
                supported=True,
            )
        ]

    async def start_session(
        self,
        *,
        agent: str,
        task: str | None,
        cwd: str,
        budget_usd: float | None,
        budget: dict[str, Any] | None = None,
        mode: AgentMode = AgentMode.ACT,
        access_level: str = "request",
        reasoning_effort: str = "medium",
        attachments: list[dict[str, Any]] | None = None,
        plugin_ids: list[str] | None = None,
        workspace_kind: str = "ssh",
        connection_id: str | None = None,
        filesystem_scope: str = "workspace",
    ) -> str:
        if agent != "coloride":
            raise ValueError(f"Agent provider {agent!r} is not supported")
        self._validate_workspace(cwd)
        provider = await self._create_provider(reasoning_effort=reasoning_effort)
        session = AgentSession.create(
            agent="coloride",
            cwd=cwd,
            mode=mode,
            access_level=access_level,
            task="",
            budget_usd=budget_usd,
            reasoning_effort=reasoning_effort,
            workspace_kind=workspace_kind,
            connection_id=connection_id,
            filesystem_scope=filesystem_scope,
        )
        session.model = provider.model
        self._store.save_session(session)
        agent_task = self._store.ensure_task(session)
        if budget:
            agent_task.budget = TaskBudget.from_dict(budget)
            agent_task.token_budget = agent_task.budget.max_fresh_tokens
            self._store.save_task(agent_task)
        if self._tools is not None:
            self._tools.set_session_plugins(session.session_id, plugin_ids)
        if (
            session.workspace_kind == "local"
            and self._files is not None
            and hasattr(self._files, "authorize_local_session")
        ):
            session.cwd = cast(WorkspaceFileService, self._files).authorize_local_session(
                session.session_id,
                session.cwd,
            )
            self._store.save_session(session)
        await self._emit_state(session, AgentSessionState.IDLE)
        if self._tools is not None:
            await self._tools.warm_search(session)
        if (task and task.strip()) or attachments:
            await self.send(
                session.session_id,
                task or "",
                reasoning_effort=reasoning_effort,
                attachments=attachments,
            )
        return session.session_id

    async def list_sessions(
        self,
        *,
        cwd: str | None = None,
        workspace_kind: str | None = None,
        connection_id: str | None = None,
        filesystem_scope: str | None = None,
    ) -> list[SessionSummary]:
        """Return history for one workspace when a root is supplied.

        Agent history is stored locally on the Mac, but it must not bleed from a
        VPS workspace into a local folder (or into a different VPS project).
        """
        normalized_cwd = _normalize_workspace_cwd(cwd) if cwd else None
        sessions = self._store.list_sessions()
        if normalized_cwd is not None:
            sessions = [
                session
                for session in sessions
                if _normalize_workspace_cwd(session.cwd) == normalized_cwd
            ]
        if workspace_kind in {"local", "ssh"}:
            sessions = [session for session in sessions if session.workspace_kind == workspace_kind]
        if connection_id is not None:
            sessions = [session for session in sessions if session.connection_id == connection_id]
        if filesystem_scope in {"workspace", "server"}:
            sessions = [
                session
                for session in sessions
                if normalize_filesystem_scope(session.filesystem_scope) == filesystem_scope
            ]
        return [self._summary(session) for session in sessions]

    async def history_details(self, session_ids: list[str], query: str = "") -> list[dict[str, Any]]:
        def collect() -> list[dict[str, Any]]:
            return [self._store.history_details(session_id, query) for session_id in session_ids]
        return await asyncio.to_thread(collect)

    async def get_session(self, session_id: str) -> SessionSummary | None:
        session = self._store.get_session(session_id)
        return self._summary(session) if session else None

    async def set_workspace(
        self,
        session_id: str,
        *,
        cwd: str,
        workspace_kind: str,
        connection_id: str | None,
    ) -> SessionSummary | None:
        self._validate_workspace(cwd)
        session = self._store.get_session(session_id)
        if session is None:
            return None
        if session_id in self._turn_tasks:
            raise AgentTurnActiveError("Stop the active turn before changing its workspace")
        session.cwd = cwd.rstrip("/") or "/"
        session.workspace_kind = normalize_workspace_kind(workspace_kind)
        session.connection_id = connection_id
        self._clear_session_grants(session_id)
        if self._files is not None and hasattr(self._files, "revoke_session"):
            cast(WorkspaceFileService, self._files).revoke_session(session_id)
        if (
            session.workspace_kind == "local"
            and self._files is not None
            and hasattr(self._files, "authorize_local_session")
        ):
            session.cwd = cast(WorkspaceFileService, self._files).authorize_local_session(
                session_id,
                session.cwd,
            )
        self._store.save_session(session)
        await self._emit(session_id, "workspace_changed", {"cwd": session.cwd})
        if self._tools is not None:
            await self._tools.warm_search(session)
        return self._summary(session)

    async def invalidate_connection(self, connection_id: str | None) -> None:
        if self._tools is not None and self._tools.search_service is not None:
            await self._tools.search_service.disconnect(connection_id)
        if not connection_id:
            return
        for session in self._store.list_sessions():
            if session.workspace_kind != "ssh" or session.connection_id != connection_id:
                continue
            if session.session_id in self._turn_tasks:
                with contextlib.suppress(Exception):
                    await self.stop_session(session.session_id)
            self._clear_session_grants(session.session_id)

    async def reconcile_ssh_workspaces(
        self,
        *,
        connection_id: str,
        allowed_roots: list[str] | tuple[str, ...],
        migrations: dict[str, str] | None = None,
    ) -> dict[str, object]:
        """Move matching workspace trees and invalidate SSH chats outside current grants.

        Production preparation removes the live source from the Linux/user allow-list.
        Chats rooted at that source or one of its descendants can safely follow the
        prepared copy while preserving their relative path. Any other revoked path
        must stop until the user explicitly authorizes it again.
        """
        normalized_migrations: list[tuple[PurePosixPath, PurePosixPath]] = []
        for source, target in (migrations or {}).items():
            self._validate_workspace(source)
            self._validate_workspace(target)
            normalized_migrations.append((PurePosixPath(source), PurePosixPath(target)))
        normalized_migrations.sort(key=lambda item: len(item[0].parts), reverse=True)
        migrated: list[str] = []
        invalidated: list[str] = []
        reauthorized: list[str] = []

        for stored in self._store.list_sessions():
            if stored.workspace_kind != "ssh" or stored.connection_id != connection_id:
                continue

            server_wide = normalize_filesystem_scope(stored.filesystem_scope) == "server"
            migration_target = (
                None
                if server_wide
                else _workspace_migration_target(stored.cwd, normalized_migrations)
            )
            if migration_target is not None:
                self._validate_workspace(migration_target)
                if stored.session_id in self._turn_tasks or stored.state in {
                    AgentSessionState.STARTING,
                    AgentSessionState.RUNNING,
                    AgentSessionState.WAITING_APPROVAL,
                }:
                    with contextlib.suppress(Exception):
                        await self.stop_session(stored.session_id)
                session = self._store.get_session(stored.session_id) or stored
                previous_cwd = session.cwd
                session.cwd = migration_target
                self._clear_session_grants(session.session_id)
                self._store.save_session(session)
                await self._emit(
                    session.session_id,
                    "workspace_changed",
                    {
                        "cwd": migration_target,
                        "previousCwd": previous_cwd,
                        "reason": "production_workspace_prepared",
                    },
                )
                await self._publish_session(session)
                migrated.append(session.session_id)
                stored = session

            if server_wide or _workspace_is_under_roots(stored.cwd, allowed_roots):
                session = self._store.get_session(stored.session_id) or stored
                if session.last_error == _SSH_WORKSPACE_INVALIDATED_ERROR:
                    session.last_error = None
                    self._store.save_session(session)
                    await self._emit(
                        session.session_id,
                        "workspace_reauthorized",
                        {"cwd": session.cwd},
                    )
                    await self._publish_session(session)
                    reauthorized.append(session.session_id)
                continue

            await self.mark_session_workspace_invalid(
                stored.session_id,
                _SSH_WORKSPACE_INVALIDATED_ERROR,
            )
            invalidated.append(stored.session_id)

        return {
            "migrated": migrated,
            "invalidated": invalidated,
            "reauthorized": reauthorized,
        }

    async def mark_session_workspace_invalid(self, session_id: str, reason: str) -> bool:
        """Persist a visible fail-closed marker for a chat whose SSH grant was revoked."""
        session = self._store.get_session(session_id)
        if session is None:
            return False
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            with contextlib.suppress(Exception):
                await self.stop_session(session_id)
            session = self._store.get_session(session_id) or session
        # Do not destroy a real provider/tool failure merely to persist the
        # authorization state. The send/start boundary still rejects this cwd,
        # and the explicit invalidation event makes the security transition clear.
        if session.last_error is None or session.last_error == _SSH_WORKSPACE_INVALIDATED_ERROR:
            session.last_error = reason
        self._clear_session_grants(session_id)
        self._store.save_session(session)
        await self._emit(
            session_id,
            "workspace_invalidated",
            {"cwd": session.cwd, "reason": reason},
        )
        await self._publish_session(session)
        return True

    async def list_events(
        self,
        session_id: str,
        limit: int = 5_000,
        *,
        before_sequence: int | None = None,
        turn_limit: int | None = None,
    ) -> list[dict[str, Any]]:
        if self._store.get_session(session_id) is None:
            raise KeyError(session_id)
        return [
            event.to_dict()
            for event in self._store.list_events(
                session_id,
                limit=limit,
                before_sequence=before_sequence,
                turn_limit=turn_limit,
            )
        ]

    async def list_approvals(self, session_id: str) -> list[dict[str, Any]]:
        if self._store.get_session(session_id) is None:
            raise KeyError(session_id)
        return [approval.to_dict() for approval in self._store.list_approvals(session_id)]

    async def list_checkpoints(self, session_id: str) -> list[dict[str, Any]]:
        if self._store.get_session(session_id) is None:
            raise KeyError(session_id)
        if self._tools is None:
            return []
        return self._tools.list_checkpoints(session_id)

    async def evaluate_session(self, session_id: str) -> dict[str, Any]:
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        return evaluate_session(
            session,
            self._store.list_events(session_id, limit=5_000),
        )

    async def restore_checkpoint(
        self,
        session_id: str,
        checkpoint_id: str,
    ) -> dict[str, Any]:
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise AgentTurnActiveError("Stop the active turn before restoring a checkpoint")
        if self._tools is None:
            raise RuntimeError("Open the session workspace before restoring a checkpoint")
        if (
            session.workspace_kind == "local"
            and self._files is not None
            and hasattr(self._files, "authorize_local_session")
        ):
            cast(WorkspaceFileService, self._files).authorize_local_session(session_id, session.cwd)
        scope = (
            cast(WorkspaceFileService, self._files).session_scope(session_id)
            if self._files is not None and hasattr(self._files, "session_scope")
            else contextlib.nullcontext()
        )
        with scope:
            value = await self._tools.restore_checkpoint(session, checkpoint_id)
        await self._emit(
            session_id,
            "checkpoint_restored",
            {
                "checkpointId": checkpoint_id,
                "rollbackCheckpoint": value.get("rollbackCheckpoint"),
            },
        )
        return value

    async def send(
        self,
        session_id: str,
        message: str,
        *,
        show_in_timeline: bool = True,
        generate_title: bool | None = None,
        reasoning_effort: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        plugin_ids: list[str] | None = None,
    ) -> bool:
        message = message.strip()
        clean_attachments = _normalize_attachments(attachments)
        if not message and not clean_attachments:
            raise ValueError("Agent message cannot be empty")
        if not message and clean_attachments:
            message = "See attached file(s)."
        session = self._store.get_session(session_id)
        if session is None:
            return False
        self._clear_retryable_guard_for_new_message(session)
        if (
            session.workspace_kind == "local"
            and self._files is not None
            and hasattr(self._files, "authorize_local_session")
        ):
            cast(WorkspaceFileService, self._files).authorize_local_session(session_id, session.cwd)
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise AgentTurnActiveError(
                "Wait for the active turn to finish or stop it before sending another message"
            )
        if session.state == AgentSessionState.PAUSED_GUARD:
            raise AgentTurnActiveError(
                "Resolve the paused task guard before sending another message"
            )
        if self._tools is None:
            raise RuntimeError("Open a workspace before starting Coloride Agent")
        if plugin_ids is not None:
            self._tools.set_session_plugins(session_id, plugin_ids)

        # Safety net: close any leftover open tool calls from a previous crash/stop
        # before the model sees history again.
        closed = self._store.close_orphan_function_calls(
            session_id,
            reason="Cancelled before this message (previous turn ended without a tool result).",
        )
        if closed:
            agent_debug(
                "turn_send_closed_orphans",
                sessionId=session_id,
                callIds=closed[:12],
                count=len(closed),
            )

        if reasoning_effort is not None:
            session.reasoning_effort = normalize_reasoning_effort(reasoning_effort)
        provider = await self._create_provider(reasoning_effort=session.reasoning_effort)
        should_title = (
            bool(generate_title)
            if generate_title is not None
            else not bool(session.task and session.task.strip())
        )
        if should_title:
            # Immediate clean placeholder; AI title replaces it shortly after.
            session.task = self._fallback_title(message)
        session.agent = "coloride"
        session.model = provider.model
        session.active_turn_id = f"turn_{secrets.token_hex(8)}"
        session.last_error = None
        self._store.save_session(session)
        if should_title:
            await self._publish_session(session)
        attachment_payload = [
            {
                "name": item.get("name") or "file",
                "kind": item.get("kind") or "file",
                "mime": item.get("mime") or "application/octet-stream",
                "size": int(item.get("size") or 0),
                "path": item.get("path") or None,
                "previewDataUrl": item.get("previewDataUrl") or item.get("preview_data_url") or None,
            }
            for item in clean_attachments
        ]
        event_plugin_ids = [
            item.strip().lower()
            for item in (plugin_ids or [])
            if isinstance(item, str) and item.strip()
        ]
        if not event_plugin_ids and self._tools is not None:
            event_plugin_ids = list(self._tools._session_plugins.get(session_id) or ())
        if show_in_timeline:
            # Timeline gets clean text + attachment cards (preview thumbs), not path walls.
            await self._emit(
                session.session_id,
                "user_message",
                {
                    "text": message,
                    "attachments": attachment_payload,
                    "pluginIds": event_plugin_ids,
                },
            )
        else:
            # Hidden kickoff (Implement, etc.) — not shown as a bubble, but marks the
            # live-turn boundary so the UI only rebuilds the current turn tail.
            await self._emit(
                session.session_id,
                "user_message",
                {
                    "text": message,
                    "hidden": True,
                    "attachments": [],
                },
            )
        await self._emit_state(session, AgentSessionState.RUNNING)
        agent_debug(
            "turn_send",
            sessionId=session_id,
            turnId=session.active_turn_id,
            model=provider.model,
            messagePreview=message[:200],
            attachmentCount=len(clean_attachments),
        )

        cancel_event = asyncio.Event()
        self._cancel_events[session_id] = cancel_event
        if should_title:
            # Kick off title generation immediately so sidebar/header update mid-turn.
            asyncio.create_task(
                self._generate_session_title(session, message, provider),
                name=f"coloride-agent-title-{session_id}",
            )
        task = asyncio.create_task(
            self._run_turn(
                session,
                message,
                provider,
                cancel_event,
                generate_title=False,
                attachments=clean_attachments,
            ),
            name=f"coloride-agent-{session_id}",
        )
        self._turn_tasks[session_id] = task
        return True

    async def stop_session(self, session_id: str) -> bool:
        session = self._store.get_session(session_id)
        if session is None:
            return False
        # Already idle with no live task — treat as success (avoids double stop spam).
        if session.state == AgentSessionState.IDLE and session_id not in self._turn_tasks:
            return True
        agent_debug(
            "turn_stop_requested",
            sessionId=session_id,
            state=session.state.value,
            turnId=session.active_turn_id,
            hadTask=session_id in self._turn_tasks,
        )
        cancel_event = self._cancel_events.get(session_id)
        if cancel_event is not None:
            cancel_event.set()
        self._cancel_pending_approvals(session_id)
        task = self._turn_tasks.get(session_id)
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._turn_tasks.pop(session_id, None)
        self._cancel_events.pop(session_id, None)
        # Keep session tool grants across pause/continue so "Allow for session"
        # is not a one-shot that expires the moment the user stops a turn.
        # Close only agent-owned browsers; UI tabs stay open.
        if self._tools is not None:
            with contextlib.suppress(Exception):
                await self._tools.browsers.close_owner(f"agent:{session_id}")
        # Seal any mid-tool function_calls so "continue" does not hit the provider
        # with an open call and no output (common after pause during approval/tool).
        closed = self._store.close_orphan_function_calls(
            session_id,
            reason=(
                "Cancelled by user (turn paused). Browser sessions owned by this "
                "agent turn were closed — call browser_open again if you still need the UI."
            ),
        )
        if closed:
            agent_debug(
                "turn_stop_closed_orphans",
                sessionId=session_id,
                callIds=closed[:12],
                count=len(closed),
            )
        session = self._store.get_session(session_id) or session
        turn_id = session.active_turn_id
        session.active_turn_id = None
        # User pause is not a failure — keep last_error for real crashes only.
        session.last_error = None
        persisted_task = self._store.get_task(session_id)
        if persisted_task:
            persisted_task.completion.update(outcome="stopped", accepted=False)
            self._store.save_task(persisted_task)
        # Seal execution while retaining the objective.
        await self._emit(
            session_id,
            "done",
            {"turnId": turn_id, "failed": False, "stopped": True, "outcome":"stopped"},
        )
        await self._emit_state(session, AgentSessionState.IDLE)
        self._store.save_session(session)
        agent_debug("turn_stop_complete", sessionId=session_id)
        return True

    async def fork_session(self, session_id: str) -> str:
        session = self._store.get_session(session_id)
        if session is None:
            raise ValueError("Agent session not found")
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise RuntimeError("Stop the active turn before forking")
        if session.workspace_kind != "local":
            self._validate_workspace(session.cwd)
        self._store.close_orphan_function_calls(session_id, reason="Cancelled before fork")
        fork = self._store.fork_session(session_id)
        if (
            fork.workspace_kind == "local"
            and self._files is not None
            and hasattr(self._files, "authorize_local_session")
        ):
            fork.cwd = cast(WorkspaceFileService, self._files).authorize_local_session(
                fork.session_id,
                fork.cwd,
            )
            self._store.save_session(fork)
        await self._emit_state(fork, AgentSessionState.IDLE)
        await self._publish_session(fork)
        return fork.session_id

    async def set_mode(self, session_id: str, mode: AgentMode) -> SessionSummary | None:
        session = self._store.get_session(session_id)
        if session is None:
            return None
        if session.mode == mode:
            return self._summary(session)
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise RuntimeError("Stop the active turn before changing agent mode")

        session.mode = mode
        session.state = AgentSessionState.IDLE
        session.last_error = None
        self._clear_session_grants(session_id)
        self._store.save_session(session)
        await self._emit(session_id, "mode_changed", {"mode": mode.value})
        await self._emit_state(session, AgentSessionState.IDLE)
        return self._summary(session)

    async def set_access_level(self, session_id: str, access_level: str) -> SessionSummary | None:
        session = self._store.get_session(session_id)
        if session is None:
            return None
        if access_level not in {"request", "agent", "full"}:
            raise ValueError("Unknown agent access level")
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise RuntimeError("Stop the active turn before changing agent access")
        session.access_level = normalize_access_level(access_level)
        self._clear_session_grants(session_id)
        self._store.save_session(session)
        await self._emit(session_id, "access_changed", {"accessLevel": access_level})
        return self._summary(session)

    def set_preferred_linux_user(
        self,
        session_id: str,
        user: str,
    ) -> SessionSummary | None:
        session = self._store.get_session(session_id)
        if session is None:
            return None
        if user not in {"admin", "coloride"}:
            raise ValueError("preferred linux user must be admin or coloride")
        if session.preferred_linux_user == user:
            return self._summary(session)
        session.preferred_linux_user = normalize_preferred_linux_user(user)
        # A grant approved as one Linux identity must never carry over after
        # switching to a more privileged (or simply different) user.
        self._clear_session_grants(session_id)
        self._store.save_session(session)
        return self._summary(session)

    async def set_reasoning_effort(
        self,
        session_id: str,
        reasoning_effort: str,
    ) -> SessionSummary | None:
        session = self._store.get_session(session_id)
        if session is None:
            return None
        normalized = normalize_reasoning_effort(reasoning_effort)
        if session.reasoning_effort == normalized:
            return self._summary(session)
        session.reasoning_effort = normalize_reasoning_effort(normalized)
        self._store.save_session(session)
        await self._emit(session_id, "reasoning_changed", {"reasoningEffort": normalized})
        return self._summary(session)

    async def set_archived(self, session_id: str, archived: bool = True) -> SessionSummary | None:
        """Persist archive flag on disk so chats stay hidden across app restarts."""
        session = self._store.get_session(session_id)
        if session is None:
            return None
        if session.archived == archived:
            return self._summary(session)
        session.archived = archived
        self._store.save_session(session)
        await self._emit(session_id, "session_archived", {"archived": archived})
        await self._publish_session(session)
        return self._summary(session)

    async def get_plan(self, session_id: str) -> dict[str, Any] | None:
        if self._store.get_session(session_id) is None:
            raise KeyError(session_id)
        plan = self._store.get_session_plan(session_id)
        return plan.to_dict() if plan is not None else None

    async def update_plan(
        self,
        session_id: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        steps: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        plan = self._store.get_session_plan(session_id)
        if plan is None:
            raise KeyError("plan")
        if plan.status != AgentPlanStatus.READY:
            raise RuntimeError("Only a ready plan can be edited")
        if title is not None:
            cleaned = title.strip()
            if not cleaned:
                raise ValueError("title must be non-empty")
            plan.title = cleaned[:200]
        if summary is not None:
            plan.summary = summary.strip()[:2_000] or None
        if steps is not None:
            plan.steps = self._normalize_plan_steps(steps, preserve_status=False)
        plan.updated_at = utc_now()
        self._store.save_plan(plan)
        await self._emit(session_id, "plan_updated", {"plan": plan.to_dict()})
        return plan.to_dict()

    async def dismiss_plan(self, session_id: str) -> dict[str, Any]:
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        plan = self._store.get_session_plan(session_id)
        if plan is None:
            raise KeyError("plan")
        # Allow dismiss while the plan is on screen (including mid-follow).
        plan.status = AgentPlanStatus.DISMISSED
        plan.updated_at = utc_now()
        self._store.save_plan(plan)
        session.active_plan_id = None
        self._store.save_session(session)
        await self._emit(session_id, "plan_updated", {"plan": plan.to_dict()})
        return plan.to_dict()

    async def implement_plan(
        self,
        session_id: str,
        *,
        title: str | None = None,
        summary: str | None = None,
        steps: list[dict[str, Any]] | None = None,
    ) -> SessionSummary:
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        if session_id in self._turn_tasks or session.state in {
            AgentSessionState.STARTING,
            AgentSessionState.RUNNING,
            AgentSessionState.WAITING_APPROVAL,
        }:
            raise RuntimeError("Stop the active turn before implementing the plan")
        plan = self._store.get_session_plan(session_id)
        if plan is None:
            raise KeyError("plan")
        if plan.status not in {AgentPlanStatus.READY, AgentPlanStatus.IMPLEMENTING}:
            raise RuntimeError(f"Plan cannot be implemented in status {plan.status.value}")

        if title is not None:
            cleaned = title.strip()
            if cleaned:
                plan.title = cleaned[:200]
        if summary is not None:
            plan.summary = summary.strip()[:2_000] or None
        if steps is not None:
            plan.steps = self._normalize_plan_steps(steps, preserve_status=False)

        if not plan.steps:
            raise ValueError("Plan must have at least one step")

        for step in plan.steps:
            if step.status not in {
                AgentPlanStepStatus.DONE,
                AgentPlanStepStatus.SKIPPED,
            }:
                step.status = AgentPlanStepStatus.PENDING
                step.note = None

        plan.status = AgentPlanStatus.IMPLEMENTING
        plan.updated_at = utc_now()
        session.active_plan_id = plan.plan_id
        session.mode = AgentMode.ACT
        session.state = AgentSessionState.IDLE
        session.last_error = None
        self._clear_session_grants(session_id)
        self._store.save_plan(plan)
        self._store.save_session(session)
        await self._emit(session_id, "plan_updated", {"plan": plan.to_dict()})
        await self._emit(session_id, "mode_changed", {"mode": AgentMode.ACT.value})
        await self._emit_state(session, AgentSessionState.IDLE)

        kickoff = self._implement_kickoff_message(plan)
        # Do not show as a new user bubble / "new chat" — same session, hidden kickoff.
        await self.send(
            session_id,
            kickoff,
            show_in_timeline=False,
            generate_title=False,
        )
        summary_out = self._summary(self._store.get_session(session_id) or session)
        return summary_out

    async def stop_all(self) -> None:
        active = list(self._turn_tasks)
        for session_id in active:
            with contextlib.suppress(Exception):
                await self.stop_session(session_id)

    async def resolve_approval(self, approval_id: str, decision: str) -> bool:
        if decision not in {"approve", "approve-session", "decline", "cancel"}:
            raise ValueError("Invalid approval decision")
        approval = self._store.get_approval(approval_id)
        if approval is None:
            return False
        # Already resolved with a matching allow — treat as success (no "expired" friction).
        if approval.state == ApprovalState.APPROVED and decision in {
            "approve",
            "approve-session",
        }:
            return True
        if approval.state != ApprovalState.PENDING:
            return False
        waiter = self._approval_waiters.get(approval_id)
        approval.state = (
            ApprovalState.APPROVED
            if decision in {"approve", "approve-session"}
            else ApprovalState.CANCELLED
            if decision == "cancel"
            else ApprovalState.DECLINED
        )
        approval.resolved_at = utc_now()
        self._store.save_approval(approval)
        if decision == "approve-session":
            risk = str(approval.details.get("risk") or "")
            # Production stays a per-action authorization, never a session grant.
            grant = ScopedGrant.from_dict(approval.details.get("suggestedGrant"))
            if grant is not None and risk != "production":
                tool = str(approval.details.get("tool") or "")
                self._remember_session_grant(
                    approval.session_id,
                    grant.for_all_commands_session()
                    if tool in COMMAND_CAPABILITIES
                    else grant.for_session(),
                )
        if waiter is not None and not waiter.done():
            waiter.set_result(decision)
        await self._emit(
            approval.session_id,
            "approval_resolved",
            {"approvalId": approval.approval_id, "decision": decision},
        )
        return True

    async def resolve_guard(
        self,
        session_id: str,
        action: str,
        *,
        budget: dict[str, Any] | None = None,
    ) -> bool:
        if action not in {"retry-strategy", "continue-once", "update-budget", "stop"}:
            raise ValueError("Invalid guard action")
        session = self._store.get_session(session_id)
        task = self._store.get_task(session_id)
        if session is None or task is None or not task.guard_pause:
            return False
        if session_id in self._turn_tasks:
            raise AgentTurnActiveError("The guarded turn is still settling")

        previous = dict(task.guard_pause)
        reason = str(previous.get("reason") or "")
        if reason == "out-of-credits" and action != "stop":
            raise ValueError("Credits must be restored before this task can continue")
        if action == "update-budget":
            if not budget:
                raise ValueError("A larger budget is required")
            current = task.budget
            merged_budget = current.to_dict()
            merged_budget.update(budget)
            requested = TaskBudget.from_dict(merged_budget)
            fields = (
                "max_fresh_tokens",
                "max_runtime_ms",
                "max_hard_stops",
                "max_consecutive_provider_errors",
            )
            if any(getattr(requested, field) < getattr(current, field) for field in fields):
                raise ValueError("Guard budgets can only be increased")
            if all(getattr(requested, field) == getattr(current, field) for field in fields):
                raise ValueError("Increase at least one guard budget")
            task.budget = requested
            task.token_budget = requested.max_fresh_tokens
        elif action == "continue-once":
            # One recoverable window, scoped to this task only.
            task.budget.max_fresh_tokens += 250_000
            task.budget.max_runtime_ms += 15 * 60 * 1_000
            task.budget.max_hard_stops += 1
            task.budget.max_consecutive_provider_errors += 1
        elif action == "retry-strategy":
            task.progress.loop_score = 0
            task.progress.no_progress_iterations = 0
            task.progress.soft_replan_no_progress_at = None
            task.progress.hard_stops_baseline = task.progress.hard_stops

        task.guard_pause = None
        task.status = AgentTaskStatus.DONE if action == "stop" else AgentTaskStatus.IDLE
        self._store.save_task(task)
        session.active_turn_id = None
        await self._emit_state(session, AgentSessionState.IDLE)
        await self._emit(
            session_id,
            "guard_resolved",
            {"action": action, "reason": previous.get("reason")},
        )
        if action == "stop":
            return True
        await self.send(
            session_id,
            f"__COLORIDE_GUARD_RESUME__:{action}",
            show_in_timeline=False,
            generate_title=False,
        )
        return True

    async def tools(self) -> list[dict[str, object]]:
        if self._tools is None:
            return tool_catalog()
        await self._tools.refresh_integrations()
        return self._tools.catalog()

    async def integrations(self) -> list[dict[str, Any]]:
        if self._tools is None:
            return []
        return await self._tools.refresh_integrations()

    def metrics(self) -> dict[str, Any]:
        return self._telemetry.summary()

    def debug_dump(self, session_id: str) -> dict[str, Any]:
        """Unfiltered dump for /log — this chat only, no other sessions."""
        session = self._store.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        events = self._store.raw_event_records(session_id)
        type_counts: dict[str, int] = {}
        for event in events:
            key = str(event.get("type") or event.get("msg") or "_unknown")
            type_counts[key] = type_counts.get(key, 0) + 1
        plan = self._store.get_session_plan(session_id)
        stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
        safe_id = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in session_id)
        file_name = f"agent-{safe_id}-{stamp}.json"
        payload: dict[str, Any] = {
            "generatedAt": utc_now().isoformat(),
            "purpose": "Unfiltered dump for this chat only. Deltas are not compacted.",
            "session": session.to_dict(),
            "eventTypeCounts": dict(sorted(type_counts.items())),
            "eventCount": len(events),
            "loopFindings": analyze_event_records(events),
            "eventsRaw": events,
            "conversationItems": self._store.list_conversation_items(session_id, limit=None),
            "approvals": [item.to_dict() for item in self._store.list_approvals(session_id)],
            "checkpoints": (
                self._tools.list_checkpoints(session_id) if self._tools is not None else []
            ),
            "plan": plan.to_dict() if plan is not None else None,
            "debugLog": read_agent_debug_records(session_id),
            "projectMemoryContextRuns": self._project_memory.for_session(
                session
            ).latest_context_manifests(limit=20),
        }
        content = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
        path = write_agent_dump(file_name, content)
        return {
            "path": path,
            "fileName": file_name,
            "bytes": len(content.encode("utf-8")),
            "eventCount": len(events),
            "content": content,
        }

    def update_integrations(self, servers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if self._tools is None:
            raise RuntimeError("Agent tools are unavailable")
        return self._tools.replace_integrations(servers)

    async def apply_linear_token(self, access_token: str) -> list[dict[str, Any]]:
        if self._tools is None:
            raise RuntimeError("Agent tools are unavailable")
        from . import integration_tokens
        from .linear_oauth import LINEAR_MCP_URL, SERVER_ID

        token = access_token.strip()
        if not token:
            raise ValueError("Linear access token is empty")
        await integration_tokens.save_access_token(SERVER_ID, token)
        self._tools.integrations.set_access_token(SERVER_ID, token)
        self._tools.integrations.ensure_server(
            {
                "id": SERVER_ID,
                "name": "Linear",
                "url": LINEAR_MCP_URL,
                "enabled": True,
                "headerEnv": {},
            }
        )
        return await self._tools.refresh_integrations()

    def linear_oauth(self):
        if self._tools is None:
            raise RuntimeError("Agent tools are unavailable")
        oauth = getattr(self, "_linear_oauth", None)
        if oauth is None:
            from .linear_oauth import LinearOAuthCoordinator

            oauth = LinearOAuthCoordinator(self._tools.integrations)
            self._linear_oauth = oauth
        return oauth

    async def _create_provider(self, *, reasoning_effort: str = "medium") -> AgentModelProvider:
        if self._provider_factory is not None:
            return await self._provider_factory()
        settings = await self._config.resolve()
        # Per-turn effort from the composer (low/medium/high/xhigh).
        settings = AgentProviderSettings(
            provider=settings.provider,
            model=settings.model,
            base_url=settings.base_url,
            api_key=settings.api_key,
            credential_source=settings.credential_source,
            reasoning_effort=normalize_reasoning_effort(reasoning_effort),
            protocol=settings.protocol,
            model_capabilities=settings.model_capabilities,
        )
        from .provider_registry import create_provider
        return create_provider(settings)

    async def _run_turn(
        self,
        session: AgentSession,
        message: str,
        provider: AgentModelProvider,
        cancel_event: asyncio.Event,
        *,
        generate_title: bool,
        attachments: list[dict[str, Any]] | None = None,
    ) -> None:
        assert self._tools is not None
        started_at = time.monotonic()
        self._telemetry.record("turn_started", session_id=session.session_id)
        engine = ColorideAgentEngine(
            provider=provider,
            tools=self._tools,
            store=self._store,
            emit=lambda event_type, data: self._emit(session.session_id, event_type, data),
            request_approval=lambda call, details: self._request_approval(
                session.session_id,
                call,
                details,
            ),
            save_session=self._store.save_session,
            get_policy_grants=lambda: self._active_session_grants(session.session_id),
            project_memory_registry=self._project_memory,
        )
        scope = (
            cast(WorkspaceFileService, self._files).session_scope(session.session_id)
            if self._files is not None and hasattr(self._files, "session_scope")
            else contextlib.nullcontext()
        )
        try:
            agent_debug(
                "turn_run_start",
                sessionId=session.session_id,
                turnId=session.active_turn_id,
                model=provider.model,
            )
            with scope:
                await engine.run_turn(
                    session=session,
                    message=message,
                    cancel_event=cancel_event,
                    attachments=attachments,
                )
            latest = self._store.get_session(session.session_id) or session
            # Title generation runs in parallel at send() time; keep flag for callers/tests.
            if generate_title:
                await self._generate_session_title(latest, message, provider)
                latest = self._store.get_session(session.session_id) or latest
            if latest.state == AgentSessionState.PAUSED_GUARD:
                turn_id = latest.active_turn_id or session.active_turn_id
                latest.active_turn_id = None
                self._store.save_session(latest)
                await self._publish_session(latest)
                await self._emit(
                    session.session_id,
                    "done",
                    {"turnId": turn_id, "pausedGuard": True, "outcome": (self._store.get_task(session.session_id).completion or {}).get("outcome", "blocked")},
                )
            elif latest.state != AgentSessionState.STOPPED:
                turn_id = latest.active_turn_id or session.active_turn_id
                latest.active_turn_id = None
                await self._emit(
                    session.session_id,
                    "done",
                    {"turnId": turn_id, "outcome": (self._store.get_task(session.session_id).completion or {}).get("outcome", "unknown")},
                )
                # Release the authoritative turn slot before advertising IDLE.
                # The composer dispatches queued follow-ups as soon as it sees
                # IDLE; publishing it first created a small but real 409 race.
                self._turn_tasks.pop(session.session_id, None)
                self._cancel_events.pop(session.session_id, None)
                await self._emit_state(latest, AgentSessionState.IDLE)
                self._telemetry.record(
                    "turn_completed",
                    session_id=session.session_id,
                    duration_ms=round((time.monotonic() - started_at) * 1000),
                )
                agent_debug(
                    "turn_run_ok",
                    sessionId=session.session_id,
                    durationMs=round((time.monotonic() - started_at) * 1000),
                )
        except asyncio.CancelledError:
            agent_debug(
                "turn_run_cancelled",
                sessionId=session.session_id,
                durationMs=round((time.monotonic() - started_at) * 1000),
            )
            self._telemetry.record(
                "turn_failed",
                session_id=session.session_id,
                failed=True,
                duration_ms=round((time.monotonic() - started_at) * 1000),
            )
            raise
        except Exception as exc:
            agent_debug(
                "turn_run_failed",
                sessionId=session.session_id,
                error=exc,
                durationMs=round((time.monotonic() - started_at) * 1000),
            )
            latest = self._store.get_session(session.session_id) or session
            await self._fail_session(latest, str(exc))
            self._telemetry.record(
                "turn_failed",
                session_id=session.session_id,
                failed=True,
                duration_ms=round((time.monotonic() - started_at) * 1000),
            )
        finally:
            self._turn_tasks.pop(session.session_id, None)
            self._cancel_events.pop(session.session_id, None)

    async def _generate_session_title(
        self,
        session: AgentSession,
        message: str,
        provider: AgentModelProvider,
    ) -> None:
        generate = getattr(provider, "generate_title", None)
        if not callable(generate):
            return
        try:
            generated = generate(message)
            if inspect.isawaitable(generated):
                generated = await cast(Awaitable[object], generated)
            title = self._clean_generated_title(generated)
        except Exception:
            return
        if not title:
            return
        # Reload so concurrent turn state writes are preserved.
        latest = self._store.get_session(session.session_id) or session
        if latest.task == title:
            return
        latest.task = title
        self._store.save_session(latest)
        await self._publish_session(latest)

    async def _publish_session(self, session: AgentSession) -> None:
        if self._publish is None:
            return
        summary = self._summary(session)
        await self._publish(
            "agent:session",
            summary.model_dump(by_alias=True, mode="json"),
        )

    async def _request_approval(
        self,
        session_id: str,
        call: ModelToolCall,
        details: dict[str, Any],
    ) -> str:
        session = self._store.get_session(session_id)
        if session is None:
            return "decline"

        risk = str(details.get("risk") or "execute")
        title = (
            str(details.get("title") or "").strip()
            or (
                "Allow this command?"
                if risk == "execute"
                else "Allow this action?"
            )
        )
        approval = AgentApproval.create(
            session_id=session_id,
            kind="command" if risk == "execute" else "action",
            title=title,
            details={**details, "itemId": call.call_id},
        )
        self._store.save_approval(approval)
        waiter: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._approval_waiters[approval.approval_id] = waiter
        await self._emit_state(session, AgentSessionState.WAITING_APPROVAL)
        await self._emit(session_id, "approval_required", approval.to_dict())
        try:
            # No timeout / cooldown — stay open until the user acts or the turn stops.
            decision = await waiter
            return decision
        finally:
            self._approval_waiters.pop(approval.approval_id, None)
            latest = self._store.get_session(session_id)
            if latest is not None and latest.state == AgentSessionState.WAITING_APPROVAL:
                await self._emit_state(latest, AgentSessionState.RUNNING)

    def _cancel_pending_approvals(self, session_id: str) -> None:
        for approval in self._store.list_approvals(session_id, pending_only=True):
            waiter = self._approval_waiters.pop(approval.approval_id, None)
            if waiter is not None and not waiter.done():
                waiter.set_result("cancel")
            approval.state = ApprovalState.CANCELLED
            approval.resolved_at = utc_now()
            self._store.save_approval(approval)

    async def _on_plan_updated(self, plan: AgentPlan) -> None:
        await self._emit(plan.session_id, "plan_updated", {"plan": plan.to_dict()})

    async def _emit(self, session_id: str, event_type: str, data: dict[str, Any]) -> None:
        event = self._store.append_event(session_id, event_type, data)
        log_agent_emit(session_id, event_type, data)
        extra = None
        if event_type == "turn_telemetry":
            extra = {
                "turnIndex": data.get("turnIndex"),
                "credits": data.get("credits"),
                "llmCalls": data.get("llmCalls"),
                "freshTokens": data.get("freshTokens"),
                "historySearches": data.get("historySearches"),
                "filesInspected": data.get("filesInspected"),
                "toolCalls": data.get("toolCalls"),
            }
        self._telemetry.record(
            event_type,
            session_id=session_id,
            tool=str(data.get("tool") or ""),
            failed=bool(data.get("failed")),
            input_tokens=_optional_int(data.get("inputTokens")),
            cached_input_tokens=_optional_int(data.get("cachedInputTokens") or data.get("cachedTokens")),
            output_tokens=_optional_int(data.get("outputTokens")),
            extra=extra,
        )
        # Progress fingerprints, replans and abandoned trajectories belong to the
        # diagnostic/audit stream.  Persist and meter them, but never feed them to
        # the normal conversation UI: recovery should feel like internal agent
        # reasoning, not like another question the user has to answer.
        if bool(data.get("internal")):
            return
        if self._publish is not None:
            await self._publish("agent:event", event.to_dict())

    async def _emit_state(self, session: AgentSession, state: AgentSessionState) -> None:
        session.state = state
        self._store.save_session(session)
        agent_debug("state", sessionId=session.session_id, state=state.value)
        if self._publish is not None:
            await self._publish(
                "agent:state",
                {"sessionId": session.session_id, "state": state.value},
            )

    async def _fail_session(self, session: AgentSession, message: str) -> None:
        turn_id = session.active_turn_id
        session.last_error = message
        session.active_turn_id = None
        persisted_task = self._store.get_task(session.session_id)
        if persisted_task:
            persisted_task.completion.update(outcome="failed", accepted=False)
            self._store.save_task(persisted_task)
        # Surface the error, end the turn, and return to IDLE so the user can
        # immediately send "continue" (FAILED used to leave the UI feeling stuck).
        await self._emit(session.session_id, "error", {"message": message, "failed": True})
        await self._emit(
            session.session_id,
            "done",
            {"turnId": turn_id, "failed": True, "outcome":"failed"},
        )
        # Keep the same completion ordering as successful turns.  A failed
        # turn is available for retry only after its task slot is released.
        self._turn_tasks.pop(session.session_id, None)
        self._cancel_events.pop(session.session_id, None)
        await self._emit_state(session, AgentSessionState.IDLE)
        self._store.save_session(session)

    def _summary(self, session: AgentSession) -> SessionSummary:
        self._clear_deprecated_fresh_token_pause(session)
        plan = self._store.get_session_plan(session.session_id)
        plan_payload = None
        if plan is not None and plan.status not in {
            AgentPlanStatus.DISMISSED,
            AgentPlanStatus.DRAFTING,
        }:
            plan_payload = plan.to_dict()
        task = self._store.get_task(session.session_id)
        return SessionSummary(
            sessionId=session.session_id,
            agent=session.agent,
            task=session.task,
            cwd=session.cwd,
            workspaceKind=session.workspace_kind,
            connectionId=session.connection_id,
            filesystemScope=normalize_filesystem_scope(session.filesystem_scope),
            mode=session.mode.value,
            accessLevel=session.access_level,
            state=session.state.value,
            model=session.model,
            spentUsd=session.spent_usd,
            budgetUsd=session.budget_usd,
            budget=(
                TaskBudgetModel.model_validate(task.budget.to_dict())
                if task is not None
                else None
            ),
            budgetUsage=(
                TaskBudgetUsageModel.model_validate(task.budget_usage.to_dict())
                if task is not None
                else None
            ),
            guardPause=(task.guard_pause if task is not None else None),
            reasoningEffort=session.reasoning_effort,
            preferredLinuxUser=session.preferred_linux_user,
            startedAt=session.started_at,
            updatedAt=session.updated_at,
            lastError=session.last_error,
            archived=session.archived,
            plan=(
                AgentPlanModel.model_validate(plan_payload)
                if plan_payload is not None
                else None
            ),
        )

    def _clear_deprecated_fresh_token_pause(self, session: AgentSession) -> None:
        """Migrate tasks paused by the removed user-facing token guard."""
        task = self._store.get_task(session.session_id)
        if task is None:
            return
        pause = task.guard_pause
        if not isinstance(pause, dict) or pause.get("reason") != "fresh-tokens":
            return
        task.guard_pause = None
        task.status = AgentTaskStatus.IDLE
        self._store.save_task(task)
        if session.state == AgentSessionState.PAUSED_GUARD:
            session.state = AgentSessionState.IDLE
            session.active_turn_id = None
            self._store.save_session(session)


    def _clear_retryable_guard_for_new_message(self, session: AgentSession) -> None:
        """Resume internal guards when the user explicitly sends a new message.

        Loop detection and resource guards steer the agent internally; they are
        not a product decision the user should have to resolve. Credits remain
        authoritative in the cloud and are deliberately never cleared here.
        """
        task = self._store.get_task(session.session_id)
        if task is None:
            return
        pause = task.guard_pause
        reason = str(pause.get("reason") or "") if isinstance(pause, dict) else ""
        if not reason or reason == "out-of-credits":
            return
        task.guard_pause = None
        task.status = AgentTaskStatus.IDLE
        if reason == "runaway":
            task.progress.loop_score = 0
            task.progress.no_progress_iterations = 0
            task.progress.soft_replan_no_progress_at = None
            task.progress.hard_stops_baseline = task.progress.hard_stops
        self._store.save_task(task)
        if session.state == AgentSessionState.PAUSED_GUARD:
            session.state = AgentSessionState.IDLE
            session.active_turn_id = None
            self._store.save_session(session)

    def _active_session_grants(self, session_id: str) -> list[ScopedGrant]:
        task = self._store.get_task(session_id)
        persisted = task.scoped_grants if task is not None else []
        candidates = [
            *self._session_grants.get(session_id, []),
            *(grant for item in persisted if (grant := ScopedGrant.from_dict(item)) is not None),
        ]
        active: list[ScopedGrant] = []
        seen: set[tuple[str, str, str, str, str, str]] = set()
        for grant in candidates:
            if not grant.is_active():
                continue
            key = (
                grant.capability,
                grant.executable,
                grant.argument_class,
                grant.cwd,
                grant.connection_id,
                grant.network_scope,
            )
            if key in seen:
                continue
            seen.add(key)
            active.append(grant)
        self._session_grants[session_id] = active
        if task is not None:
            serialized = [grant.to_dict() for grant in active]
            if task.scoped_grants != serialized:
                task.scoped_grants = serialized
                self._store.save_task(task)
        return active

    def _remember_session_grant(self, session_id: str, grant: ScopedGrant) -> None:
        grants = self._active_session_grants(session_id)
        if not any(existing.matches(grant) and grant.matches(existing) for existing in grants):
            grants.append(grant)
        self._session_grants[session_id] = grants
        task = self._store.get_task(session_id)
        if task is None:
            session = self._store.get_session(session_id)
            if session is not None:
                task = self._store.ensure_task(session)
        if task is not None:
            task.scoped_grants = [item.to_dict() for item in grants]
            self._store.save_task(task)

    def _clear_session_grants(self, session_id: str) -> None:
        self._session_grants.pop(session_id, None)
        task = self._store.get_task(session_id)
        if task is not None and task.scoped_grants:
            task.scoped_grants = []
            self._store.save_task(task)

    @staticmethod
    def _normalize_plan_steps(
        steps: list[dict[str, Any]],
        *,
        preserve_status: bool,
    ) -> list[AgentPlanStep]:
        if not steps:
            raise ValueError("steps must be a non-empty list")
        if len(steps) > 20:
            raise ValueError("plans are limited to 20 steps")
        normalized: list[AgentPlanStep] = []
        used_ids: set[str] = set()
        for index, item in enumerate(steps, start=1):
            if not isinstance(item, dict):
                raise ValueError("each step must be an object")
            title = str(item.get("title") or "").strip()
            if not title:
                raise ValueError(f"step {index} needs a non-empty title")
            detail_raw = item.get("detail")
            detail = (
                detail_raw.strip()
                if isinstance(detail_raw, str) and detail_raw.strip()
                else None
            )
            raw_id = str(item.get("id") or "").strip() or f"step_{index}"
            step_id = raw_id if raw_id not in used_ids else f"step_{index}"
            used_ids.add(step_id)
            status = AgentPlanStepStatus.PENDING
            if preserve_status and item.get("status"):
                try:
                    status = AgentPlanStepStatus(str(item["status"]))
                except ValueError:
                    status = AgentPlanStepStatus.PENDING
            note_raw = item.get("note")
            note = (
                note_raw.strip()
                if isinstance(note_raw, str) and note_raw.strip()
                else None
            )
            normalized.append(
                AgentPlanStep(
                    id=step_id[:80],
                    title=title[:300],
                    detail=detail[:2_000] if detail else None,
                    status=status,
                    note=note[:1_000] if note else None,
                )
            )
        return normalized

    @staticmethod
    def _implement_kickoff_message(plan: AgentPlan) -> str:
        lines = [
            "The user pressed Implement on the approved plan. Execute the remaining work now ",
            "in this same chat (no new conversation). The plan is the roadmap — follow it.",
            "",
            "Rules:",
            "1. Skip steps already done/skipped. Start at the first pending step.",
            "2. Before a step: update_plan_step(step_id, in_progress).",
            "3. After a step: update_plan_step(step_id, done) (or skipped + note if blocked).",
            "4. You may edit files and run commands (with approval) as needed for the plan.",
            "5. Prefer the planned approach; keep chat updates short.",
            "",
            f"# {plan.title}",
        ]
        if plan.summary:
            lines.append(plan.summary)
            lines.append("")
        lines.append("Steps:")
        for index, step in enumerate(plan.steps, start=1):
            detail = f" — {step.detail}" if step.detail else ""
            lines.append(f"{index}. [{step.id}] [{step.status.value}] {step.title}{detail}")
        lines.append("")
        lines.append("Continue from the first pending step now.")
        return "\n".join(lines)

    @staticmethod
    def _validate_workspace(cwd: str) -> None:
        path = PurePosixPath(cwd)
        if not cwd.startswith("/") or "\0" in cwd or ".." in path.parts:
            raise ValueError("Agent workspace must be an absolute remote path")

    @staticmethod
    def _fallback_title(message: str) -> str:
        """Short provisional label until the model returns a real title."""
        compact = " ".join(message.split())
        if not compact:
            return "New chat"
        # Prefer a short Title-Case phrase over dumping the full prompt.
        words = compact.replace("?", " ").replace("!", " ").replace(",", " ").split()
        stop = {
            "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for",
            "with", "please", "can", "you", "me", "i", "we", "my", "our",
        }
        picked: list[str] = []
        for word in words:
            token = "".join(ch for ch in word if ch.isalnum() or ch in {"-", "_", "/"})
            if not token:
                continue
            lower = token.lower()
            if lower in stop and picked:
                continue
            if lower in stop and not picked:
                continue
            picked.append(token)
            if len(picked) >= 6:
                break
        if not picked:
            picked = words[:5]
        title = " ".join(picked)
        # Light Title Case without forcing acronyms/paths to weird casing.
        parts: list[str] = []
        for part in title.split():
            if part.isupper() or "/" in part or "_" in part or any(ch.isdigit() for ch in part):
                parts.append(part)
            else:
                parts.append(part[:1].upper() + part[1:])
        cleaned = " ".join(parts).strip(" -_")
        return (cleaned or "New chat")[:56].rstrip()

    @staticmethod
    def _clean_generated_title(value: object) -> str:
        title = " ".join(str(value or "").splitlines()[0].split())
        title = title.strip(" `\"'")
        # Drop common wrappers the model sometimes still adds.
        for prefix in ("title:", "task:", "chat:", "name:"):
            if title.lower().startswith(prefix):
                title = title[len(prefix):].strip(" `\"'")
        title = title.rstrip(".!?:;, ")
        return title[:72].rstrip()

    @staticmethod
    def _text(value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)


def _normalize_attachments(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not attachments:
        return []
    cleaned: list[dict[str, Any]] = []
    for raw in attachments[:12]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "file").strip() or "file"
        kind = str(raw.get("kind") or "file").strip().lower()
        if kind not in {"image", "file", "code"}:
            kind = "file"
        mime = str(raw.get("mime") or "application/octet-stream").strip()
        path_raw = raw.get("path")
        path = str(path_raw).strip() if isinstance(path_raw, str) and path_raw.strip() else None
        preview = raw.get("previewDataUrl") or raw.get("preview_data_url")
        preview_url = (
            str(preview).strip()
            if isinstance(preview, str) and preview.startswith("data:image/")
            else None
        )
        # Cap stored preview so event logs stay small (~120KB data URL).
        if preview_url and len(preview_url) > 160_000:
            preview_url = None
        try:
            size = int(raw.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        start_line = _optional_int(raw.get("startLine") if raw.get("startLine") is not None else raw.get("start_line"))
        end_line = _optional_int(raw.get("endLine") if raw.get("endLine") is not None else raw.get("end_line"))
        row: dict[str, Any] = {
            "name": name[:240],
            "kind": kind,
            "mime": mime[:120],
            "size": max(0, size),
            "path": path[:2_000] if path else None,
            "previewDataUrl": preview_url,
        }
        if start_line is not None and start_line >= 1:
            row["startLine"] = start_line
        if end_line is not None and end_line >= 1:
            row["endLine"] = end_line
        cleaned.append(row)
    return cleaned


def _normalize_workspace_cwd(path: str) -> str:
    """Match workspace roots without treating a trailing slash as a new workspace."""
    return "/".join(part for part in path.strip().split("/") if part)


def _workspace_is_under_roots(path: str, roots: list[str] | tuple[str, ...]) -> bool:
    """Boundary-aware lexical check for already validated session/root paths."""
    candidate_path = PurePosixPath(path)
    if not candidate_path.is_absolute() or ".." in candidate_path.parts:
        return False
    candidate = str(candidate_path).rstrip("/") or "/"
    for raw_root in roots:
        root_path = PurePosixPath(raw_root)
        if not root_path.is_absolute() or ".." in root_path.parts:
            continue
        root = str(root_path).rstrip("/") or "/"
        if root == "/" or candidate == root or candidate.startswith(f"{root}/"):
            return True
    return False


def _workspace_migration_target(
    path: str,
    migrations: list[tuple[PurePosixPath, PurePosixPath]],
) -> str | None:
    """Map a source workspace or descendant into its prepared-copy equivalent."""
    candidate = PurePosixPath(path)
    if not candidate.is_absolute() or ".." in candidate.parts:
        return None
    for source, target in migrations:
        try:
            relative = candidate.relative_to(source)
        except ValueError:
            continue
        return str(target / relative) if relative.parts else str(target)
    return None


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) else None
