"""Reuse one language-server session per workspace root + server id."""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Awaitable, Callable
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

from .bootstrap import resolve_language_server
from .servers import language_server_for
from .session import LspSession, new_session_id

OpenProcess = Callable[..., Awaitable[Any]]
RunCommand = Callable[[str], Awaitable[Any]]


class LspRegistry:
    def __init__(self, open_process: OpenProcess, run_command: RunCommand) -> None:
        self._open_process = open_process
        self._run_command = run_command
        self._sessions: dict[str, LspSession] = {}
        self._lock = asyncio.Lock()
        self._boot_locks: dict[str, asyncio.Lock] = {}

    def list_sessions(self) -> list[dict[str, Any]]:
        return [session.to_info() for session in self._sessions.values()]

    def get(self, session_id: str) -> LspSession | None:
        return self._sessions.get(session_id)

    def _boot_lock(self, server_id: str) -> asyncio.Lock:
        lock = self._boot_locks.get(server_id)
        if lock is None:
            lock = asyncio.Lock()
            self._boot_locks[server_id] = lock
        return lock

    def _live(self, root: str, server_id: str) -> LspSession | None:
        for session in self._sessions.values():
            if (
                session.root_path == root
                and session.language == server_id
                and session.status in ("ready", "starting")
            ):
                return session
        return None

    async def start(self, language: str, root_path: str) -> LspSession:
        if not _is_absolute_root(root_path):
            raise ValueError("rootPath must be an absolute workspace path")
        spec = language_server_for(language)
        if spec is None:
            raise RuntimeError(f"No language server is configured for {language}")
        root = root_path.rstrip("/") or "/"

        async with self._lock:
            existing = self._live(root, spec.id)
            if existing is not None:
                existing.touch()
                return existing

        async with self._boot_lock(spec.id):
            print(f"[lsp:{spec.id}] resolving binary…", file=sys.stderr)
            argv, detail = await resolve_language_server(self._run_command, spec)
        if argv is None:
            raise RuntimeError(detail or f"{spec.id} is not available on the remote host")

        async with self._lock:
            existing = self._live(root, spec.id)
            if existing is not None:
                existing.touch()
                return existing

            session = LspSession(
                session_id=new_session_id(),
                root_path=root,
                command="\x00".join(argv),
                language=spec.id,
            )
            self._sessions[session.session_id] = session

        try:
            await session.start(self._open_process)
        except Exception:
            async with self._lock:
                self._sessions.pop(session.session_id, None)
            raise
        return session

    async def stop(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        await session.close()
        return True

    async def close_all(self) -> None:
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            await session.close()

    async def document_symbols(self, root_path: str, path: str) -> list[dict[str, Any]]:
        """Query an already-running server; never boot one for background indexing."""
        language = _language_for_path(path)
        spec = language_server_for(language)
        if spec is None:
            return []
        session = self._live(root_path.rstrip("/") or "/", spec.id)
        if session is None or session.status != "ready":
            return []
        uri = "file://" + quote(path, safe="/:@")
        try:
            result = await session.request(
                "textDocument/documentSymbol",
                {"textDocument": {"uri": uri}},
            )
        except Exception:
            return []
        return _normalize_document_symbols(result)


def _is_absolute_root(path: str) -> bool:
    if not path or "\x00" in path:
        return False
    if path.startswith("/"):
        return True
    return len(path) >= 3 and path[0].isalpha() and path[1] == ":" and path[2] in "\\/"


def _language_for_path(path: str) -> str:
    name = PurePosixPath(path).name.casefold()
    suffix = PurePosixPath(path).suffix.casefold()
    if name == "dockerfile":
        return "dockerfile"
    return {
        ".ts": "typescript",
        ".tsx": "typescriptreact",
        ".js": "javascript",
        ".jsx": "javascriptreact",
        ".py": "python",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
        ".rb": "ruby",
        ".php": "php",
        ".json": "json",
        ".css": "css",
        ".scss": "scss",
        ".html": "html",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".sh": "shell",
        ".toml": "toml",
        ".md": "markdown",
    }.get(suffix, "")


def _normalize_document_symbols(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    symbols: list[dict[str, Any]] = []

    def visit(item: Any) -> None:
        if not isinstance(item, dict):
            return
        location = item.get("location") if isinstance(item.get("location"), dict) else {}
        range_value = item.get("range") if isinstance(item.get("range"), dict) else {}
        if not range_value and isinstance(location, dict):
            range_value = location.get("range") if isinstance(location.get("range"), dict) else {}
        start = range_value.get("start") if isinstance(range_value.get("start"), dict) else {}
        end = range_value.get("end") if isinstance(range_value.get("end"), dict) else start
        name = str(item.get("name") or "")
        if name:
            symbols.append(
                {
                    "name": name,
                    "kind": f"lsp:{int(item.get('kind') or 0)}",
                    "startLine": int(start.get("line") or 0) + 1,
                    "endLine": int(end.get("line") or start.get("line") or 0) + 1,
                }
            )
        for child in item.get("children") or []:
            visit(child)

    for item in value:
        visit(item)
        if len(symbols) >= 500:
            break
    return symbols[:500]
