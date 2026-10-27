"""Spawn language servers on the desktop host (local folder workspace)."""

from __future__ import annotations

import asyncio
import contextlib
import os
from types import SimpleNamespace
from typing import Any


class LocalLspProcess:
    """Make asyncio.subprocess look like the asyncssh process LSP sessions expect."""

    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self._process = process
        self.stdin = process.stdin
        self.stdout = process.stdout
        self.stderr = process.stderr

    @property
    def exit_status(self) -> int | None:
        return self._process.returncode

    def terminate(self) -> None:
        with contextlib.suppress(ProcessLookupError):
            self._process.terminate()

    def close(self) -> None:
        self.terminate()
        if self.stdin is not None:
            with contextlib.suppress(Exception):
                self.stdin.close()

    async def wait_closed(self) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self._process.wait(), timeout=5)


class LocalLspHandle:
    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self.process = LocalLspProcess(process)
        self.owned_connection = None


async def open_local_lsp_process(command: str, *, encoding: str | None = None) -> LocalLspHandle:
    del encoding
    shell = os.environ.get("SHELL") or "/bin/zsh"
    process = await asyncio.create_subprocess_exec(
        shell,
        "-lc",
        command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    return LocalLspHandle(process)


async def run_local_command(command: str, *, timeout: float = 200) -> Any:
    shell = os.environ.get("SHELL") or "/bin/zsh"
    process = await asyncio.create_subprocess_exec(
        shell,
        "-lc",
        command,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        with contextlib.suppress(Exception):
            await process.communicate()
        return SimpleNamespace(
            exit_status=124,
            returncode=124,
            stdout=b"",
            stderr=b"Command timed out after 200s without finishing.",
        )
    return SimpleNamespace(
        exit_status=process.returncode,
        returncode=process.returncode,
        stdout=stdout,
        stderr=stderr,
    )
