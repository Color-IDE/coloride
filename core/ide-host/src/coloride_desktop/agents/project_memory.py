from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import shutil
import sqlite3
import threading
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from pathlib import Path
from typing import Any

from .domain import AgentSession

SCHEMA_VERSION = 1
_SAFE_SPACE = re.compile(r"\s+")
_SECRET_VALUE = re.compile(
    r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?|bearer\s+|"
    r"api[_-]?key\s*[:=]\s*|[A-Z0-9_]*token\s*[:=]\s*|"
    r"password\s*[:=]\s*|secret\s*[:=]\s*)[^\s,;]+"
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class MemoryKind(StrEnum):
    SEMANTIC = "semantic"
    EPISODIC = "episodic"
    PROCEDURAL = "procedural"
    DECISION = "decision"


class MemoryStatus(StrEnum):
    ACTIVE = "active"
    LOW_PRIORITY = "low_priority"
    STALE = "stale"
    SUPERSEDED = "superseded"
    ARCHIVED = "archived"


@dataclass(frozen=True, slots=True)
class ProjectIdentity:
    workspace_kind: str
    cwd: str
    connection_id: str = ""

    @classmethod
    def from_session(cls, session: AgentSession) -> ProjectIdentity:
        kind = "local" if session.workspace_kind == "local" else "ssh"
        if kind == "local":
            cwd = str(Path(session.cwd).expanduser().resolve(strict=False))
            connection_id = ""
        else:
            cwd = posixpath.normpath(session.cwd or "/")
            if not cwd.startswith("/"):
                cwd = f"/{cwd}"
            connection_id = str(session.connection_id or "unknown")
        return cls(workspace_kind=kind, cwd=cwd, connection_id=connection_id)

    @property
    def canonical(self) -> str:
        return f"{self.workspace_kind}|{self.connection_id}|{self.cwd}"

    @property
    def key(self) -> str:
        return hashlib.sha256(self.canonical.encode("utf-8")).hexdigest()[:24]


@dataclass(slots=True)
class MemorySource:
    source_type: str
    path: str = ""
    etag: str = ""
    symbol: str = ""
    command: str = ""
    error_signature: str = ""
    session_id: str = ""
    task_id: str = ""
    output_id: str = ""
    observed_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: object) -> MemorySource:
        raw = value if isinstance(value, dict) else {}
        return cls(
            source_type=str(raw.get("source_type") or raw.get("sourceType") or "unknown"),
            path=str(raw.get("path") or ""),
            etag=str(raw.get("etag") or ""),
            symbol=str(raw.get("symbol") or ""),
            command=str(raw.get("command") or ""),
            error_signature=str(raw.get("error_signature") or raw.get("errorSignature") or ""),
            session_id=str(raw.get("session_id") or raw.get("sessionId") or ""),
            task_id=str(raw.get("task_id") or raw.get("taskId") or ""),
            output_id=str(raw.get("output_id") or raw.get("outputId") or ""),
            observed_at=str(raw.get("observed_at") or raw.get("observedAt") or _now()),
        )


@dataclass(slots=True)
class MemoryEntry:
    memory_id: str
    kind: MemoryKind
    content: str
    canonical_key: str
    source: MemorySource
    importance: float = 0.5
    confidence: float = 0.5
    status: MemoryStatus = MemoryStatus.ACTIVE
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    last_accessed_at: str = field(default_factory=_now)
    access_count: int = 0
    supersedes_id: str = ""


@dataclass(slots=True)
class FileAwareness:
    path: str
    etag: str
    content_hash: str = ""
    summary: str = ""
    ranges: list[dict[str, Any]] = field(default_factory=list)
    symbols: list[dict[str, Any]] = field(default_factory=list)
    output_id: str = ""
    last_read_at: str = field(default_factory=_now)
    last_indexed_at: str = field(default_factory=_now)


@dataclass(slots=True)
class SymbolRecord:
    name: str
    kind: str
    path: str
    start_line: int
    end_line: int
    etag: str


