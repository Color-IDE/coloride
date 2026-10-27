"""Private stdio transport to the Coloride turn scheduler.

The module, class and environment names retain compatibility with older hosts.
Python owns credentials, context, providers, policy and workspace execution.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


class ClineRuntimeError(RuntimeError):
    pass


def _runtime_candidates() -> list[Path]:
    """Ordered host paths. A missing COLORIDE_CLINE_RUNTIME must not hide later files.

    Electron always sets that env var. On Windows dev checkouts the esbuild
    bundle is gitignored and often absent, so discovery has to keep looking.
    """
    candidates: list[Path] = []
    override = (os.environ.get("COLORIDE_CLINE_RUNTIME") or "").strip()
    if override:
        candidates.append(Path(override))
    meipass = getattr(sys, "_MEIPASS", "")
    if meipass:
        candidates.append(Path(meipass) / "agent-runtime" / "cline-runtime.mjs")
    root = Path(__file__).resolve().parents[5]
    # Prefer the packaged bundle used by Electron and release builds.
    candidates.append(root / "client" / "desktop" / "resources" / "agent-runtime" / "cline-runtime.mjs")
    return candidates


def bundled_runtime_script() -> Path | None:
    """Locate the bundled scheduler."""
    seen: set[Path] = set()
    for path in _runtime_candidates():
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file():
            return resolved
    return None


def runtime_executable() -> str | None:
    override = (os.environ.get("COLORIDE_AGENT_NODE") or "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return str(path)
        # Electron.exe is still usable as Node when ELECTRON_RUN_AS_NODE=1 even
        # if a stale env value pointed at a moved binary; keep shutil.which.
    return shutil.which("node") or shutil.which("node.exe")


class ClineRuntime:
    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr = ""

    async def start(
        self,
        *,
        session_id: str,
        mode: str,
        tools: list[dict[str, Any]],
        allowed_tools: list[str] | None = None,
        retry_delay_ms: int | None = None,
    ) -> None:
        script = bundled_runtime_script()
        executable = runtime_executable()
        if script is None:
            raise ClineRuntimeError(
                "The Coloride runtime is missing. Rebuild Coloride; no external agent installation is used."
            )
        if not executable:
            raise ClineRuntimeError(
                "The Coloride runtime needs Electron's embedded Node "
                "(COLORIDE_AGENT_NODE). No external agent installation is used."
            )
        env = dict(os.environ)
        if os.environ.get("COLORIDE_AGENT_NODE"):
            env["ELECTRON_RUN_AS_NODE"] = "1"
        for key in list(env):
            if any(marker in key.upper() for marker in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "AUTHORIZATION")):
                env.pop(key, None)
        self.process = await asyncio.create_subprocess_exec(
            executable,
            str(script),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            limit=16 * 1024 * 1024,
        )
        self._stderr_task = asyncio.create_task(self._drain_stderr())
        await self._send({
            "op": "start",
            "sessionId": session_id,
            "mode": mode,
            "tools": tools,
            "allowedTools": allowed_tools or [str(tool.get("name") or "") for tool in tools],
            **({"retryDelayMs": retry_delay_ms} if retry_delay_ms is not None else {}),
        })

    async def _drain_stderr(self) -> None:
        assert self.process and self.process.stderr
        while data := await self.process.stderr.read(4096):
            self._stderr = (self._stderr + data.decode(errors="replace"))[-4000:]

    async def receive(self, cancel_event: asyncio.Event) -> dict[str, Any]:
        assert self.process and self.process.stdout
        reader = asyncio.create_task(self.process.stdout.readline())
        cancelled = asyncio.create_task(cancel_event.wait())
        try:
            await asyncio.wait({reader, cancelled}, return_when=asyncio.FIRST_COMPLETED)
            if cancel_event.is_set() and not reader.done():
                # Abort the scheduler before Python unwinds, so a model
                # stream or tool callback cannot continue after Stop.
                with contextlib.suppress(Exception):
                    await self._send({"op": "cancel", "reason": "Cancelled by user"})
                raise asyncio.CancelledError()
            line = reader.result() if reader.done() else await reader
        finally:
            for task in (reader, cancelled):
                if not task.done():
                    task.cancel()
            await asyncio.gather(reader, cancelled, return_exceptions=True)
        if not line:
            detail = f" {self._stderr.strip()}" if self._stderr.strip() else ""
            raise ClineRuntimeError(f"Coloride runtime exited before completing the turn.{detail}")
        try:
            value = json.loads(line)
        except ValueError as exc:
            raise ClineRuntimeError("Coloride runtime returned an invalid transport message.") from exc
        if not isinstance(value, dict):
            raise ClineRuntimeError("Coloride runtime returned an invalid transport message.")
        return value

    async def reply(self, request: dict[str, Any], result: dict[str, Any]) -> None:
        await self._send({"id": request["id"], "result": result})

    async def fail(self, request: dict[str, Any], error: str) -> None:
        await self._send({"id": request["id"], "error": error})

    async def _send(self, value: dict[str, Any]) -> None:
        process = self.process
        if process is None or process.stdin is None:
            raise ClineRuntimeError("Coloride runtime is not running.")
        try:
            if process.returncode is not None or process.stdin.is_closing():
                raise BrokenPipeError("Runtime input is closed")
            process.stdin.write((json.dumps(value, ensure_ascii=True) + "\n").encode())
            await process.stdin.drain()
        except (OSError, RuntimeError) as exc:
            detail = f" {self._stderr.strip()}" if self._stderr.strip() else ""
            raise ClineRuntimeError(
                "Coloride runtime closed before receiving the tool/model result."
                f"{detail}"
            ) from exc

    async def close(self) -> None:
        process = self.process
        if process is not None and process.returncode is None:
            with contextlib.suppress(ClineRuntimeError, BrokenPipeError, ConnectionResetError, AssertionError):
                await self._send({"op": "cancel", "reason": "Coloride host closed the turn"})
                assert process.stdin
                process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                await process.wait()
        if self._stderr_task:
            self._stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stderr_task
