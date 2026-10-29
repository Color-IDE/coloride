"""ACP v1 client. Reads continuously so a prompt can pause for permissions."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from acp import PROTOCOL_VERSION, connect_to_agent
from acp.exceptions import RequestError
from acp.meta import AGENT_METHODS
from acp.schema import (
    AgentMessageChunk,
    AgentPlanUpdate,
    AgentThoughtChunk,
    AllowedOutcome,
    AuthCapabilities,
    AuthenticateResponse,
    AuthMethodAgent,
    AvailableCommandsUpdate,
    BooleanConfigOptionCapabilities,
    ClientCapabilities,
    ClientSessionCapabilities,
    ConfigOptionUpdate,
    CreateTerminalResponse,
    CurrentModeUpdate,
    DeleteSessionRequest,
    DeleteSessionResponse,
    DeniedOutcome,
    EnvVariable,
    FileSystemCapabilities,
    Implementation,
    InitializeResponse,
    KillTerminalResponse,
    LoadSessionResponse,
    NewSessionResponse,
    PermissionOption,
    PromptResponse,
    ReadTextFileResponse,
    ReleaseTerminalResponse,
    RequestPermissionResponse,
    SessionConfigOptionsCapabilities,
    SessionInfoUpdate,
    TerminalAuthMethod,
    TerminalOutputResponse,
    TextContentBlock,
    ToolCallProgress,
    ToolCallStart,
    UsageUpdate,
    UserMessageChunk,
    WaitForTerminalExitResponse,
    WriteTextFileResponse,
)
from acp.utils import request_model_from_dict

from .files import AcpFileBridge
from .models import AuthMethodRecord, ConfigOptionRecord
from .processes import OwnedProcess
from .terminals import AcpTerminalBridge

if TYPE_CHECKING:
    from acp.client.connection import ClientSideConnection

STABLE_PROTOCOL_VERSION = 1
assert PROTOCOL_VERSION == STABLE_PROTOCOL_VERSION

UpdateHandler = Callable[[str, dict[str, Any]], Awaitable[None]]
PermissionHandler = Callable[[str, dict[str, Any]], Awaitable[str | None]]
ExitHandler = Callable[[str, int | None, str], Awaitable[None]]


def _dump(model: Any) -> dict[str, Any]:
    if isinstance(model, dict):
        return model
    if hasattr(model, "model_dump"):
        return model.model_dump(by_alias=True, mode="json")
    return {"value": model}


def _category(value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(next(iter(value), "custom"))
    return str(value)


def config_options_from(raw: list[Any] | None) -> list[ConfigOptionRecord]:
    options: list[ConfigOptionRecord] = []
    for item in raw or []:
        payload = _dump(item)
        kind = payload.get("type")
        if kind not in {"select", "boolean"}:
            continue
        if kind == "boolean":
            options.append(
                ConfigOptionRecord(
                    id=str(payload.get("id")),
                    name=str(payload.get("name") or payload.get("id")),
                    description=payload.get("description"),
                    category=_category(payload.get("category")),
                    type="boolean",
                    currentValue=bool(payload.get("currentValue")),
                )
            )
            continue
        choices = []
        for choice in payload.get("options") or []:
            if isinstance(choice, dict) and "options" in choice and "value" not in choice:
                for nested in choice.get("options") or []:
                    choices.append(
                        {
                            "value": str(nested.get("value")),
                            "name": str(nested.get("name") or nested.get("value")),
                            "description": nested.get("description"),
                            "group": choice.get("group"),
                            "groupName": choice.get("name"),
                        }
                    )
            elif isinstance(choice, dict):
                choices.append(
                    {
                        "value": str(choice.get("value")),
                        "name": str(choice.get("name") or choice.get("value")),
                        "description": choice.get("description"),
                        "group": choice.get("group"),
                        "groupName": choice.get("groupName"),
                    }
                )
        options.append(
            ConfigOptionRecord(
                id=str(payload.get("id")),
                name=str(payload.get("name") or payload.get("id")),
                description=payload.get("description"),
                category=_category(payload.get("category")),
                type="select",
                currentValue=str(payload.get("currentValue") or ""),
                options=choices,
            )
        )
    return options


def auth_methods_from(response: InitializeResponse) -> list[AuthMethodRecord]:
    methods: list[AuthMethodRecord] = []
    for method in response.auth_methods or []:
        payload = _dump(method)
        kind: str = "agent"
        if isinstance(method, TerminalAuthMethod) or payload.get("type") == "terminal":
            kind = "terminal"
        elif payload.get("type") == "env_var":
            kind = "env"
        elif isinstance(method, AuthMethodAgent):
            kind = "agent"
        methods.append(
            AuthMethodRecord(
                id=str(payload.get("id")),
                name=str(payload.get("name") or payload.get("id")),
                description=payload.get("description"),
                type=kind,  # type: ignore[arg-type]
                args=[str(item) for item in payload.get("args") or []],
                env={str(key): str(value) for key, value in (payload.get("env") or {}).items()},
            )
        )
    return methods


class ColorideAcpClient:
    """Client callbacks. Capabilities match only what this class implements."""

    def __init__(
        self,
        *,
        session_id: str,
        files: AcpFileBridge,
        terminals: AcpTerminalBridge,
        on_update: UpdateHandler,
        on_permission: PermissionHandler,
        workspace: str | None = None,
    ) -> None:
        self.session_id = session_id
        self.files = files
        self.terminals = terminals
        self.on_update = on_update
        self.on_permission = on_permission
        self.connection: ClientSideConnection | None = None
        self.workspace = workspace

    def on_connect(self, conn: ClientSideConnection) -> None:
        self.connection = conn

    async def request_permission(
        self,
        session_id: str,
        tool_call: Any,
        options: list[PermissionOption],
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        del kwargs
        option_id = await self.on_permission(
            self.session_id,
            {
                "sessionUpdate": "permission_request",
                "acpSessionId": session_id,
                "toolCall": _dump(tool_call),
                "options": [_dump(option) for option in options],
            },
        )
        if not option_id:
            return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
        return RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", optionId=option_id))

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        del session_id, kwargs
        await self.on_update(self.session_id, _dump(update))

    async def read_text_file(
        self,
        session_id: str,
        path: str,
        line: int | None = None,
        limit: int | None = None,
        **kwargs: Any,
    ) -> ReadTextFileResponse:
        del session_id, kwargs
        content = await self.files.read_text(path, line=line, limit=limit)
        return ReadTextFileResponse(content=content)

    async def write_text_file(
        self,
        session_id: str,
        path: str,
        content: str,
        **kwargs: Any,
    ) -> WriteTextFileResponse:
        del session_id, kwargs
        await self.files.write_text(path, content)
        return WriteTextFileResponse()

    async def create_terminal(
        self,
        session_id: str,
        command: str,
        args: list[str] | None = None,
        env: list[EnvVariable] | None = None,
        cwd: str | None = None,
        output_byte_limit: int | None = None,
        **kwargs: Any,
    ) -> CreateTerminalResponse:
        del kwargs
        terminal_id = await self.terminals.create(
            session_id=self.session_id,
            command=command,
            args=args or [],
            env=[(item.name, item.value) for item in env or []],
            cwd=cwd or self.workspace,
            output_byte_limit=output_byte_limit,
        )
        return CreateTerminalResponse(terminalId=terminal_id)

    async def terminal_output(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> TerminalOutputResponse:
        del session_id, kwargs
        output, truncated, exit_status = await self.terminals.output(terminal_id, owner=self.session_id)
        return TerminalOutputResponse(output=output, truncated=truncated, exitStatus=exit_status)

    async def wait_for_terminal_exit(
        self,
        session_id: str,
        terminal_id: str,
        **kwargs: Any,
    ) -> WaitForTerminalExitResponse:
        del session_id, kwargs
        code, signal = await self.terminals.wait(terminal_id, owner=self.session_id)
        return WaitForTerminalExitResponse(exitCode=code, signal=signal)

    async def kill_terminal(self, session_id: str, terminal_id: str, **kwargs: Any) -> KillTerminalResponse:
        del session_id, kwargs
        await self.terminals.kill(terminal_id, owner=self.session_id)
        return KillTerminalResponse()

    async def release_terminal(
        self, session_id: str, terminal_id: str, **kwargs: Any
    ) -> ReleaseTerminalResponse:
        del session_id, kwargs
        await self.terminals.release(terminal_id, owner=self.session_id)
        return ReleaseTerminalResponse()

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        raise RequestError.method_not_found(method)

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        del method, params


class AcpConnection:
    def __init__(self, client: ColorideAcpClient, process: OwnedProcess) -> None:
        stdin = process.process.stdin
        stdout = process.process.stdout
        if stdin is None or stdout is None:
            raise RuntimeError("ACP process has no stdio pipes.")
        self.client = client
        self.process = process
        self.connection = connect_to_agent(client, stdin, stdout)
        self.initialized: InitializeResponse | None = None
        self._reader = asyncio.create_task(self._read_until_exit())

    async def _read_until_exit(self) -> None:
        # ClientSideConnection starts its own reader. This task only observes exit.
        await self.process.exited.wait()

    def capabilities(self) -> ClientCapabilities:
        return ClientCapabilities(
            fs=FileSystemCapabilities(readTextFile=True, writeTextFile=True),
            terminal=True,
            # Interactive terminal login is not advertised until a real PTY UI exists.
            auth=AuthCapabilities(terminal=False),
            session=ClientSessionCapabilities(
                configOptions=SessionConfigOptionsCapabilities(boolean=BooleanConfigOptionCapabilities()),
            ),
        )

    async def initialize(self) -> InitializeResponse:
        response = await self.connection.initialize(
            protocol_version=STABLE_PROTOCOL_VERSION,
            client_capabilities=self.capabilities(),
            client_info=Implementation(name="coloride", title="Coloride", version="0.1.28"),
        )
        if response.protocol_version != STABLE_PROTOCOL_VERSION:
            await self.close()
            raise RuntimeError(f"Agent offered ACP protocol {response.protocol_version}; Coloride speaks v1.")
        self.initialized = response
        return response

    async def authenticate(self, method_id: str) -> AuthenticateResponse:
        return await self.connection.authenticate(method_id=method_id)

    async def new_session(self, cwd: str) -> NewSessionResponse:
        return await self.connection.new_session(cwd=cwd, mcp_servers=[])

    async def load_session(self, session_id: str, cwd: str) -> LoadSessionResponse:
        return await self.connection.load_session(session_id=session_id, cwd=cwd, mcp_servers=[])

    async def set_config_option(
        self, session_id: str, config_id: str, value: str | bool
    ) -> list[ConfigOptionRecord]:
        response = await self.connection.set_config_option(
            config_id=config_id,
            session_id=session_id,
            value=value,
        )
        return config_options_from(response.config_options)

    async def prompt(self, session_id: str, text: str) -> PromptResponse:
        return await self.connection.prompt(
            session_id=session_id,
            prompt=[TextContentBlock(type="text", text=text)],
        )

    async def cancel(self, session_id: str) -> None:
        await self.connection.cancel(session_id=session_id)

    async def delete_session(self, session_id: str) -> None:
        capabilities = self.initialized.agent_capabilities if self.initialized else None
        session_capabilities = capabilities.session_capabilities if capabilities else None
        if session_capabilities is None or session_capabilities.delete is None:
            raise RuntimeError("This agent did not advertise conversation deletion.")
        await request_model_from_dict(
            self.connection._conn,
            AGENT_METHODS["session_delete"],
            DeleteSessionRequest(session_id=session_id),
            DeleteSessionResponse,
        )

    async def close_session(self, session_id: str) -> None:
        capabilities = self.initialized.agent_capabilities if self.initialized else None
        sessions = capabilities.session_capabilities if capabilities else None
        if sessions is None or sessions.close is None:
            return
        await self.connection.close_session(session_id=session_id)

    async def close(self) -> None:
        self._reader.cancel()
        with contextlib.suppress(Exception):
            await self.connection.close()


# Imported names kept for the type checker of session updates we persist as JSON.
_UPDATE_TYPES = (
    AgentMessageChunk,
    AgentPlanUpdate,
    AgentThoughtChunk,
    AvailableCommandsUpdate,
    ConfigOptionUpdate,
    CurrentModeUpdate,
    SessionInfoUpdate,
    ToolCallProgress,
    ToolCallStart,
    UsageUpdate,
    UserMessageChunk,
)


def terminal_auth_command(executable: str, args: list[str], method: AuthMethodRecord) -> list[str]:
    return [executable, *args, *method.args]


def package_root(path: str) -> Path:
    return Path(path).resolve().parent
