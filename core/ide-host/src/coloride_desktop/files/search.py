"""Transport and lifecycle for the same private search worker on local and SSH workspaces."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import json
import shlex
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

Runner = Callable[[str], Awaitable[Any]]
RemoteBinding = Callable[[str | None], tuple[str, Runner]]


class SearchConnectionError(RuntimeError):
    """The bound SSH transport is no longer the authorized workspace transport."""


@dataclass
class _Workspace:
    key: tuple[str, str, str]
    root: str
    cache: str
    worker: str
    runner: Runner | None = None
    process: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    ready: asyncio.Event | None = None
    error: Exception | None = None
    created: float = 0


class ProjectSearchService:
    """At most two warm workspaces; SSH runners capture a concrete connection.

    Workers keep an on-disk lease, so an unexpected desktop exit cannot leave
    a permanent indexer on a VPS. No model/API calls are made by this service.
    """

    def __init__(self, cache_dir: Path | None = None, remote_binding: RemoteBinding | None = None):
        self.cache_dir = cache_dir or Path.home() / ".cache" / "coloride" / "search"
        self.remote_binding = remote_binding
        self._workspaces: dict[tuple[str, str, str], _Workspace] = {}
        self._closed = False
        self._lock = asyncio.Lock()

    async def warm(self, root: str, *, kind: str = "local", connection_id: str | None = None) -> _Workspace:
        async with self._lock:
            return await self._warm(root, kind=kind, connection_id=connection_id)

    async def _warm(self, root: str, *, kind: str, connection_id: str | None) -> _Workspace:
        if self._closed:
            raise RuntimeError("Project search is closed")
        runner = None
        identity = "local"
        if kind == "local":
            root = str(Path(root).expanduser().resolve(strict=True))
            if not Path(root).is_dir():
                raise NotADirectoryError(root)
        elif kind == "ssh" and self.remote_binding is not None:
            identity, runner = self.remote_binding(connection_id)
        else:
            raise RuntimeError("Indexed search has no bound SSH connection")
        key = (kind, identity, root)
        existing = self._workspaces.pop(key, None)
        if existing is not None and existing.error and time.monotonic() - existing.created > 30:
            await self._stop(existing)
            existing = None
        if existing is not None:
            self._workspaces[key] = existing
            return existing
        # Bound aggregate indexing work too, not just CPU consumption per worker.
        while len(self._workspaces) >= 2:
            oldest = self._workspaces.pop(next(iter(self._workspaces)))
            await self._stop(oldest)
        workspace = _Workspace(
            key=key,
            root=root,
            cache=str(self.cache_dir),
            worker=str(Path(__file__).with_name("search_worker.py")),
            runner=runner,
            ready=asyncio.Event(),
            created=time.monotonic(),
        )
        self._workspaces[key] = workspace
        workspace.task = asyncio.create_task(self._maintain(workspace), name="project-search-index")
        return workspace

    async def search(
        self, root: str, query: str, *, kind: str = "local", connection_id: str | None = None, **options: Any
    ) -> dict[str, Any]:
        workspace = await self.warm(root, kind=kind, connection_id=connection_id)
        assert workspace.ready is not None
        await asyncio.wait_for(workspace.ready.wait(), timeout=12)
        if workspace.error:
            raise workspace.error
        request = {"query": query, **options}
        if workspace.runner:
            encoded = base64.b64encode(json.dumps(request).encode()).decode()
            # Only base64 is interpolated, and shell operands are always quoted.
            command = (
                f"printf %s {shlex.quote(encoded)} | base64 -d | "
                f"python3 {shlex.quote(workspace.worker)} search "
                f"--root {shlex.quote(root)} --cache-dir {shlex.quote(workspace.cache)}"
            )
            result = await asyncio.wait_for(workspace.runner(command), timeout=15)
            response = self._decode(result)
        else:
            response = await self._local_command(workspace, "search", request=request)
        for match in response.get("matches", []):
            path = PurePosixPath(match["path"])
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError("Search worker returned a path outside its workspace")
            match["path"] = str(PurePosixPath(workspace.root) / path)
        return response

    async def _maintain(self, workspace: _Workspace) -> None:
        try:
            if workspace.runner:
                await self._install_remote(workspace)
                command = (
                    f"nohup python3 {shlex.quote(workspace.worker)} index "
                    f"--root {shlex.quote(workspace.root)} --cache-dir {shlex.quote(workspace.cache)} "
                    "--watch --idle-seconds 120 </dev/null >/dev/null 2>&1 &"
                )
                result = await asyncio.wait_for(workspace.runner(command), timeout=12)
                if getattr(result, "exit_status", 0) != 0:
                    raise RuntimeError("Could not start the VPS search worker")
            else:
                workspace.process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    workspace.worker,
                    "index",
                    "--root",
                    workspace.root,
                    "--cache-dir",
                    workspace.cache,
                    "--watch",
                    "--idle-seconds",
                    "120",
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                    start_new_session=True,
                )
            assert workspace.ready is not None
            workspace.ready.set()
            while True:
                if workspace.runner:
                    command = (
                        f"python3 {shlex.quote(workspace.worker)} lease "
                        f"--root {shlex.quote(workspace.root)} --cache-dir {shlex.quote(workspace.cache)}"
                    )
                    result = await asyncio.wait_for(workspace.runner(command), timeout=10)
                    if getattr(result, "exit_status", 0) != 0:
                        raise RuntimeError("VPS search lease could not be renewed")
                else:
                    from .search_worker import touch_lease

                    await asyncio.to_thread(touch_lease, workspace.root, workspace.cache)
                    if workspace.process is not None and workspace.process.returncode is not None:
                        raise RuntimeError("Project indexer stopped; live search remains available")
                await asyncio.sleep(30)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            workspace.error = exc
        finally:
            assert workspace.ready is not None
            workspace.ready.set()

    async def _install_remote(self, workspace: _Workspace) -> None:
        files = {}
        for name in ("search_worker.py", "search_semantic.py"):
            source = Path(__file__).with_name(name)
            if source.exists():
                files[name] = source.read_text(encoding="utf-8")
        digest = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:20]
        # Run installation on the already-bound connection. Never consult a
        # mutable global connection after scheduling this background task.
        payload = base64.b64encode(json.dumps(files).encode()).decode()
        installer = (
            "import os,json,base64,pathlib,tempfile; os.umask(0o077); "
            "cache=pathlib.Path.home()/'.cache'/'coloride'/'search'; "
            f"dest=cache/'workers'/{digest!r}; dest.mkdir(parents=True,exist_ok=True); "
            f"files=json.loads(base64.b64decode({payload!r})); "
            "exec('for name,data in files.items():\\n "
            "with tempfile.NamedTemporaryFile(dir=dest,delete=False) as f:\\n  "
            'f.write(data.encode("utf-8"))\\n os.replace(f.name,dest/name)\'); '
            "print(json.dumps({'worker':str(dest/'search_worker.py'),'cache':str(cache)}))"
        )
        assert workspace.runner is not None
        result = await asyncio.wait_for(workspace.runner("python3 -c " + shlex.quote(installer)), timeout=12)
        response = self._decode(result)
        workspace.worker, workspace.cache = response["worker"], response["cache"]

    @staticmethod
    def _decode(result: Any) -> dict[str, Any]:
        # Some hosts print a login banner. The worker emits one JSON line.
        for line in reversed(str(getattr(result, "stdout", "") or "").splitlines()):
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                if value.get("error"):
                    raise RuntimeError(str(value.get("message") or value["error"])[:500])
                if getattr(result, "exit_status", 0) != 0:
                    break
                return value
        if getattr(result, "exit_status", 0) != 0:
            raise RuntimeError(str(getattr(result, "stderr", "") or "Search worker failed")[:500])
        raise RuntimeError("Search worker returned no valid result")

    async def _local_command(
        self, workspace: _Workspace, action: str, request: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            workspace.worker,
            action,
            "--root",
            workspace.root,
            "--cache-dir",
            workspace.cache,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(process.communicate(json.dumps(request or {}).encode()), 15)
        except BaseException:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
            raise
        from types import SimpleNamespace

        return self._decode(
            SimpleNamespace(stdout=out.decode(), stderr=err.decode(), exit_status=process.returncode)
        )

    async def _stop(self, workspace: _Workspace) -> None:
        if workspace.task:
            workspace.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await workspace.task
        if workspace.process and workspace.process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                workspace.process.terminate()
            try:
                await asyncio.wait_for(workspace.process.wait(), 2)
            except TimeoutError:
                workspace.process.kill()
                await workspace.process.wait()
        # Remote workers exit after the bounded lease. Do not issue late shell
        # commands during a disconnect or accidentally stop another desktop's worker.

    async def disconnect(self, connection_id: str | None = None) -> None:
        async with self._lock:
            for key, workspace in list(self._workspaces.items()):
                if key[0] == "ssh":
                    self._workspaces.pop(key, None)
                    await self._stop(workspace)

    async def close(self) -> None:
        async with self._lock:
            self._closed = True
            values = list(self._workspaces.values())
            self._workspaces.clear()
            for workspace in values:
                await self._stop(workspace)
