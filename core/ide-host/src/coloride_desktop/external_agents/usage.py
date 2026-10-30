"""Read account limits through the installed Codex app-server, without starting a turn."""
from __future__ import annotations

import asyncio
import json
import math
import time
import uuid
from pathlib import Path
from typing import Any

from .installer import ExternalAgentInstaller
from .models import InstallationRecord, utc_now
from .processes import ProcessRegistry
from .runtimes import resolve_node


def quota_windows(result: dict[str, Any]) -> list[dict[str, Any]]:
    buckets = result.get("rateLimitsByLimitId")
    snapshot = buckets.get("codex") if isinstance(buckets, dict) else None
    if not isinstance(snapshot, dict):
        snapshot = result.get("rateLimits")
    if not isinstance(snapshot, dict):
        return []
    windows = []
    for key in ("primary", "secondary"):
        window = snapshot.get(key)
        if not isinstance(window, dict):
            continue
        percent, minutes, resets = (window.get(field) for field in ("usedPercent", "windowDurationMins", "resetsAt"))
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
               for value in (percent, minutes)) or minutes <= 0 or not 0 <= percent <= 100:
            continue
        windows.append({"usedPercent": percent, "windowMinutes": minutes,
                        "resetsAt": resets if isinstance(resets, (int, float)) and not isinstance(resets, bool)
                        and math.isfinite(resets) and resets > 0 else None})
    return windows


class AgentUsageReader:
    def __init__(self, installer: ExternalAgentInstaller) -> None:
        self.installer = installer
        self.processes = ProcessRegistry()
        self.cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.pending: dict[str, asyncio.Task[dict[str, Any]]] = {}

    async def read(self, installation: InstallationRecord) -> dict[str, Any]:
        cached = self.cache.get(installation.id)
        if cached and time.monotonic() - cached[0] < 60:
            return cached[1]
        task = self.pending.get(installation.id)
        if task is None:
            task = asyncio.create_task(self._refresh(installation))
            self.pending[installation.id] = task
            task.add_done_callback(lambda done: self.pending.pop(installation.id, None))
        return await asyncio.shield(task)

    async def shutdown(self) -> None:
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.processes.stop_all()

    async def _refresh(self, installation: InstallationRecord) -> dict[str, Any]:
        payload = {"agentId": installation.agent_id, "name": installation.name,
                   "status": "unsupported", "windows": [], "updatedAt": None}
        if installation.agent_id in {"codex", "codex-acp"}:
            payload["status"] = "unavailable"
            try:
                async with asyncio.timeout(12):
                    windows = quota_windows(await self._codex_limits(installation))
                if windows:
                    payload.update(status="available", windows=windows, updatedAt=utc_now())
            except (OSError, RuntimeError, ValueError, TimeoutError):
                pass  # Account/provider failures must never block the local IDE or expose credentials.
        self.cache[installation.id] = (time.monotonic(), payload)
        return payload

    async def _codex_limits(self, installation: InstallationRecord) -> dict[str, Any]:
        if not installation.location:
            raise RuntimeError("The installation directory is unavailable.")
        _executable, _args, env = self.installer.launch_command(installation)
        configured = env.get("CODEX_PATH")
        if configured:
            command = [configured]
        else:
            script = Path(installation.location) / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
            if not script.is_file():
                raise RuntimeError("The installed adapter does not bundle Codex.")
            command = [resolve_node(self.installer.runtime_root).executable, str(script)]
        process_id = f"usage-{uuid.uuid4().hex}"
        owned = await self.processes.spawn(process_id=process_id, session_id=process_id,
            executable=command[0], args=[*command[1:], "app-server"], cwd=installation.location, env=env)
        process = owned.process
        try:
            assert process.stdin and process.stdout

            async def rpc(request_id: int, method: str, params: dict | None = None) -> dict:
                message = {"id": request_id, "method": method}
                if params is not None:
                    message["params"] = params
                process.stdin.write(json.dumps(message).encode() + b"\n")
                await process.stdin.drain()
                while line := await process.stdout.readline():
                    response = json.loads(line)
                    if response.get("id") != request_id:
                        continue
                    if "error" in response or not isinstance(response.get("result"), dict):
                        raise RuntimeError("Account limits are unavailable.")
                    return response["result"]
                raise RuntimeError("Codex exited before returning account limits.")

            await rpc(1, "initialize", {"clientInfo": {"name": "coloride", "title": "Coloride", "version": "0.1.28"}})
            process.stdin.write(b'{"method":"initialized"}\n')
            await process.stdin.drain()
            return await rpc(2, "account/rateLimits/read")
        finally:
            await self.processes.stop(process_id)