@dataclass(slots=True)
class ToolObservation:
    observation_id: str
    tool: str
    success: bool
    summary: str
    paths: list[str] = field(default_factory=list)
    etags: dict[str, str] = field(default_factory=dict)
    diff_hash: str = ""
    error_signature: str = ""
    command: str = ""
    output_id: str = ""
    verified: bool = False
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ContextBudget:
    max_input_tokens: int
    output_reserve_tokens: int = 8_000
    recent_conversation_tokens: int = 6_000
    project_memory_tokens: int = 8_000


@dataclass(slots=True)
class ContextManifest:
    request_id: str
    project_key: str
    selected_memory_ids: list[str] = field(default_factory=list)
    stale_rejected_ids: list[str] = field(default_factory=list)
    cache_hits: int = 0
    breakdown: dict[str, int] = field(default_factory=dict)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "requestId": self.request_id,
            "projectKey": self.project_key,
            "selectedMemoryIds": list(self.selected_memory_ids),
            "staleRejectedIds": list(self.stale_rejected_ids),
            "cacheHits": self.cache_hits,
            "breakdown": dict(self.breakdown),
            "createdAt": self.created_at,
        }


class ProjectMemoryStore:
    """Private SQLite memory for exactly one local or SSH project."""

    def __init__(self, root: Path, identity: ProjectIdentity) -> None:
        self.root = Path(root)
        self.identity = identity
        self.project_root = self.root / identity.key
        self.path = self.project_root / "memory-v1.sqlite3"
        self._lock = threading.RLock()
        self._ensure_private_directory(self.root)
        self._ensure_private_directory(self.project_root)
        self._initialize()

    @staticmethod
    def _ensure_private_directory(path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        os.chmod(path, 0o700)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS project_profile (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memory_entries (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    content TEXT NOT NULL,
                    canonical_key TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    source_path TEXT NOT NULL DEFAULT '',
                    source_etag TEXT NOT NULL DEFAULT '',
                    source_symbol TEXT NOT NULL DEFAULT '',
                    source_error TEXT NOT NULL DEFAULT '',
                    source_command TEXT NOT NULL DEFAULT '',
                    importance REAL NOT NULL,
                    confidence REAL NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_accessed_at TEXT NOT NULL,
                    access_count INTEGER NOT NULL DEFAULT 0,
                    supersedes_id TEXT NOT NULL DEFAULT '',
                    UNIQUE(kind, canonical_key)
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                    id UNINDEXED,
                    content,
                    path,
                    symbol,
                    error,
                    command,
                    tokenize='unicode61 remove_diacritics 2'
                );
                CREATE TABLE IF NOT EXISTS file_awareness (
                    path TEXT PRIMARY KEY,
                    etag TEXT NOT NULL,
                    content_hash TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '',
                    ranges_json TEXT NOT NULL DEFAULT '[]',
                    symbols_json TEXT NOT NULL DEFAULT '[]',
                    output_id TEXT NOT NULL DEFAULT '',
                    last_read_at TEXT NOT NULL,
                    last_indexed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS symbol_index (
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    path TEXT NOT NULL,
                    start_line INTEGER NOT NULL,
                    end_line INTEGER NOT NULL,
                    etag TEXT NOT NULL,
                    PRIMARY KEY(path, name, start_line)
                );
                CREATE INDEX IF NOT EXISTS symbol_name_idx ON symbol_index(name);
                CREATE TABLE IF NOT EXISTS migration_state (
                    source_key TEXT PRIMARY KEY,
                    cursor INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS context_runs (
                    request_id TEXT PRIMARY KEY,
                    manifest_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            connection.execute(
                "INSERT OR REPLACE INTO schema_meta(key, value) VALUES('project_identity', ?)",
                (self.identity.canonical,),
            )
        os.chmod(self.path, 0o600)
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{self.path}{suffix}")
            if sidecar.exists():
                os.chmod(sidecar, 0o600)

    def upsert_memory(
        self,
        kind: MemoryKind,
        content: str,
        source: MemorySource,
        *,
        canonical_key: str = "",
        importance: float = 0.5,
        confidence: float = 0.5,
        status: MemoryStatus = MemoryStatus.ACTIVE,
        supersedes_id: str = "",
    ) -> MemoryEntry | None:
        cleaned = _clean_content(content)
        if not cleaned:
            return None
        source.command = _redact_secrets(source.command)
        source.error_signature = _redact_secrets(source.error_signature)
        key = _redact_secrets(canonical_key.strip()) or _canonical_memory_key(cleaned)
        timestamp = _now()
        memory_id = "mem_" + hashlib.sha256(f"{kind.value}|{key}".encode()).hexdigest()[:20]
        importance = max(0.0, min(float(importance), 1.0))
        confidence = max(0.0, min(float(confidence), 1.0))
        source_json = json.dumps(source.to_dict(), ensure_ascii=True, separators=(",", ":"))
        with self._lock, self._connect() as connection:
            if supersedes_id and supersedes_id != memory_id:
                connection.execute(
                    "UPDATE memory_entries SET status=?, updated_at=? WHERE id=?",
                    (MemoryStatus.SUPERSEDED.value, timestamp, supersedes_id),
                )
                connection.execute("DELETE FROM memory_fts WHERE id=?", (supersedes_id,))
            existing = connection.execute(
                "SELECT created_at, access_count FROM memory_entries WHERE kind=? AND canonical_key=?",
                (kind.value, key),
            ).fetchone()
            created_at = str(existing["created_at"]) if existing else timestamp
            access_count = int(existing["access_count"]) if existing else 0
            connection.execute(
                """
                INSERT INTO memory_entries(
                    id, kind, content, canonical_key, source_json, source_path,
                    source_etag, source_symbol, source_error, source_command,
                    importance, confidence, status, created_at, updated_at,
                    last_accessed_at, access_count, supersedes_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(kind, canonical_key) DO UPDATE SET
                    content=excluded.content,
                    source_json=excluded.source_json,
                    source_path=excluded.source_path,
                    source_etag=excluded.source_etag,
                    source_symbol=excluded.source_symbol,
                    source_error=excluded.source_error,
                    source_command=excluded.source_command,
                    importance=MAX(memory_entries.importance, excluded.importance),
                    confidence=excluded.confidence,
                    status=excluded.status,
                    updated_at=excluded.updated_at,
                    supersedes_id=excluded.supersedes_id
                """,
                (
                    memory_id,
                    kind.value,
                    cleaned,
                    key,
                    source_json,
                    source.path,
                    source.etag,
                    source.symbol,
                    source.error_signature,
                    source.command,
                    importance,
                    confidence,
                    status.value,
                    created_at,
                    timestamp,
                    timestamp,
                    access_count,
                    supersedes_id,
                ),
            )
            connection.execute("DELETE FROM memory_fts WHERE id=?", (memory_id,))
            connection.execute(
                "INSERT INTO memory_fts(id, content, path, symbol, error, command) VALUES(?,?,?,?,?,?)",
                (
                    memory_id,
                    cleaned,
                    source.path,
                    source.symbol,
                    source.error_signature,
                    source.command,
                ),
            )
        return self.get_memory(memory_id)

    def get_memory(self, memory_id: str) -> MemoryEntry | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM memory_entries WHERE id=?", (memory_id,)
            ).fetchone()
        return _entry_from_row(row) if row else None

    def query_candidates(
        self,
        query: str,
        *,
        limit: int = 40,
        include_inactive: bool = False,
    ) -> list[tuple[MemoryEntry, float]]:
        terms = _fts_terms(query)
        if not terms:
            return []
        statuses = (
            tuple(status.value for status in MemoryStatus)
            if include_inactive
            else (MemoryStatus.ACTIVE.value, MemoryStatus.LOW_PRIORITY.value)
        )
        placeholders = ",".join("?" for _ in statuses)
        expression = " OR ".join(f'"{term}"' for term in terms[:24])
        sql = f"""
            SELECT e.*, bm25(memory_fts, 1.0, 2.2, 2.4, 2.0, 1.8) AS rank
            FROM memory_fts
            JOIN memory_entries e ON e.id = memory_fts.id
            WHERE memory_fts MATCH ? AND e.status IN ({placeholders})
            ORDER BY rank ASC
            LIMIT ?
        """
        with self._connect() as connection:
            rows = connection.execute(
                sql, (expression, *statuses, max(1, min(int(limit), 200)))
            ).fetchall()
        return [(_entry_from_row(row), float(row["rank"] or 0.0)) for row in rows]

    def exact_candidates(
        self,
        *,
        paths: Iterable[str] = (),
        symbols: Iterable[str] = (),
        errors: Iterable[str] = (),
        commands: Iterable[str] = (),
        limit: int = 40,
    ) -> list[MemoryEntry]:
        clauses: list[str] = []
        parameters: list[str] = []
        for column, values in (
            ("source_path", paths),
            ("source_symbol", symbols),
            ("source_error", errors),
            ("source_command", commands),
        ):
            cleaned = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
            if not cleaned:
                continue
            clauses.append(f"{column} IN ({','.join('?' for _ in cleaned)})")
            parameters.extend(cleaned)
        if not clauses:
            return []
        sql = f"""
            SELECT * FROM memory_entries
            WHERE status IN (?,?) AND ({' OR '.join(clauses)})
            ORDER BY importance DESC, confidence DESC, updated_at DESC
            LIMIT ?
        """
        with self._connect() as connection:
            rows = connection.execute(
                sql,
                (
                    MemoryStatus.ACTIVE.value,
                    MemoryStatus.LOW_PRIORITY.value,
                    *parameters,
                    max(1, min(int(limit), 200)),
                ),
            ).fetchall()
        return [_entry_from_row(row) for row in rows]

    def all_memories(self, *, limit: int = 500) -> list[MemoryEntry]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM memory_entries ORDER BY updated_at DESC LIMIT ?",
                (max(1, min(int(limit), 10_000)),),
            ).fetchall()
        return [_entry_from_row(row) for row in rows]

    def touch_memories(self, memory_ids: Iterable[str]) -> None:
        ids = list(dict.fromkeys(str(value) for value in memory_ids if str(value)))
        if not ids:
            return
        timestamp = _now()
        with self._lock, self._connect() as connection:
            connection.executemany(
                "UPDATE memory_entries SET access_count=access_count+1, last_accessed_at=? WHERE id=?",
                [(timestamp, memory_id) for memory_id in ids],
            )

    def set_status(self, memory_id: str, status: MemoryStatus) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE memory_entries SET status=?, updated_at=? WHERE id=?",
                (status.value, _now(), memory_id),
            )

    def set_profile_value(self, key: str, value: Any) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO project_profile(key, value_json, updated_at) VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
                """,
                (key, json.dumps(value, ensure_ascii=True, separators=(",", ":")), _now()),
            )

    def project_profile(self) -> dict[str, Any]:
        with self._connect() as connection:
            rows = connection.execute("SELECT key, value_json FROM project_profile").fetchall()
        profile: dict[str, Any] = {}
        for row in rows:
            try:
                profile[str(row["key"])] = json.loads(str(row["value_json"]))
            except (TypeError, ValueError):
                continue
        return profile

    def get_file_awareness(self, path: str) -> FileAwareness | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM file_awareness WHERE path=?", (path,)
            ).fetchone()
        if row is None:
            return None
        return FileAwareness(
            path=str(row["path"]),
            etag=str(row["etag"]),
            content_hash=str(row["content_hash"]),
            summary=str(row["summary"]),
            ranges=_json_list(row["ranges_json"]),
            symbols=_json_list(row["symbols_json"]),
            output_id=str(row["output_id"]),
            last_read_at=str(row["last_read_at"]),
            last_indexed_at=str(row["last_indexed_at"]),
        )

    def upsert_file_awareness(self, awareness: FileAwareness) -> None:
        ranges = _bounded_ranges(awareness.ranges)
        symbols = awareness.symbols[-500:]
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO file_awareness(
                    path, etag, content_hash, summary, ranges_json, symbols_json,
                    output_id, last_read_at, last_indexed_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(path) DO UPDATE SET
                    etag=excluded.etag,
                    content_hash=excluded.content_hash,
                    summary=excluded.summary,
                    ranges_json=excluded.ranges_json,
                    symbols_json=excluded.symbols_json,
                    output_id=excluded.output_id,
                    last_read_at=excluded.last_read_at,
                    last_indexed_at=excluded.last_indexed_at
                """,
                (
                    awareness.path,
                    awareness.etag,
                    awareness.content_hash,
                    awareness.summary[:2_000],
                    json.dumps(ranges, ensure_ascii=True, separators=(",", ":")),
                    json.dumps(symbols, ensure_ascii=True, separators=(",", ":")),
                    awareness.output_id,
                    awareness.last_read_at,
                    awareness.last_indexed_at,
                ),
            )
        self.replace_symbols(
            awareness.path,
            awareness.etag,
            [
                SymbolRecord(
                    name=str(item.get("name") or ""),
                    kind=str(item.get("kind") or "symbol"),
                    path=awareness.path,
                    start_line=int(item.get("startLine") or 1),
                    end_line=int(item.get("endLine") or item.get("startLine") or 1),
                    etag=awareness.etag,
                )
                for item in symbols
                if str(item.get("name") or "")
            ],
        )

    def invalidate_file(self, path: str, *, deleted: bool = False) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM symbol_index WHERE path=?", (path,))
            if deleted:
                connection.execute("DELETE FROM file_awareness WHERE path=?", (path,))
            else:
                connection.execute(
                    """
                    UPDATE file_awareness
                    SET etag='', ranges_json='[]', symbols_json='[]', last_indexed_at=?
                    WHERE path=?
                    """,
                    (_now(), path),
                )
            rows = connection.execute(
                "SELECT id FROM memory_entries WHERE source_path=? AND status IN (?,?)",
                (path, MemoryStatus.ACTIVE.value, MemoryStatus.LOW_PRIORITY.value),
            ).fetchall()
            connection.execute(
                "UPDATE memory_entries SET status=?, updated_at=? WHERE source_path=? AND status IN (?,?)",
                (
                    MemoryStatus.STALE.value,
                    _now(),
                    path,
                    MemoryStatus.ACTIVE.value,
                    MemoryStatus.LOW_PRIORITY.value,
                ),
            )
            stale_ids = [str(row["id"]) for row in rows]
            if stale_ids:
                connection.executemany("DELETE FROM memory_fts WHERE id=?", [(item,) for item in stale_ids])

    def replace_symbols(self, path: str, etag: str, symbols: list[SymbolRecord]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM symbol_index WHERE path=?", (path,))
            connection.executemany(
                """
                INSERT OR REPLACE INTO symbol_index(name, kind, path, start_line, end_line, etag)
                VALUES(?,?,?,?,?,?)
                """,
                [
                    (item.name, item.kind, path, item.start_line, item.end_line, etag)
                    for item in symbols
                    if item.name
                ],
            )

    def search_symbols(self, query: str, *, limit: int = 30) -> list[SymbolRecord]:
        needle = f"%{query.strip()}%"
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM symbol_index
                WHERE name LIKE ? COLLATE NOCASE
                ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END, name
                LIMIT ?
                """,
                (needle, query.strip(), max(1, min(int(limit), 100))),
            ).fetchall()
        return [
            SymbolRecord(
                name=str(row["name"]),
                kind=str(row["kind"]),
                path=str(row["path"]),
                start_line=int(row["start_line"]),
                end_line=int(row["end_line"]),
                etag=str(row["etag"]),
            )
            for row in rows
        ]

    def migration_cursor(self, source_key: str) -> tuple[int, bool]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT cursor, completed FROM migration_state WHERE source_key=?",
                (source_key,),
            ).fetchone()
        return (int(row["cursor"]), bool(row["completed"])) if row else (0, False)

    def save_migration_cursor(self, source_key: str, cursor: int, *, completed: bool) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO migration_state(source_key, cursor, completed, updated_at) VALUES(?,?,?,?)
                ON CONFLICT(source_key) DO UPDATE SET cursor=excluded.cursor,
                    completed=excluded.completed, updated_at=excluded.updated_at
                """,
                (source_key, max(0, int(cursor)), int(completed), _now()),
            )

    def record_context_manifest(self, manifest: ContextManifest) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO context_runs(request_id, manifest_json, created_at) VALUES(?,?,?)",
                (
                    manifest.request_id,
                    json.dumps(manifest.to_dict(), ensure_ascii=True, separators=(",", ":")),
                    manifest.created_at,
                ),
            )
            connection.execute(
                """
                DELETE FROM context_runs
                WHERE request_id NOT IN (
                    SELECT request_id FROM context_runs ORDER BY created_at DESC LIMIT 500
                )
                """
            )

    def latest_context_manifests(self, *, limit: int = 20) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT manifest_json FROM context_runs ORDER BY created_at DESC LIMIT ?",
                (max(1, min(int(limit), 100)),),
            ).fetchall()
        values: list[dict[str, Any]] = []
        for row in rows:
            try:
                value = json.loads(str(row["manifest_json"]))
            except (TypeError, ValueError):
                continue
            if isinstance(value, dict):
                values.append(value)
        return values

    def retention_due(self) -> bool:
        profile = self.project_profile()
        value = str(profile.get("lastRetentionAt") or "")
        if not value:
            return True
        try:
            return datetime.fromisoformat(value) <= datetime.now(UTC) - timedelta(hours=24)
        except ValueError:
            return True

    def run_retention(self, *, now: datetime | None = None) -> dict[str, int]:
        current = now or datetime.now(UTC)
        low_before = (current - timedelta(days=90)).isoformat()
        archive_before = (current - timedelta(days=180)).isoformat()
        delete_before = (current - timedelta(days=365)).isoformat()
        with self._lock, self._connect() as connection:
            low = connection.execute(
                """
                UPDATE memory_entries SET status=?, updated_at=?
                WHERE status=? AND kind<>? AND last_accessed_at<?
                """,
                (
                    MemoryStatus.LOW_PRIORITY.value,
                    current.isoformat(),
                    MemoryStatus.ACTIVE.value,
                    MemoryKind.DECISION.value,
                    low_before,
                ),
            ).rowcount
            archived = connection.execute(
                """
                UPDATE memory_entries SET status=?, updated_at=?
                WHERE status IN (?,?,?) AND kind<>? AND last_accessed_at<?
                """,
                (
                    MemoryStatus.ARCHIVED.value,
                    current.isoformat(),
                    MemoryStatus.LOW_PRIORITY.value,
                    MemoryStatus.STALE.value,
                    MemoryStatus.SUPERSEDED.value,
                    MemoryKind.DECISION.value,
                    archive_before,
                ),
            ).rowcount
            stale_ids = [
                str(row["id"])
                for row in connection.execute(
                    "SELECT id FROM memory_entries WHERE status=?",
                    (MemoryStatus.STALE.value,),
                ).fetchall()
            ]
            archived_ids = [
                str(row["id"])
                for row in connection.execute(
                    "SELECT id FROM memory_entries WHERE status=?",
                    (MemoryStatus.ARCHIVED.value,),
                ).fetchall()
            ]
            connection.executemany(
                "DELETE FROM memory_fts WHERE id=?",
                [(item,) for item in dict.fromkeys(stale_ids + archived_ids)],
            )
            deleted_ids = [
                str(row["id"])
                for row in connection.execute(
                    """
                    SELECT id FROM memory_entries
                    WHERE status=? AND kind<>? AND last_accessed_at<?
                    """,
                    (MemoryStatus.ARCHIVED.value, MemoryKind.DECISION.value, delete_before),
                ).fetchall()
            ]
            connection.executemany("DELETE FROM memory_entries WHERE id=?", [(item,) for item in deleted_ids])
        self.set_profile_value("lastRetentionAt", current.isoformat())
        return {"lowPriority": int(low), "archived": int(archived), "deleted": len(deleted_ids)}


