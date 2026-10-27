"""Agent access to the IDE's existing PTYs, without a second terminal UI."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path, PurePosixPath
from typing import Any

from .domain import AgentSession

_ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")


class AgentTerminalService:
    def __init__(self, registry: Any, *, create: Any, info: Any, remote: Any, publish: Any) -> None:
        self.registry = registry
        self.create = create
        self.info = info
        self.remote = remote
        self.publish = publish
        self._locks: dict[str, asyncio.Lock] = {}

    @staticmethod
    def belongs(terminal: Any, session: AgentSession) -> bool:
        if terminal.local != (session.workspace_kind == "local"):
            return False
        if not terminal.local and terminal.connection_id != session.connection_id:
            return False
        root = Path(session.cwd).resolve() if terminal.local else PurePosixPath(session.cwd)
        cwd = Path(terminal.cwd or "/").resolve() if terminal.local else PurePosixPath(terminal.cwd or "/")
        return cwd == root or root in cwd.parents

    async def get(self, terminal_id: str, session: AgentSession) -> Any:
        if session.workspace_kind == "ssh":
            await self.remote("validate", None, session.connection_id)
        terminal = self.registry.get(terminal_id)
        if terminal is None or not self.belongs(terminal, session):
            raise PermissionError("Terminal is not in the selected workspace and connection")
        # Refresh cwd before allowing access: the user may have changed folders.
        await self.info(terminal_id)
        if not self.belongs(terminal, session):
            raise PermissionError("Terminal has left the selected workspace")
        return terminal

    @staticmethod
    def describe(terminal: Any) -> dict[str, Any]:
        return dict(
            termId=terminal.term_id,
            sessionId=terminal.session_id,
            title=terminal.agent_title,
            cwd=terminal.cwd,
            workspaceKind="local" if terminal.local else "ssh",
            connectionId=terminal.connection_id,
            agentSessionId=terminal.agent_owner,
            workspacePath=terminal.agent_workspace,
            revealed=getattr(terminal, "agent_revealed", True),
            status="exited" if terminal.exited else "suspended" if terminal.suspended else "ready",
        )

    async def execute(self, name: str, arguments: dict[str, Any], session: AgentSession) -> dict[str, Any]:
        if session.workspace_kind == "ssh":
            await self.remote("validate", None, session.connection_id)
        if name == "list_terminals":
            result = []
            for terminal in self.registry.list():
                if self.belongs(terminal, session):
                    try:
                        await self.get(terminal.term_id, session)
                    except PermissionError:
                        continue
                    result.append(self.describe(terminal))
            return {"terminals": result}
        if name == "create_terminal":
            # Bound accidental model loops without closing any user sessions.
            owned = [t for t in self.registry.list() if t.agent_owner == session.session_id and not t.exited]
            if len(owned) >= 8:
                raise ValueError("This chat already has eight terminals; reuse an existing terminal")
            terminal = await self.create(session, arguments["cwd"])
            terminal.agent_owner = session.session_id
            terminal.agent_workspace = session.cwd
            terminal.agent_title = str(arguments.get("title") or "Agent terminal")[:80]
            terminal.agent_revealed = bool(arguments.get("_reveal", True))
            payload = self.describe(terminal)
            if terminal.agent_revealed:
                await self.publish("term:reveal", payload)
            return payload
        terminal = await self.get(str(arguments.get("terminal_id") or ""), session)
        if name == "run_terminal_command":
            if terminal.agent_owner != session.session_id:
                raise PermissionError(
                    "Create a terminal for this chat before sending commands; user terminals are read-only"
                )
            async with self._locks.setdefault(terminal.term_id, asyncio.Lock()):
                if terminal.exited:
                    raise ValueError("This terminal has exited; create another terminal")
                if terminal.local and Path(terminal.shell).name in {"bash", "zsh", "fish"}:
                    # A transport can attach before shell rc files finish. ZLE
                    # initialization can flush early input, so wait for its prompt.
                    async with asyncio.timeout(10):
                        while b"\x1b]633;ColoridePrompt" not in terminal.local_output:
                            terminal.local_output_changed.clear()
                            if terminal.exited:
                                raise ValueError("Terminal exited during startup")
                            await terminal.local_output_changed.wait()
                command = str(arguments["command"])
                if any(ord(char) < 32 and char not in "\n\t" for char in command):
                    raise ValueError("Terminal commands cannot contain control characters")
                foreground = await self.info(terminal.term_id)
                shell = Path(terminal.shell).name
                if foreground.foreground not in {shell, "bash", "zsh", "sh", "fish", "default"}:
                    raise ValueError("Terminal is busy; read its output or create a separate terminal")
                if terminal.local:
                    pid = getattr(terminal.local_process, "pid", None)
                    if terminal.local_master_fd is None or terminal.local_io is None or pid is None:
                        raise ValueError("Terminal is not ready")
                    if os.tcgetpgrp(terminal.local_master_fd) != pid:
                        raise ValueError("Terminal is busy; do not send input to its running process")
                    await terminal.local_io.write((command + "\r").encode())
                else:
                    await self.remote("write", terminal, command)
                if bool(arguments.get("_reveal", getattr(terminal, "agent_revealed", True))):
                    terminal.agent_revealed = True
                    await self.publish("term:reveal", self.describe(terminal))
            return {
                **self.describe(terminal),
                "status": "submitted",
                "message": (
                    "Command sent to the visible IDE terminal. Read its output. Submission is not proof "
                    "of completion or success; use execute_command for checks requiring an exit code."
                ),
            }
        lines = min(2000, max(1, int(arguments.get("lines", 100))))
        if terminal.local:
            raw = bytes(terminal.local_output).decode(errors="replace")
        else:
            raw = await self.remote("read", terminal, lines)
        text = _ANSI.sub("", raw).replace("\r\n", "\n").replace("\r", "\n")
        tail = text.splitlines()[-lines:]
        output = "\n".join(tail)[-40000:]
        return {
            **self.describe(terminal),
            "output": output,
            "truncated": len(text.splitlines()) > lines or len("\n".join(tail)) > 40000,
            "message": "Terminal snapshot; output alone does not establish an exit code.",
        }

    async def process_snapshot(
        self,
        terminal_id: str,
        session: AgentSession,
        lines: int,
    ) -> tuple[dict[str, Any], str, bool]:
        terminal = await self.get(terminal_id, session)
        snapshot = await self.execute(
            "read_terminal", {"terminal_id": terminal_id, "lines": lines}, session
        )
        foreground = await self.info(terminal_id)
        shell = Path(terminal.shell).name
        alive = not terminal.exited and foreground.foreground not in {
            shell, "bash", "zsh", "sh", "fish", "default"
        }
        return self.describe(terminal), str(snapshot.get("output") or ""), alive

    async def interrupt(self, terminal_id: str, session: AgentSession) -> dict[str, Any]:
        terminal = await self.get(terminal_id, session)
        if terminal.agent_owner != session.session_id:
            raise PermissionError("Only the chat that created this terminal can stop its process")
        if terminal.local:
            if terminal.local_io is None:
                raise ValueError("Terminal is not ready")
            await terminal.local_io.write(b"\x03")
        else:
            await self.remote("interrupt", terminal, None)
        return self.describe(terminal)
