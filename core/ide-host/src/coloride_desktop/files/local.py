from __future__ import annotations

import asyncio
import base64
import fnmatch
import os
import shutil
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from ..models import ContentSearchMatch, Entry
from .service import (
    EditorContentTooLargeError,
    FileVersionRequiredError,
    MAX_EDIT_BYTES,
    MAX_UPLOAD_BYTES,
    PartialFileWriteBlockedError,
    RemotePath,
)


class LocalFileService:
    """Local filesystem adapter with the selected directory as its relative-path base."""

    def __init__(self, root: str) -> None:
        selected = Path(root).expanduser().resolve(strict=True)
        if not selected.is_dir():
            raise NotADirectoryError(str(selected))
        self.root = selected

    def normalize(self, path: str) -> RemotePath:
        return RemotePath(path=str(self._safe(path, follow_leaf=False)))

    def _safe(self, path: str, *, follow_leaf: bool = True) -> Path:
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = self.root / candidate
        # Resolve the parent separately when operating on a missing leaf.
        if follow_leaf or candidate.exists():
            resolved = candidate.resolve(strict=False)
        else:
            resolved = candidate.parent.resolve(strict=False) / candidate.name
        return resolved

    @staticmethod
    def _entry(path: Path) -> Entry:
        info = path.lstat()
        kind: Literal["file", "dir", "link"]
        if path.is_symlink():
            kind = "link"
        elif path.is_dir():
            kind = "dir"
        else:
            kind = "file"
        return Entry(
            name=path.name,
            path=str(path),
            kind=kind,
            size=0 if kind == "dir" else info.st_size,
            mtime=datetime.fromtimestamp(info.st_mtime, UTC),
        )

    async def list(self, path: str, offset: int = 0, limit: int = 500) -> list[Entry]:
        directory = self._safe(path)

        def run() -> list[Entry]:
            if not directory.exists():
                return []
            if not directory.is_dir():
                raise NotADirectoryError(str(directory))
            values: list[Entry] = []
            for child in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
                # Symlinks are visible but never followed as directories.
                values.append(self._entry(child))
            return values[offset : offset + limit]

        return await asyncio.to_thread(run)

    async def exists(self, path: str) -> bool:
        candidate = self._safe(path, follow_leaf=False)
        return await asyncio.to_thread(lambda: candidate.exists() or candidate.is_symlink())

    async def realpath(self, path: str) -> str:
        """Resolve a local path relative to the selected directory when needed."""
        return str(self._safe(path))

    async def stat_path(self, path: str) -> dict[str, Any]:
        candidate = self._safe(path, follow_leaf=False)

        def run() -> dict[str, Any]:
            if not candidate.exists() and not candidate.is_symlink():
                return {"path": str(candidate), "exists": False, "kind": None, "size": None, "mtime": None, "etag": None}
            entry = self._entry(candidate)
            info = candidate.lstat()
            mtime = int(info.st_mtime)
            size = int(info.st_size)
            etag = f"dir-{mtime}-{size}" if entry.kind == "dir" else f"{size}-{mtime}"
            return {"path": str(candidate), "exists": True, "kind": entry.kind, "size": size, "mtime": mtime, "etag": etag}

        return await asyncio.to_thread(run)

    async def stat_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        return [await self.stat_path(path) for path in dict.fromkeys(paths) if path]

    async def read(self, path: str) -> tuple[str, str, bool]:
        candidate = self._safe(path)

        def run() -> tuple[str, str, bool]:
            if not candidate.exists():
                raise FileNotFoundError(str(candidate))
            if candidate.is_dir():
                raise IsADirectoryError(str(candidate))
            info = candidate.stat()
            with candidate.open("rb") as handle:
                data = handle.read(MAX_EDIT_BYTES + 1)
            truncated = len(data) > MAX_EDIT_BYTES
            return (
                base64.b64encode(data[:MAX_EDIT_BYTES]).decode("ascii"),
                f"{info.st_size}-{int(info.st_mtime)}",
                truncated,
            )

        return await asyncio.to_thread(run)

    async def ensure_dir(self, path: str) -> None:
        candidate = self._safe(path, follow_leaf=False)
        await asyncio.to_thread(candidate.mkdir, parents=True, exist_ok=True)

    async def write(self, path: str, content_b64: str, etag: str | None = None) -> str:
        candidate = self._safe(path, follow_leaf=False)
        data = base64.b64decode(content_b64)
        if len(data) > MAX_UPLOAD_BYTES:
            raise EditorContentTooLargeError(str(candidate))

        def run() -> str:
            if candidate.exists():
                info = candidate.stat()
                if candidate.is_dir():
                    raise IsADirectoryError(str(candidate))
                if info.st_size > MAX_EDIT_BYTES:
                    raise PartialFileWriteBlockedError(str(candidate))
                current = f"{info.st_size}-{int(info.st_mtime)}"
                if etag is None:
                    raise FileVersionRequiredError(str(candidate))
                if etag != current:
                    raise RuntimeError("etag_mismatch")
            candidate.parent.mkdir(parents=True, exist_ok=True)
            candidate.write_bytes(data)
            info = candidate.stat()
            return f"{info.st_size}-{int(info.st_mtime)}"

        return await asyncio.to_thread(run)

    async def mkdir(self, path: str) -> None:
        candidate = self._safe(path, follow_leaf=False)
        await asyncio.to_thread(candidate.mkdir, parents=False, exist_ok=True)

    async def delete(self, path: str, *, recursive: bool = False) -> None:
        candidate = self._safe(path, follow_leaf=False)
        if candidate == self.root:
            raise PermissionError("The local workspace root cannot be deleted")

        def run() -> None:
            if candidate.is_symlink() or candidate.is_file():
                candidate.unlink()
            elif candidate.is_dir():
                if recursive:
                    shutil.rmtree(candidate)
                else:
                    candidate.rmdir()
            else:
                raise FileNotFoundError(str(candidate))

        await asyncio.to_thread(run)

    async def rename(self, old_path: str, new_path: str) -> None:
        source = self._safe(old_path, follow_leaf=False)
        destination = self._safe(new_path, follow_leaf=False)
        if destination.exists():
            raise FileExistsError(str(destination))
        await asyncio.to_thread(source.rename, destination)

    async def copy(self, source_path: str, dest_path: str) -> None:
        source = self._safe(source_path, follow_leaf=False)
        destination = self._safe(dest_path, follow_leaf=False)
        if destination.exists():
            raise FileExistsError(str(destination))
        if source.is_dir() and not source.is_symlink():
            await asyncio.to_thread(shutil.copytree, source, destination, symlinks=True)
        else:
            await asyncio.to_thread(shutil.copy2, source, destination, follow_symlinks=False)

    async def search(self, path: str, query: str, include: str = "", limit: int = 100) -> list[Entry]:
        root = self._safe(path)
        needle = query.casefold()
        pattern = include.strip() or "*"

        def run() -> list[Entry]:
            found: list[Entry] = []
            for directory, names, files in os.walk(root, followlinks=False):
                names[:] = [name for name in names if name not in {".git", "node_modules", ".venv", "dist", "build"}]
                for name in [*names, *files]:
                    if needle in name.casefold() and fnmatch.fnmatch(name, pattern):
                        found.append(self._entry(Path(directory) / name))
                        if len(found) >= limit:
                            return found
            return found

        return await asyncio.to_thread(run)

    async def search_unified(
        self,
        path: str,
        query: str,
        *,
        include: str = "",
        name_limit: int = 40,
        content_limit: int = 100,
        case_sensitive: bool = False,
        names: bool = True,
        content: bool = True,
    ) -> tuple[list[tuple[str, str]], list[ContentSearchMatch], bool, bool, Literal["rg", "grep", "none"]]:
        root = self._safe(path)
        pattern = include.strip() or "*"
        needle = query if case_sensitive else query.casefold()

        def run() -> tuple[list[tuple[str, str]], list[ContentSearchMatch], bool, bool, Literal["rg", "grep", "none"]]:
            name_hits: list[tuple[str, str]] = []
            matches: list[ContentSearchMatch] = []
            names_truncated = False
            content_truncated = False
            for directory, dir_names, file_names in os.walk(root, followlinks=False):
                dir_names[:] = [name for name in dir_names if name not in {".git", "node_modules", ".venv", "dist", "build"}]
                if names:
                    for name in [*dir_names, *file_names]:
                        comparable = name if case_sensitive else name.casefold()
                        if needle in comparable and fnmatch.fnmatch(name, pattern):
                            if len(name_hits) < name_limit:
                                name_hits.append((name, str(Path(directory) / name)))
                            else:
                                names_truncated = True
                if content and len(matches) < content_limit:
                    for name in file_names:
                        if not fnmatch.fnmatch(name, pattern):
                            continue
                        candidate = Path(directory) / name
                        try:
                            if candidate.stat().st_size > MAX_EDIT_BYTES:
                                continue
                            text = candidate.read_text(encoding="utf-8")
                        except (OSError, UnicodeError):
                            continue
                        for line_number, line in enumerate(text.splitlines(), 1):
                            comparable = line if case_sensitive else line.casefold()
                            if needle in comparable:
                                if len(matches) >= content_limit:
                                    content_truncated = True
                                    break
                                matches.append(ContentSearchMatch(path=str(candidate), line=line_number, text=line))
            return name_hits, matches, names_truncated, content_truncated, "none"

        return await asyncio.to_thread(run)


