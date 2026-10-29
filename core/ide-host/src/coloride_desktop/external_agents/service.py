"""High-level operations for external ACP agents."""

from __future__ import annotations

import asyncio
import contextlib
import os
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from acp.exceptions import RequestError

from .acp_client import (
    AcpConnection,
    ColorideAcpClient,
    auth_methods_from,
    config_options_from,
)
from .files import AcpFileBridge
from .installer import ExternalAgentInstaller, InstallError
from .models import (
    ConfigOptionRecord,
    InstallationRecord,
    OpenSessionRequest,
    PermissionRecord,
    PromptImage,
    SessionRecord,
)
from .processes import ProcessRegistry
from .registry import RegistryClient, RegistryError
from .store import ExternalAgentStore
from .terminals import AcpTerminalBridge
from .usage import AgentUsageReader

Publish = Callable[[str, dict[str, Any]], Awaitable[None]]


class ExternalAgentError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


class ExternalAgentManager:
    def __init__(self, root: Path, publish: Publish, files: AcpFileBridge) -> None:
        self.store = ExternalAgentStore(root)
        self.publish = publish
        self.files = files
        self.registry = RegistryClient(self.store)
        self.installer = ExternalAgentInstaller(self.store)
        self.processes = ProcessRegistry()
        self.usage_reader = AgentUsageReader(self.installer)
        self.terminals = AcpTerminalBridge()
        self._connections: dict[str, AcpConnection] = {}
        self._permissions: dict[str, asyncio.Future[str | None]] = {}
        self._turns: dict[str, asyncio.Task[None]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._config_locks: dict[str, asyncio.Lock] = {}
        self._replaying: set[str] = set()
        self._watchers: dict[str, asyncio.Task[None]] = {}

    async def shutdown(self) -> None:
        await self.usage_reader.shutdown()
        await asyncio.gather(*(self.close_execution(session_id) for session_id in list(self._connections)))
        await self.terminals.close_all()
        await self.processes.stop_all()

    async def catalog(self) -> list[dict[str, Any]]:
        try:
            entries = await self.registry.catalog(refresh=True)
        except RegistryError as exc:
            raise ExternalAgentError("external_agents.registry", str(exc), 503) from exc
        installed = {
            item.agent_id: item for item in self.store.read_installations() if item.status == "installed"
        }
        public: list[dict[str, Any]] = []
        for entry in entries:
            current = installed.get(entry.id)
            entry.installed = current is not None
            entry.installed_version = current.version if current else None
            public.append(
                entry.model_dump(by_alias=True, exclude={"command", "env", "archive_url", "archive_sha256"})
            )
        return public

    async def account_usage(self) -> list[dict[str, Any]]:
        sessions = [self._session(session_id) for session_id in list(self._connections)]
        connected = {record.installation_id for record in sessions if record.phase == "ready"}
        installations = {item.agent_id: item for item in self.store.read_installations() if item.id in connected}
        return list(await asyncio.gather(*(self.usage_reader.read(item) for item in installations.values())))

    def installations(self) -> list[dict[str, Any]]:
        return [
            item.model_dump(by_alias=True, exclude={"args", "location"})
            for item in self.store.read_installations()
        ]

    async def install(self, agent_id: str, version: str | None = None) -> dict[str, Any]:
        try:
            entry = await self.registry.entry(agent_id, version)
        except RegistryError as exc:
            cached = self.store.read_registry_cache()
            if cached is None:
                raise ExternalAgentError("external_agents.registry", str(exc), 503) from exc
            raise ExternalAgentError("external_agents.registry", str(exc), 404) from exc
        try:
            record = await self.installer.install(entry)
        except InstallError as exc:
            raise ExternalAgentError("external_agents.install", str(exc), 422) from exc
        return record.model_dump(by_alias=True, exclude={"args", "location"})

    async def uninstall(self, installation_id: str) -> None:
        record = next((item for item in self.store.read_installations() if item.id == installation_id), None)
        if record is None:
            raise ExternalAgentError("external_agents.not_found", "Installation was not found.", 404)
        for session in self.store.list_sessions():
            if session.installation_id == installation_id:
                await self.close_execution(session.id)
        try:
            await self.installer.uninstall(record)
        except InstallError as exc:
            raise ExternalAgentError("external_agents.install", str(exc), 422) from exc

    async def open_session(self, request: OpenSessionRequest) -> dict[str, Any]:
        if request.execution_target != "local":
            raise ExternalAgentError("external_agents.target", "Only local projects are supported.", 400)
        if _looks_remote(request.workspace_path):
            raise ExternalAgentError(
                "external_agents.ssh",
                "SSH projects are not supported for Codex yet.",
                409,
            )
        workspace = Path(request.workspace_path).expanduser()
        if not workspace.is_dir():
            raise ExternalAgentError("external_agents.workspace", "Open a local project folder first.", 400)
        installation = self._ready_installation(request.agent_id)
        session_id = request.session_id or str(uuid.uuid4())
        record = self.store.read_session(session_id)
        if record and (
            record.agent_id != request.agent_id or record.workspace_path != str(workspace.resolve())
        ):
            raise ExternalAgentError(
                "external_agents.session", "This conversation belongs to a different agent or project.", 409
            )
        if record is None:
            record = SessionRecord(
                id=session_id,
                agentId=installation.agent_id,
                installationId=installation.id,
                installationVersion=installation.version,
                workspacePath=str(workspace.resolve()),
                title=installation.name,
                phase="installed",
            )
            self.store.write_session(record)
        if record:
            installation = self._installation(record.installation_id)
        await self._ensure_connection(record, installation)
        stored = self.store.read_session(session_id)
        assert stored is not None
        return stored.public()

    async def session(self, session_id: str) -> dict[str, Any]:
        record = self._session(session_id)
        return record.public()

    async def events(self, session_id: str, after: int) -> list[dict[str, Any]]:
        self._session(session_id)
        return [item.model_dump(by_alias=True) for item in self.store.events_after(session_id, after)]

    async def authenticate(self, session_id: str, method_id: str) -> dict[str, Any]:
        record = self._session(session_id)
        method = next((item for item in record.auth_methods if item.id == method_id), None)
        if method is None:
            raise ExternalAgentError(
                "external_agents.auth", "That authentication method was not announced.", 400
            )
        connection = self._connections.get(session_id)
        if connection is None:
            raise ExternalAgentError("external_agents.connection", "Start the agent before signing in.", 409)
        record.phase = "authenticating"
        self.store.write_session(record)
        if method.type == "terminal":
            record.phase = "needs-login"
            self.store.write_session(record)
            raise ExternalAgentError(
                "external_agents.auth",
                "This agent requires interactive terminal login, which is not supported yet.",
                409,
            )
        elif method.type == "agent":
            try:
                await connection.authenticate(method.id)
            except Exception as exc:
                record = self._session(session_id)
                record.phase = "needs-login"
                record.error = str(exc)
                self.store.write_session(record)
                raise ExternalAgentError("external_agents.auth", str(exc), 401) from exc
            record = self._session(session_id)
            await self._open_acp_session(record, connection)
        else:
            raise ExternalAgentError(
                "external_agents.auth",
                "Environment-variable authentication is not used for Codex.",
                400,
            )
        return self._session(session_id).public()

    async def set_config(self, session_id: str, config_id: str, value: str | bool) -> dict[str, Any]:
        async with self._config_locks.setdefault(session_id, asyncio.Lock()):
            return await self._set_config(session_id, config_id, value)

    async def _set_config(self, session_id: str, config_id: str, value: str | bool) -> dict[str, Any]:
        record = self._session(session_id)
        if record.acp_session_id is None:
            raise ExternalAgentError("external_agents.session", "The ACP session is not ready.", 409)
        known = next((item for item in record.config_options if item.id == config_id), None)
        if known is None:
            raise ExternalAgentError("external_agents.config", "That option was not announced.", 400)
        if (known.type == "boolean" and not isinstance(value, bool)) or (
            known.type == "select"
            and (not isinstance(value, str) or value not in {item.value for item in known.options})
        ):
            raise ExternalAgentError(
                "external_agents.config", "That value was not announced for this option.", 400
            )
        connection = self._require_connection(session_id)
        record.pending_config[config_id] = value
        self.store.write_session(record)
        try:
            confirmed = await connection.set_config_option(record.acp_session_id, config_id, value)
        except Exception as exc:
            record = self._session(session_id)
            record.pending_config.pop(config_id, None)
            record.error = str(exc)
            self.store.write_session(record)
            raise ExternalAgentError("external_agents.config", str(exc), 422) from exc
        record = self._session(session_id)
        record.config_options = confirmed
        record.pending_config.pop(config_id, None)
        record.error = None
        self.store.write_session(record)
        await self._emit(
            session_id, {"sessionUpdate": "config_option_update", "configOptions": _options(confirmed)}
        )
        return {"sessionId": session_id, "options": _options(confirmed), "pending": record.pending_config}

    async def prompt(self, session_id: str, text: str, images: list[PromptImage] | None = None) -> dict[str, Any]:
        record = self._session(session_id)
        if record.phase == "needs-login":
            raise ExternalAgentError(
                "external_agents.auth", "Sign in to Codex before sending a message.", 409
            )
        if record.phase != "ready" or record.acp_session_id is None:
            raise ExternalAgentError("external_agents.session", "The session is not ready.", 409)
        if record.turn == "running":
            raise ExternalAgentError("external_agents.turn", "A turn is already running.", 409)
        message = text.strip()
        images = images or []
        if images and not record.supports_images:
            raise ExternalAgentError("external_agents.images", "This agent does not support image prompts.", 400)
        if not message and not images:
            raise ExternalAgentError("external_agents.prompt", "Write a message first.", 400)
        turn_id = str(uuid.uuid4())
        record.turn = "running"
        self.store.write_session(record)
        self._turns[session_id] = asyncio.create_task(
            self._run_prompt(session_id, record.acp_session_id, message, images)
        )
        return {"accepted": True, "sessionId": session_id, "turnId": turn_id}

    async def cancel(self, session_id: str) -> None:
        record = self._session(session_id)
        connection = self._connections.get(session_id)
        record.turn = "cancelling"
        self.store.write_session(record)
        self._cancel_permissions(session_id)
        if connection and record.acp_session_id:
            with contextlib.suppress(Exception):
                await connection.cancel(record.acp_session_id)
        task = self._turns.get(session_id)
        if task:
            try:
                await asyncio.wait_for(task, timeout=5)
            except TimeoutError:
                task.cancel()

    async def resolve_permission(
        self, session_id: str, request_id: str, option_id: str | None, outcome: str
    ) -> None:
        if not request_id.startswith(f"{session_id}:"):
            raise ExternalAgentError(
                "external_agents.permission", "That permission belongs to another conversation.", 404
            )
        future = self._permissions.get(request_id)
        if future is None or future.done():
            raise ExternalAgentError(
                "external_agents.permission", "That permission request is no longer pending.", 404
            )
        if outcome == "cancelled" or not option_id:
            future.set_result(None)
            return
        requests = self.store.events_after(session_id, 0)
        offered = next(
            (
                event.update.get("options", [])
                for event in reversed(requests)
                if event.update.get("requestId") == request_id
            ),
            [],
        )
        if option_id not in {item.get("optionId") for item in offered}:
            raise ExternalAgentError(
                "external_agents.permission", "That permission option was not offered.", 400
            )
        future.set_result(option_id)

    async def close_execution(self, session_id: str) -> None:
        record = self.store.read_session(session_id)
        watcher = self._watchers.pop(session_id, None)
        if watcher and watcher is not asyncio.current_task():
            watcher.cancel()
        self._cancel_permissions(session_id)
        connection = self._connections.pop(session_id, None)
        if connection and record and record.acp_session_id and hasattr(connection, "close_session"):
            with contextlib.suppress(Exception):
                await asyncio.wait_for(connection.close_session(record.acp_session_id), timeout=2)
        if connection and hasattr(connection, "close"):
            await connection.close()
        if record and record.process_id:
            await self.processes.stop(record.process_id)
        await self.terminals.close_session(session_id)
        task = self._turns.pop(session_id, None)
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if record:
            record.phase = "closed"
            record.turn = "idle"
            record.process_id = None
            self.store.write_session(record)
            await self._emit(session_id, {"sessionUpdate": "execution_closed"})

    async def delete_session(self, session_id: str) -> None:
        record = self._session(session_id)
        connection = self._connections.get(session_id)
        if connection and record.acp_session_id:
            try:
                await connection.delete_session(record.acp_session_id)
            except RuntimeError as exc:
                raise ExternalAgentError("external_agents.delete", str(exc), 409) from exc
        await self.close_execution(session_id)
        self.store.delete_session(session_id)

    async def _ensure_connection(self, record: SessionRecord, installation: InstallationRecord) -> None:
        lock = self._locks.setdefault(record.id, asyncio.Lock())
        async with lock:
            record = self._session(record.id)
            if record.id in self._connections and record.phase in {"ready", "needs-login", "authenticating"}:
                return
            if record.id in self._connections:
                await self.close_execution(record.id)
            if record.turn != "idle":
                record.turn = "idle"
                record.pending_config = {}
                self.store.write_session(record)
                await self._emit(record.id, {"sessionUpdate": "turn_complete", "stopReason": "interrupted"})
            record.phase = "starting"
            record.error = None
            self.store.write_session(record)
            executable, args, env = self.installer.launch_command(installation)
            process = await self.processes.spawn(
                process_id=str(uuid.uuid4()),
                session_id=record.id,
                executable=executable,
                args=args,
                cwd=record.workspace_path,
                env=env,
            )
            record.process_id = process.process_id
            self.store.write_session(record)
            client = ColorideAcpClient(
                session_id=record.id,
                files=self.files.for_workspace(Path(record.workspace_path)),
                terminals=self.terminals,
                on_update=self._emit,
                on_permission=self._permission,
                workspace=record.workspace_path,
            )
            connection = AcpConnection(client, process)
            self._connections[record.id] = connection
            try:
                initialized = await connection.initialize()
            except Exception as exc:
                record.phase = "failed"
                record.error = str(exc)
                self.store.write_session(record)
                await self.close_execution(record.id)
                raise ExternalAgentError("external_agents.initialize", str(exc), 502) from exc
            capabilities = initialized.agent_capabilities
            record.supports_load = bool(capabilities and capabilities.load_session)
            record.supports_images = bool(capabilities and capabilities.prompt_capabilities and capabilities.prompt_capabilities.image)
            record.auth_methods = auth_methods_from(initialized)
            await self._open_acp_session(record, connection)
            self._watchers[record.id] = asyncio.create_task(self._watch_process(record.id, process))

    async def _open_acp_session(self, record: SessionRecord, connection: AcpConnection) -> None:
        try:
            if record.acp_session_id and record.supports_load:
                self._replaying.add(record.id)
                try:
                    loaded = await connection.load_session(record.acp_session_id, record.workspace_path)
                finally:
                    self._replaying.discard(record.id)
                record.config_options = config_options_from(loaded.config_options)
            elif record.acp_session_id and not record.supports_load:
                record.phase = "unsupported"
                record.error = "This agent cannot restore the conversation. Start a new one to continue."
                self.store.write_session(record)
                return
            else:
                created = await connection.new_session(record.workspace_path)
                record.acp_session_id = created.session_id
                record.config_options = config_options_from(created.config_options)
        except Exception as exc:
            if isinstance(exc, RequestError) and exc.code == RequestError.auth_required().code:
                record.phase = "needs-login"
                record.error = None
                self.store.write_session(record)
                return
            record.phase = "failed"
            record.error = str(exc)
            self.store.write_session(record)
            raise ExternalAgentError("external_agents.session", str(exc), 502) from exc
        record.phase = "ready"
        record.error = None
        self.store.write_session(record)

    async def _run_prompt(self, session_id: str, acp_session_id: str, text: str, images: list[PromptImage] | None = None) -> None:
        if text:
            await self._emit(session_id, {"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": text}})
        for image in images or []:
            await self._emit(session_id, {"sessionUpdate": "user_message_chunk", "content": {"type": "image", **image.model_dump(by_alias=True)}})
        connection = self._require_connection(session_id)
        try:
            response = await connection.prompt(acp_session_id, text, images) if images else await connection.prompt(acp_session_id, text)
            stop_reason = response.stop_reason
        except Exception as exc:
            stop_reason = "error"
            if isinstance(exc, RequestError) and exc.code == RequestError.auth_required().code:
                record = self._session(session_id)
                record.phase = "needs-login"
                self.store.write_session(record)
            await self._emit(session_id, {"sessionUpdate": "error", "message": str(exc)})
        except asyncio.CancelledError:
            stop_reason = "cancelled"
        record = self.store.read_session(session_id)
        if record:
            record.turn = "idle"
            self.store.write_session(record)
        await self._emit(session_id, {"sessionUpdate": "turn_complete", "stopReason": str(stop_reason)})
        self._turns.pop(session_id, None)

    async def _permission(self, session_id: str, payload: dict[str, Any]) -> str | None:
        request_id = f"{session_id}:{uuid.uuid4()}"
        tool = payload.get("toolCall") if isinstance(payload.get("toolCall"), dict) else {}
        permission = PermissionRecord(
            requestId=request_id,
            sessionId=session_id,
            toolCallId=tool.get("toolCallId"),
            title=tool.get("title"),
            kind=tool.get("kind"),
            options=[
                {
                    "optionId": str(option.get("optionId")),
                    "name": str(option.get("name")),
                    "kind": str(option.get("kind")),
                }
                for option in payload.get("options") or []
                if isinstance(option, dict)
            ],
        )
        loop = asyncio.get_running_loop()
        future: asyncio.Future[str | None] = loop.create_future()
        self._permissions[request_id] = future
        await self._emit(
            session_id, {"sessionUpdate": "permission_request", **permission.model_dump(by_alias=True)}
        )
        try:
            return await future
        finally:
            self._permissions.pop(request_id, None)
            await self._emit(session_id, {"sessionUpdate": "permission_resolved", "requestId": request_id})

    def _cancel_permissions(self, session_id: str) -> None:
        prefix = f"{session_id}:"
        for request_id, future in list(self._permissions.items()):
            if request_id.startswith(prefix) and not future.done():
                future.set_result(None)

    async def _emit(self, session_id: str, update: dict[str, Any]) -> None:
        if session_id in self._replaying and update.get("sessionUpdate") in {
            "user_message_chunk",
            "agent_message_chunk",
            "agent_thought_chunk",
            "tool_call",
            "tool_call_update",
            "plan",
        }:
            return
        if update.get("sessionUpdate") == "config_option_update" and "configOptions" in update:
            record = self.store.read_session(session_id)
            if record:
                # Notifications contain ACP options; normalize grouped choices just like session/new.
                record.config_options = config_options_from(update["configOptions"])
                update = {**update, "configOptions": _options(record.config_options)}
                self.store.write_session(record)
        event = self.store.append_event(session_id, update)
        await self.publish("external-agent:event", event.model_dump(by_alias=True))

    async def _watch_process(self, session_id: str, process: Any) -> None:
        await process.exited.wait()
        if self.processes.by_session(session_id) is not process:
            return
        await self.close_execution(session_id)
        record = self._session(session_id)
        record.phase = "failed"
        record.error = f"The agent exited (code {process.returncode}). Reopen the conversation to reconnect."
        self.store.write_session(record)
        await self._emit(session_id, {"sessionUpdate": "error", "message": record.error})

    def _ready_installation(self, agent_id: str) -> InstallationRecord:
        matches = [
            item
            for item in self.store.read_installations()
            if item.agent_id == agent_id and item.status == "installed"
        ]
        if not matches:
            raise ExternalAgentError("external_agents.install", f"Install {agent_id} before opening it.", 404)
        return matches[-1]

    def _installation(self, installation_id: str) -> InstallationRecord:
        found = next((item for item in self.store.read_installations() if item.id == installation_id), None)
        if found is None:
            raise ExternalAgentError("external_agents.install", "The recorded installation is gone.", 404)
        return found

    def _session(self, session_id: str) -> SessionRecord:
        try:
            record = self.store.read_session(session_id)
        except ValueError as exc:
            raise ExternalAgentError("external_agents.session", "Invalid session ID.", 400) from exc
        if record is None:
            raise ExternalAgentError("external_agents.not_found", "Session was not found.", 404)
        return record

    def _require_connection(self, session_id: str) -> AcpConnection:
        connection = self._connections.get(session_id)
        if connection is None:
            raise ExternalAgentError("external_agents.connection", "The agent process is not running.", 409)
        return connection


def _options(options: list[ConfigOptionRecord]) -> list[dict[str, Any]]:
    return [item.model_dump(by_alias=True) for item in options]


def _looks_remote(path: str) -> bool:
    text = path.strip()
    if text.startswith("ssh://"):
        return True
    if "://" in text:
        return True
    head = text.split("/", 1)[0]
    return "@" in head and ":" in head


def user_data_root() -> Path:
    configured = os.environ.get("COLORIDE_EXTERNAL_AGENTS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".coloride" / "external-agents"
