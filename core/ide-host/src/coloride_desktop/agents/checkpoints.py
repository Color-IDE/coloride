from __future__ import annotations

import base64
import contextlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from ..files.service import RemoteFileService
from .domain import AgentSession
from .provider import ModelToolCall

MAX_CHECKPOINT_FILES = 500
MAX_CHECKPOINT_BYTES = 20 * 1024 * 1024

@dataclass(frozen=True, slots=True)
class PathSnapshot:
    path: str
    kind: str
    content: str | None = None

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {"path": self.path, "kind": self.kind}
        if self.content is not None:
            value["content"] = self.content
        return value


@dataclass(frozen=True, slots=True)
class AgentCheckpoint:
    checkpoint_id: str
    session_id: str
    tool: str
    call_id: str
    cwd: str
    created_at: str
    snapshots: tuple[PathSnapshot, ...]

    def to_dict(self, *, include_content: bool = False) -> dict[str, Any]:
        return {
            "id": self.checkpoint_id,
            "sessionId": self.session_id,
            "tool": self.tool,
            "callId": self.call_id,
            "cwd": self.cwd,
            "createdAt": self.created_at,
            "paths": [
                snapshot.to_dict()
                if include_content
                else {"path": snapshot.path, "kind": snapshot.kind}
                for snapshot in self.snapshots
            ],
        }


class AgentCheckpointManager:
    """Store private local snapshots before remote workspace mutations."""

    def __init__(self, files: RemoteFileService, root: Path | None = None) -> None:
        self.files = files
        self.root = root or Path.home() / ".coloride" / "desktop" / "agent-checkpoints"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)

    async def capture(
        self,
        call: ModelToolCall,
        session: AgentSession,
        resolved_paths: list[str],
    ) -> AgentCheckpoint | None:
        if not resolved_paths:
            return None
        snapshots: list[PathSnapshot] = []
        total_bytes = 0
        for path in dict.fromkeys(resolved_paths):
            captured, size = await self._snapshot_path(path)
            snapshots.extend(captured)
            total_bytes += size
            if len(snapshots) > MAX_CHECKPOINT_FILES or total_bytes > MAX_CHECKPOINT_BYTES:
                raise ValueError("Checkpoint exceeds Coloride's safe snapshot limit")

        checkpoint = AgentCheckpoint(
            checkpoint_id=f"checkpoint_{secrets.token_hex(10)}",
            session_id=session.session_id,
            tool=call.name,
            call_id=call.call_id,
            cwd=session.cwd,
            created_at=datetime.now(UTC).isoformat(),
            snapshots=tuple(snapshots),
        )
        self._write(checkpoint)
        return checkpoint

    def list(self, session_id: str) -> list[AgentCheckpoint]:
        checkpoints: list[AgentCheckpoint] = []
        for path in self.root.glob("checkpoint_*.json"):
            checkpoint = self._read(path)
            if checkpoint is not None and checkpoint.session_id == session_id:
                checkpoints.append(checkpoint)
        return sorted(checkpoints, key=lambda value: value.created_at, reverse=True)

    def get(self, checkpoint_id: str, session_id: str) -> AgentCheckpoint:
        checkpoint = self._read(self._path(checkpoint_id))
        if checkpoint is None or checkpoint.session_id != session_id:
            raise KeyError(checkpoint_id)
        return checkpoint

    async def restore(self, checkpoint_id: str, session_id: str) -> AgentCheckpoint:
        checkpoint = self.get(checkpoint_id, session_id)

        missing = [snapshot for snapshot in checkpoint.snapshots if snapshot.kind == "missing"]
        existing = [snapshot for snapshot in checkpoint.snapshots if snapshot.kind != "missing"]
        for snapshot in sorted(missing, key=lambda value: value.path.count("/"), reverse=True):
            await self._delete_if_present(snapshot.path)

        directories = [snapshot for snapshot in existing if snapshot.kind == "dir"]
        for snapshot in sorted(directories, key=lambda value: value.path.count("/")):
            await self.files.mkdir(snapshot.path)

        for snapshot in existing:
            if snapshot.kind != "file" or snapshot.content is None:
                continue
            etag: str | None = None
            with contextlib.suppress(FileNotFoundError):
                _current, etag, _truncated = await self.files.read(snapshot.path)
            await self.files.write(snapshot.path, snapshot.content, etag)
        return checkpoint

    async def _snapshot_path(self, path: str) -> tuple[list[PathSnapshot], int]:
        try:
            encoded, _etag, truncated = await self.files.read(path)
            if truncated:
                raise ValueError(f"Cannot checkpoint partially loaded file: {path}")
            return [PathSnapshot(path=path, kind="file", content=encoded)], len(
                base64.b64decode(encoded)
            )
        except FileNotFoundError:
            return [PathSnapshot(path=path, kind="missing")], 0
        except IsADirectoryError:
            snapshots = [PathSnapshot(path=path, kind="dir")]
            total = 0
            for entry in await self.files.list(path, limit=MAX_CHECKPOINT_FILES):
                if entry.kind == "link":
                    # Never follow a remote symlink while building a local checkpoint.
                    snapshots.append(PathSnapshot(path=entry.path, kind="link"))
                    continue
                nested, size = await self._snapshot_path(entry.path)
                snapshots.extend(nested)
                total += size
                if len(snapshots) > MAX_CHECKPOINT_FILES or total > MAX_CHECKPOINT_BYTES:
                    break
            return snapshots, total

    async def _delete_if_present(self, path: str) -> None:
        try:
            await self.files.delete(path)
        except FileNotFoundError:
            pass
        except RuntimeError as exc:
            if "directory not empty" not in str(exc):
                raise
            entries = await self.files.list(path, limit=MAX_CHECKPOINT_FILES)
            for entry in sorted(entries, key=lambda value: value.path.count("/"), reverse=True):
                await self._delete_if_present(entry.path)
            await self.files.delete(path)

    def _write(self, checkpoint: AgentCheckpoint) -> None:
        path = self._path(checkpoint.checkpoint_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(checkpoint.to_dict(include_content=True), ensure_ascii=True),
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        os.chmod(path, 0o600)

    def _read(self, path: Path) -> AgentCheckpoint | None:
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            snapshots = tuple(
                PathSnapshot(
                    path=str(item["path"]),
                    kind=str(item["kind"]),
                    content=str(item["content"]) if "content" in item else None,
                )
                for item in value.get("paths", [])
                if isinstance(item, dict)
            )
            return AgentCheckpoint(
                checkpoint_id=str(value["id"]),
                session_id=str(value["sessionId"]),
                tool=str(value["tool"]),
                call_id=str(value["callId"]),
                cwd=str(value["cwd"]),
                created_at=str(value["createdAt"]),
                snapshots=snapshots,
            )
        except (OSError, ValueError, TypeError, KeyError):
            return None

    def _path(self, checkpoint_id: str) -> Path:
        if not checkpoint_id.startswith("checkpoint_") or not checkpoint_id.replace(
            "_", ""
        ).isalnum():
            raise ValueError("Invalid checkpoint identifier")
        return self.root / f"{PurePosixPath(checkpoint_id).name}.json"
