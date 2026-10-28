"""ACP file callbacks. Writes check the editor revision before replacing content."""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from pathlib import Path


StatFile = Callable[[str], Awaitable[dict]]
ReadFile = Callable[[str], Awaitable[tuple[str, str, bool]]]
WriteFile = Callable[[str, str, str | None], Awaitable[str]]


class RevisionMismatch(RuntimeError):
    pass


class AcpFileBridge:
    def __init__(
        self,
        workspace: Path,
        *,
        stat_file: StatFile,
        read_file: ReadFile,
        write_file: WriteFile,
        known_etag: Callable[[str], str | None],
    ) -> None:
        self.workspace = workspace.resolve()
        self.stat_file = stat_file
        self.read_file = read_file
        self.write_file = write_file
        self.known_etag = known_etag

    def _resolve(self, path: str) -> Path:
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.workspace / candidate
        resolved = candidate.resolve()
        if resolved != self.workspace and self.workspace not in resolved.parents:
            raise PermissionError("External agent file access stays inside the local project.")
        return resolved

    async def read_text(self, path: str, *, line: int | None, limit: int | None) -> str:
        resolved = self._resolve(path)
        encoded, _etag, _truncated = await self.read_file(str(resolved))
        text = base64.b64decode(encoded).decode("utf-8")
        rows = text.splitlines()
        start = max((line or 1) - 1, 0)
        end = start + limit if limit else None
        return "\n".join(rows[start:end])

    async def write_text(self, path: str, content: str) -> None:
        resolved = self._resolve(path)
        current = await self.stat_file(str(resolved))
        etag = current.get("etag") if current.get("exists") else None
        expected = self.known_etag(str(resolved))
        if expected and etag and expected != etag:
            raise RevisionMismatch(
                f"{resolved.name} changed since the editor last read it. Reload the file before writing."
            )
        payload = base64.b64encode(content.encode("utf-8")).decode("ascii")
        await self.write_file(str(resolved), payload, etag if isinstance(etag, str) else None)
