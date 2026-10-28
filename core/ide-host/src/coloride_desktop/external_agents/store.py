"""Atomic persistence for installations, sessions and ACP updates."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .models import InstallationRecord, SessionRecord, StoredEvent, utc_now


class ExternalAgentStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.packages = root / "packages"
        self.sessions_dir = root / "sessions"
        self.installations_path = root / "installations.json"
        self.registry_cache = root / "registry-cache.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self.packages.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def read_installations(self) -> list[InstallationRecord]:
        payload = self._read_json(self.installations_path, {"installations": []})
        items = payload.get("installations") if isinstance(payload, dict) else []
        return [InstallationRecord.model_validate(item) for item in items or []]

    def write_installations(self, records: list[InstallationRecord]) -> None:
        self._write_json(
            self.installations_path,
            {"installations": [item.model_dump(by_alias=True) for item in records]},
        )

    def upsert_installation(self, record: InstallationRecord) -> InstallationRecord:
        current = [item for item in self.read_installations() if item.id != record.id]
        current.append(record)
        self.write_installations(current)
        return record

    def remove_installation(self, installation_id: str) -> InstallationRecord | None:
        current = self.read_installations()
        found = next((item for item in current if item.id == installation_id), None)
        self.write_installations([item for item in current if item.id != installation_id])
        return found

    def read_registry_cache(self) -> dict[str, Any] | None:
        payload = self._read_json(self.registry_cache, None)
        return payload if isinstance(payload, dict) else None

    def write_registry_cache(self, payload: dict[str, Any]) -> None:
        self._write_json(self.registry_cache, payload)

    def session_dir(self, session_id: str) -> Path:
        path = self.sessions_dir / session_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def read_session(self, session_id: str) -> SessionRecord | None:
        payload = self._read_json(self.session_dir(session_id) / "session.json", None)
        if not isinstance(payload, dict):
            return None
        return SessionRecord.model_validate(payload)

    def write_session(self, record: SessionRecord) -> SessionRecord:
        record.updated_at = utc_now()
        self._write_json(self.session_dir(record.id) / "session.json", record.model_dump(by_alias=True))
        return record

    def list_sessions(self) -> list[SessionRecord]:
        records: list[SessionRecord] = []
        if not self.sessions_dir.exists():
            return records
        for child in sorted(self.sessions_dir.iterdir()):
            if not child.is_dir():
                continue
            record = self.read_session(child.name)
            if record is not None:
                records.append(record)
        return records

    def append_event(self, session_id: str, update: dict[str, Any]) -> StoredEvent:
        record = self.read_session(session_id)
        sequence = (record.last_sequence if record else 0) + 1
        event = StoredEvent(sessionId=session_id, sequence=sequence, update=update)
        path = self.session_dir(session_id) / "events.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json(by_alias=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        if record is not None:
            record.last_sequence = sequence
            self.write_session(record)
        return event

    def events_after(self, session_id: str, after: int) -> list[StoredEvent]:
        path = self.sessions_dir / session_id / "events.jsonl"
        if not path.is_file():
            return []
        events: list[StoredEvent] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            event = StoredEvent.model_validate_json(line)
            if event.sequence > after:
                events.append(event)
        return events

    def delete_session(self, session_id: str) -> None:
        directory = self.sessions_dir / session_id
        if not directory.exists():
            return
        for child in directory.iterdir():
            if child.is_file():
                child.unlink()
        directory.rmdir()

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.is_file():
            return fallback
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return fallback

    def _write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
