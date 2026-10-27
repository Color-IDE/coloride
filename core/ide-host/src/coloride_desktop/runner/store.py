from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _canonical(value: Any) -> str:
    """Stable JSON used for loop detection, regardless of argument ordering."""
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), default=str)


@dataclass(frozen=True, slots=True)
class RunnerJob:
    job_id: str
    session_id: str
    workspace: str
    model: str
    state: str
    payload: dict[str, Any]
    created_at: str
    updated_at: str
    stop_reason: str | None = None


class RunnerStore:
    """SQLite state owned by one runner process on a VPS.

    The schema purposefully contains only a scoped job token in its submitted
    payload.  It must never receive the desktop refresh token or provider keys.
    """

    def __init__(self, root: Path) -> None:
        self.root = root.expanduser()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.path = self.root / "runner.sqlite3"
        self._connection = sqlite3.connect(self.path)
        self._connection.row_factory = sqlite3.Row
        os.chmod(self.path, 0o600)
        self._init_schema()

    def close(self) -> None:
        self._connection.close()

    def _init_schema(self) -> None:
        self._connection.executescript(
            """
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL UNIQUE,
                workspace TEXT NOT NULL,
                model TEXT NOT NULL,
                state TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                stop_reason TEXT
            );
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS operations (
                job_id TEXT PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
                signature TEXT,
                repeats INTEGER NOT NULL DEFAULT 0
            );
            """
        )
        self._connection.commit()

    def create_job(
        self,
        *,
        job_id: str,
        session_id: str,
        workspace: str,
        model: str,
        payload: dict[str, Any],
    ) -> RunnerJob:
        if not job_id or not session_id or not workspace or not model:
            raise ValueError("job_id, session_id, workspace and model are required")
        now = _now()
        self._connection.execute(
            """INSERT INTO jobs(job_id, session_id, workspace, model, state, payload, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'running_remote', ?, ?, ?)""",
            (job_id, session_id, workspace, model, _canonical(payload), now, now),
        )
        self.append_event(job_id, "state", {"state": "running_remote"})
        self._connection.commit()
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> RunnerJob:
        row = self._connection.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return self._job(row)

    def get_job_for_session(self, session_id: str) -> RunnerJob | None:
        row = self._connection.execute("SELECT * FROM jobs WHERE session_id = ?", (session_id,)).fetchone()
        return self._job(row) if row is not None else None

    def append_event(self, job_id: str, event_type: str, data: dict[str, Any]) -> int:
        cursor = self._connection.execute(
            "INSERT INTO events(job_id, type, data, created_at) VALUES (?, ?, ?, ?)",
            (job_id, event_type, _canonical(data), _now()),
        )
        self._connection.execute("UPDATE jobs SET updated_at = ? WHERE job_id = ?", (_now(), job_id))
        self._connection.commit()
        return int(cursor.lastrowid)

    def events(self, job_id: str, after_sequence: int = 0, limit: int = 1_000) -> list[dict[str, Any]]:
        rows = self._connection.execute(
            """SELECT sequence, job_id, type, data, created_at FROM events
               WHERE job_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?""",
            (job_id, max(0, after_sequence), max(1, min(limit, 5_000))),
        ).fetchall()
        return [
            {
                "sequence": int(row["sequence"]),
                "jobId": str(row["job_id"]),
                "type": str(row["type"]),
                "data": json.loads(str(row["data"])),
                "createdAt": str(row["created_at"]),
            }
            for row in rows
        ]

    def transition(self, job_id: str, state: str, *, reason: str | None = None) -> RunnerJob:
        allowed = {"running_remote", "detached", "stalled", "completed", "stopped", "failed"}
        if state not in allowed:
            raise ValueError(f"unsupported runner state: {state}")
        now = _now()
        self._connection.execute(
            "UPDATE jobs SET state = ?, stop_reason = ?, updated_at = ? WHERE job_id = ?",
            (state, reason, now, job_id),
        )
        self.append_event(job_id, "state", {"state": state, **({"reason": reason} if reason else {})})
        return self.get_job(job_id)

    def record_operation(
        self,
        job_id: str,
        *,
        tool: str,
        arguments: dict[str, Any],
        result: dict[str, Any],
        state_changed: bool,
    ) -> bool:
        """Return True when the no-progress loop guard stalled this job.

        A new signature or an actual state change resets the counter.  Three
        equivalent calls without progress transition the job to ``stalled``.
        """
        signature = hashlib.sha256(
            _canonical({"tool": tool, "arguments": arguments, "result": result}).encode()
        ).hexdigest()
        row = self._connection.execute(
            "SELECT signature, repeats FROM operations WHERE job_id = ?", (job_id,)
        ).fetchone()
        repeats = 0
        if not state_changed and row is not None and row["signature"] == signature:
            repeats = int(row["repeats"]) + 1
        self._connection.execute(
            """INSERT INTO operations(job_id, signature, repeats) VALUES (?, ?, ?)
               ON CONFLICT(job_id) DO UPDATE SET signature=excluded.signature, repeats=excluded.repeats""",
            (job_id, signature, repeats),
        )
        self.append_event(
            job_id,
            "operation",
            {"tool": tool, "arguments": arguments, "result": result, "stateChanged": state_changed, "repeat": repeats},
        )
        if repeats >= 2:
            self.transition(
                job_id,
                "stalled",
                reason="Stopped after three identical tool operations without a workspace change.",
            )
            return True
        return False

    def _job(self, row: sqlite3.Row) -> RunnerJob:
        return RunnerJob(
            job_id=str(row["job_id"]),
            session_id=str(row["session_id"]),
            workspace=str(row["workspace"]),
            model=str(row["model"]),
            state=str(row["state"]),
            payload=json.loads(str(row["payload"])),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            stop_reason=str(row["stop_reason"]) if row["stop_reason"] else None,
        )