class ProjectMemoryRegistry:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path.home() / ".coloride" / "desktop" / "project-memory"
        self._stores: dict[str, ProjectMemoryStore] = {}
        self._migration_started: set[str] = set()
        self._lock = threading.RLock()

    def for_session(self, session: AgentSession) -> ProjectMemoryStore:
        identity = ProjectIdentity.from_session(session)
        with self._lock:
            store = self._stores.get(identity.key)
            if store is None:
                store = ProjectMemoryStore(self.root, identity)
                self._stores[identity.key] = store
            return store

    def begin_migration(self, project_key: str) -> bool:
        with self._lock:
            if project_key in self._migration_started:
                return False
            self._migration_started.add(project_key)
            return True

    def retry_migration_after_failure(self, project_key: str) -> None:
        with self._lock:
            self._migration_started.discard(project_key)

    def purge_connection(self, connection_id: str) -> int:
        """Delete every private project memory belonging to an explicit Forget Server."""
        connection = str(connection_id or "").strip()
        if not connection or not self.root.exists():
            return 0
        prefix = f"ssh|{connection}|"
        removed = 0
        with self._lock:
            candidates = [path for path in self.root.iterdir() if path.is_dir()]
            for project_root in candidates:
                database = project_root / "memory-v1.sqlite3"
                if not database.is_file():
                    continue
                try:
                    with sqlite3.connect(database) as handle:
                        row = handle.execute(
                            "SELECT value FROM schema_meta WHERE key='project_identity'"
                        ).fetchone()
                except sqlite3.Error:
                    continue
                if row is None or not str(row[0]).startswith(prefix):
                    continue
                shutil.rmtree(project_root)
                removed += 1
            purged_keys = [
                key
                for key, store in self._stores.items()
                if store.identity.workspace_kind == "ssh"
                and store.identity.connection_id == connection
            ]
            for key in purged_keys:
                self._stores.pop(key, None)
                self._migration_started.discard(key)
        return removed


