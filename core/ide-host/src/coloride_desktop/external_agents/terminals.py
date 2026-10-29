"""ACP terminal callbacks. These processes are not Coloride agent tools."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from dataclasses import dataclass, field


@dataclass
class AcpTerminal:
    terminal_id: str
    session_id: str
    process: asyncio.subprocess.Process
    output: bytearray = field(default_factory=bytearray)
    truncated: bool = False
    limit: int = 1024 * 1024
    waiter: asyncio.Future[tuple[int | None, str | None]] | None = None
    reader: asyncio.Task[None] | None = None


class AcpTerminalBridge:
    def __init__(self) -> None:
        self._terminals: dict[str, AcpTerminal] = {}

    async def create(
        self,
        *,
        session_id: str,
        command: str,
        args: list[str],
        env: list[tuple[str, str]],
        cwd: str | None,
        output_byte_limit: int | None,
    ) -> str:
        environment = dict(os.environ)
        environment.update(dict(env))
        process = await asyncio.create_subprocess_exec(
            command,
            *args,
            cwd=cwd,
            env=environment,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        terminal_id = f"acp-term-{process.pid}"
        terminal = AcpTerminal(
            terminal_id=terminal_id,
            session_id=session_id,
            process=process,
            limit=output_byte_limit or 1024 * 1024,
        )
        terminal.reader = asyncio.create_task(self._read(terminal))
        self._terminals[terminal_id] = terminal
        return terminal_id

    async def output(self, terminal_id: str, *, owner: str | None = None) -> tuple[str, bool, dict | None]:
        terminal = self._require(terminal_id, owner)
        code = terminal.process.returncode
        status = (
            None
            if code is None
            else ({"exitCode": code} if code >= 0 else {"signal": signal.Signals(-code).name})
        )
        return terminal.output.decode("utf-8", errors="replace"), terminal.truncated, status

    async def wait(self, terminal_id: str, *, owner: str | None = None) -> tuple[int | None, str | None]:
        terminal = self._require(terminal_id, owner)
        await terminal.process.wait()
        if terminal.reader:
            await terminal.reader
        code = terminal.process.returncode
        signal_name = None
        if code is not None and code < 0:
            signal_name = signal.Signals(-code).name
            code = None
        return code, signal_name

    async def kill(self, terminal_id: str, *, owner: str | None = None) -> None:
        terminal = self._require(terminal_id, owner)
        if terminal.process.returncode is None and terminal.process.pid:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(terminal.process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(terminal.process.wait(), timeout=2)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(terminal.process.pid, signal.SIGKILL)
                await terminal.process.wait()

    async def release(self, terminal_id: str, *, owner: str | None = None) -> None:
        self._require(terminal_id, owner)
        await self.kill(terminal_id, owner=owner)
        terminal = self._require(terminal_id, owner)
        if terminal.process.pid:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(terminal.process.pid, signal.SIGKILL)
        terminal = self._terminals.pop(terminal_id, None)
        if terminal and terminal.reader:
            terminal.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await terminal.reader

    async def close_session(self, session_id: str) -> None:
        for terminal_id, terminal in list(self._terminals.items()):
            if terminal.session_id == session_id:
                await self.kill(terminal_id)
                await self.release(terminal_id)

    async def close_all(self) -> None:
        for terminal_id in list(self._terminals):
            await self.kill(terminal_id)
            await self.release(terminal_id)

    def _require(self, terminal_id: str, owner: str | None = None) -> AcpTerminal:
        terminal = self._terminals.get(terminal_id)
        if terminal is None or (owner is not None and terminal.session_id != owner):
            raise KeyError(terminal_id)
        return terminal

    async def _read(self, terminal: AcpTerminal) -> None:
        stream = terminal.process.stdout
        if stream is None:
            return
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                return
            room = terminal.limit - len(terminal.output)
            if room <= 0:
                terminal.truncated = True
                continue
            terminal.output.extend(chunk[:room])
            if len(chunk) > room:
                terminal.truncated = True