class WorkspaceFileService:
    """Stable dependency shared by APIs/agent tools, switchable per workspace."""

    def __init__(self, remote: Any) -> None:
        self.remote = remote
        self.local: LocalFileService | None = None
        self._session_local: dict[str, LocalFileService] = {}
        self._active_session: ContextVar[str | None] = ContextVar(
            "coloride_file_session",
            default=None,
        )

    @property
    def mode(self) -> Literal["ssh", "local"]:
        session_id = self._active_session.get()
        if session_id is not None:
            return "local" if session_id in self._session_local else "ssh"
        return "local" if self.local is not None else "ssh"

    @property
    def active_local(self) -> LocalFileService | None:
        session_id = self._active_session.get()
        if session_id is not None:
            return self._session_local.get(session_id)
        return self.local

    def use_local(self, root: str) -> str:
        self.local = LocalFileService(root)
        return str(self.local.root)

    def use_remote(self) -> None:
        self.local = None

    def authorize_local_session(self, session_id: str, root: str) -> str:
        service = LocalFileService(root)
        self._session_local[session_id] = service
        return str(service.root)

    def revoke_session(self, session_id: str) -> None:
        self._session_local.pop(session_id, None)

    @contextmanager
    def session_scope(self, session_id: str):
        token = self._active_session.set(session_id)
        try:
            yield
        finally:
            self._active_session.reset(token)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.active_local or self.remote, name)
