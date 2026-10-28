"""One ACP process per open external conversation."""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from dataclasses import dataclass, field


@dataclass
class OwnedProcess:
    process_id: str
    session_id: str
    command: tuple[str, ...]
    process: asyncio.subprocess.Process
    stderr_task: asyncio.Task[None] | None = None
    stderr: bytearray = field(default_factory=bytearray)
    exited: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def pid(self) -> int | None:
        return self.process.pid

    @property
    def returncode(self) -> int | None:
        return self.process.returncode


class ProcessRegistry:
    def __init__(self) -> None:
        self._processes: dict[str, OwnedProcess] = {}

    def get(self, process_id: str) -> OwnedProcess | None:
        return self._processes.get(process_id)

    def by_session(self, session_id: str) -> OwnedProcess | None:
        return next((item for item in self._processes.values() if item.session_id == session_id), None)

    async def spawn(
        self,
        *,
        process_id: str,
        session_id: str,
        executable: str,
        args: list[str],
        cwd: str,
        env: dict[str, str] | None = None,
    ) -> OwnedProcess:
        existing = self.by_session(session_id)
        if existing is not None:
            await self.stop(existing.process_id)
        process = await asyncio.create_subprocess_exec(
            executable,
            *args,
            cwd=cwd,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        owned = OwnedProcess(
            process_id=process_id,
            session_id=session_id,
            command=(executable, *args),
            process=process,
        )
        owned.stderr_task = asyncio.create_task(self._drain_stderr(owned))
        self._processes[process_id] = owned
        asyncio.create_task(self._watch_exit(owned))
        return owned

    async def stop(self, process_id: str) -> None:
        owned = self._processes.pop(process_id, None)
        if owned is None:
            return
        process = owned.process
        if process.returncode is None and process.pid:
            await self._terminate_group(process.pid)
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except TimeoutError:
                await self._kill_group(process.pid)
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                await process.wait()
        if owned.stderr_task:
            owned.stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await owned.stderr_task
        owned.exited.set()

    async def stop_all(self) -> None:
        for process_id in list(self._processes):
            await self.stop(process_id)

    async def _drain_stderr(self, owned: OwnedProcess) -> None:
        stream = owned.process.stderr
        if stream is None:
            return
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                return
            owned.stderr.extend(chunk)
            if len(owned.stderr) > 64_000:
                del owned.stderr[:-32_000]

    async def _watch_exit(self, owned: OwnedProcess) -> None:
        await owned.process.wait()
        owned.exited.set()

    async def _terminate_group(self, pid: int) -> None:
        await asyncio.to_thread(self._signal_group, pid, signal.SIGTERM)

    async def _kill_group(self, pid: int) -> None:
        await asyncio.to_thread(self._signal_group, pid, signal.SIGKILL)

    def _signal_group(self, pid: int, sig: signal.Signals) -> None:
        try:
            os.killpg(pid, sig)
        except (ProcessLookupError, PermissionError):
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.kill(pid, sig)
