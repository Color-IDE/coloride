from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import shlex
import signal
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

RunCommand = Callable[[str], Awaitable[object]]
_SAFE_PROCESS_ID = re.compile(r"^proc_[a-f0-9]{16}$")


@dataclass(frozen=True, slots=True)
class AgentProcess:
    process_id: str
    session_id: str
    tmux_session: str
    command: str
    cwd: str
    created_at: str
    backend: str = "tmux"
    pid: int | None = None
    log_path: str | None = None
    terminal_id: str | None = None
    terminal_session_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.process_id,
            "sessionId": self.session_id,
            "tmuxSession": self.tmux_session,
            "command": self.command,
            "cwd": self.cwd,
            "createdAt": self.created_at,
            "backend": self.backend,
        }
        if self.pid is not None:
            payload["pid"] = str(self.pid)
        if self.log_path:
            payload["logPath"] = self.log_path
        if self.terminal_id:
            payload["termId"] = self.terminal_id
        if self.terminal_session_id:
            payload["terminalSessionId"] = self.terminal_session_id
        return payload


class AgentProcessRegistry:
    """Manage detached background jobs for agent start_process / read / stop.

    Remote workspaces keep using tmux so jobs survive SSH reconnects. Local
    Mac folders do not require tmux: the command is launched in its own
    process group and logged to a file in the agent-process store.
    """

    def __init__(self, run_command: RunCommand, root: Path | None = None) -> None:
        self.run_command = run_command
        self.root = root or Path.home() / ".coloride" / "desktop" / "agent-processes"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self._tmux_available: bool | None = None

    async def start(
        self,
        session_id: str,
        command: str,
        cwd: str,
        *,
        display_command: str | None = None,
        local: bool = False,
    ) -> AgentProcess:
        process_id = f"proc_{secrets.token_hex(8)}"
        handle = f"coloride_agent_{process_id.removeprefix('proc_')}"
        if await self._tmux_ready():
            return await self._start_tmux(
                process_id,
                handle,
                session_id,
                command,
                cwd,
                display_command=display_command,
            )
        if local:
            return await self._start_local_native(
                process_id,
                handle,
                session_id,
                command,
                cwd,
                display_command=display_command,
            )
        return await self._start_local_shell(
            process_id,
            handle,
            session_id,
            command,
            cwd,
            display_command=display_command,
        )

    async def read(
        self,
        session_id: str,
        process_id: str,
        lines: int,
    ) -> tuple[AgentProcess, str, bool]:
        process = self._require(process_id, session_id)
        amount = max(10, min(lines, 2_000))
        if process.backend == "local":
            output = self._read_log_tail(process, amount)
            return process, output, await self._alive(process)
        capture = await self.run_command(
            f"tmux capture-pane -p -t {shlex.quote(process.tmux_session)} "
            f"-S -{amount} 2>/dev/null"
        )
        return process, _output(capture), await self._alive(process)

    async def stop(self, session_id: str, process_id: str) -> AgentProcess:
        process = self._require(process_id, session_id)
        if process.backend == "local":
            await self._stop_local(process)
            return process
        await self.run_command(
            f"tmux kill-session -t {shlex.quote(process.tmux_session)} 2>/dev/null || true"
        )
        return process

    def list(self, session_id: str) -> list[AgentProcess]:
        values: list[AgentProcess] = []
        for path in self.root.glob("proc_*.json"):
            process = self._read(path)
            if process is not None and process.session_id == session_id:
                values.append(process)
        return sorted(values, key=lambda value: value.created_at, reverse=True)

    def register_terminal(
        self,
        session_id: str,
        command: str,
        cwd: str,
        terminal: dict[str, Any],
    ) -> AgentProcess:
        process = AgentProcess(
            process_id=f"proc_{secrets.token_hex(8)}",
            session_id=session_id,
            tmux_session="",
            command=command,
            cwd=cwd,
            created_at=datetime.now(UTC).isoformat(),
            backend="terminal",
            terminal_id=str(terminal["termId"]),
            terminal_session_id=str(terminal["sessionId"]),
        )
        self._write(process)
        return process

    def require(self, session_id: str, process_id: str) -> AgentProcess:
        return self._require(process_id, session_id)

    async def _start_tmux(
        self,
        process_id: str,
        handle: str,
        session_id: str,
        command: str,
        cwd: str,
        *,
        display_command: str | None,
    ) -> AgentProcess:
        script = f"exec {command}"
        launch = (
            f"tmux new-session -d -s {shlex.quote(handle)} "
            f"-c {shlex.quote(cwd)} bash -lc {shlex.quote(script)}"
        )
        result = await self.run_command(launch)
        status = _status(result)
        if status != 0:
            raise RuntimeError(_output(result) or f"tmux exited with code {status}")
        process = AgentProcess(
            process_id=process_id,
            session_id=session_id,
            tmux_session=handle,
            command=display_command or command,
            cwd=cwd,
            created_at=datetime.now(UTC).isoformat(),
            backend="tmux",
        )
        self._write(process)
        return process

    async def _start_local_native(
        self,
        process_id: str,
        handle: str,
        session_id: str,
        command: str,
        cwd: str,
        *,
        display_command: str | None,
    ) -> AgentProcess:
        log_path = self.root / f"{process_id}.log"
        log_file = log_path.open("ab")
        try:
            child = await asyncio.create_subprocess_exec(
                os.environ.get("SHELL") or "/bin/zsh",
                "-lc",
                command,
                cwd=cwd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=log_file,
                stderr=log_file,
                start_new_session=True,
            )
        finally:
            log_file.close()
        if child.pid is None:
            raise RuntimeError("Background process started without a pid")
        process = AgentProcess(
            process_id=process_id,
            session_id=session_id,
            tmux_session=handle,
            command=display_command or command,
            cwd=cwd,
            created_at=datetime.now(UTC).isoformat(),
            backend="local",
            pid=int(child.pid),
            log_path=str(log_path),
        )
        self._write(process)
        return process

    async def _start_local_shell(
        self,
        process_id: str,
        handle: str,
        session_id: str,
        command: str,
        cwd: str,
        *,
        display_command: str | None,
    ) -> AgentProcess:
        log_path = self.root / f"{process_id}.log"
        pid_path = self.root / f"{process_id}.pid"
        quoted_log = shlex.quote(str(log_path))
        quoted_pid = shlex.quote(str(pid_path))
        launch = (
            f"cd {shlex.quote(cwd)} && "
            f"nohup /bin/zsh -lc {shlex.quote(command)} "
            f"> {quoted_log} 2>&1 < /dev/null & "
            f"echo $! > {quoted_pid}"
        )
        result = await self.run_command(launch)
        status = _status(result)
        if status != 0:
            raise RuntimeError(_output(result) or f"background process exited with code {status}")
        pid = _read_pid(pid_path)
        if pid is None:
            raise RuntimeError(_output(result) or "Background process started without a pid")
        process = AgentProcess(
            process_id=process_id,
            session_id=session_id,
            tmux_session=handle,
            command=display_command or command,
            cwd=cwd,
            created_at=datetime.now(UTC).isoformat(),
            backend="local",
            pid=pid,
            log_path=str(log_path),
        )
        self._write(process)
        return process

    async def _stop_local(self, process: AgentProcess) -> None:
        if process.pid is None:
            return
        try:
            os.killpg(int(process.pid), signal.SIGTERM)
            return
        except (ProcessLookupError, PermissionError, OSError):
            pass
        await self.run_command(
            "kill -TERM -"
            f"{int(process.pid)} 2>/dev/null || "
            f"kill -TERM {int(process.pid)} 2>/dev/null || true"
        )

    async def _tmux_ready(self) -> bool:
        if self._tmux_available is not None:
            return self._tmux_available
        result = await self.run_command("command -v tmux >/dev/null 2>&1")
        self._tmux_available = _status(result) == 0
        return self._tmux_available

    async def _alive(self, process: AgentProcess) -> bool:
        if process.backend == "local":
            if process.pid is None:
                return False
            result = await self.run_command(
                f"kill -0 {int(process.pid)} >/dev/null 2>&1"
            )
            return _status(result) == 0
        result = await self.run_command(
            f"tmux has-session -t {shlex.quote(process.tmux_session)} 2>/dev/null"
        )
        return _status(result) == 0

    def _read_log_tail(self, process: AgentProcess, lines: int) -> str:
        if not process.log_path:
            return ""
        path = Path(process.log_path)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        values = text.splitlines()
        return "\n".join(values[-lines:])

    def _require(self, process_id: str, session_id: str) -> AgentProcess:
        process = self._read(self._path(process_id))
        if process is None or process.session_id != session_id:
            raise KeyError(process_id)
        return process

    def _write(self, process: AgentProcess) -> None:
        path = self._path(process.process_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(process.to_dict(), ensure_ascii=True), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)

    def _read(self, path: Path) -> AgentProcess | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            pid_raw = value.get("pid")
            pid = int(pid_raw) if pid_raw not in (None, "") else None
            return AgentProcess(
                process_id=str(value["id"]),
                session_id=str(value["sessionId"]),
                tmux_session=str(value["tmuxSession"]),
                command=str(value["command"]),
                cwd=str(value["cwd"]),
                created_at=str(value["createdAt"]),
                backend=str(value.get("backend") or "tmux"),
                pid=pid,
                log_path=str(value["logPath"]) if value.get("logPath") else None,
                terminal_id=str(value["termId"]) if value.get("termId") else None,
                terminal_session_id=(
                    str(value["terminalSessionId"]) if value.get("terminalSessionId") else None
                ),
            )
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def _path(self, process_id: str) -> Path:
        if not _SAFE_PROCESS_ID.fullmatch(process_id):
            raise ValueError("Invalid agent process identifier")
        return self.root / f"{process_id}.json"


def _status(result: object) -> int:
    value = getattr(result, "exit_status", 0)
    return int(value) if isinstance(value, int) else 0


def _output(result: object) -> str:
    stdout = str(getattr(result, "stdout", "") or "")
    stderr = str(getattr(result, "stderr", "") or "")
    return "\n".join(value for value in (stdout.strip(), stderr.strip()) if value)


def _read_pid(path: Path) -> int | None:
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not raw.isdigit():
        return None
    return int(raw)