def _entry_from_row(row: sqlite3.Row) -> MemoryEntry:
    try:
        source_raw = json.loads(str(row["source_json"]))
    except (TypeError, ValueError):
        source_raw = {}
    return MemoryEntry(
        memory_id=str(row["id"]),
        kind=MemoryKind(str(row["kind"])),
        content=str(row["content"]),
        canonical_key=str(row["canonical_key"]),
        source=MemorySource.from_dict(source_raw),
        importance=float(row["importance"]),
        confidence=float(row["confidence"]),
        status=MemoryStatus(str(row["status"])),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        last_accessed_at=str(row["last_accessed_at"]),
        access_count=int(row["access_count"]),
        supersedes_id=str(row["supersedes_id"]),
    )


def _clean_content(value: str) -> str:
    return _SAFE_SPACE.sub(" ", _redact_secrets(str(value or ""))).strip()[:4_000]


def _redact_secrets(value: str) -> str:
    return _SECRET_VALUE.sub(lambda match: f"{match.group(1)}<redacted>", str(value or ""))


def _canonical_memory_key(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_./:-]+", " ", value.casefold())
    normalized = _SAFE_SPACE.sub(" ", normalized).strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def _fts_terms(value: str) -> list[str]:
    terms = re.findall(r"[\w./:@+-]{2,}", value.casefold(), flags=re.UNICODE)
    return list(dict.fromkeys(term.replace('"', "") for term in terms if term))


def _json_list(value: object) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError):
        return []
    return [dict(item) for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []


def _bounded_ranges(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bounded: list[dict[str, Any]] = []
    size = 0
    for item in reversed(values[-16:]):
        text = str(item.get("text") or "")[:64_000]
        if size + len(text) > 160_000:
            continue
        bounded.append(
            {
                "startLine": max(1, int(item.get("startLine") or 1)),
                "endLine": max(1, int(item.get("endLine") or item.get("startLine") or 1)),
                "text": text,
                "full": bool(item.get("full")),
            }
        )
        size += len(text)
    bounded.reverse()
    return bounded
