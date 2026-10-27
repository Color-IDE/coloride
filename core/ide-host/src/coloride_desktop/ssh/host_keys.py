from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

import asyncssh


@dataclass(frozen=True, slots=True)
class HostKeyInspection:
    host: str
    port: int
    algorithm: str
    fingerprint: str
    public_key: str
    status: str
    trusted_fingerprint: str | None = None


class HostKeyStore:
    """Persistent per-host SSH identity pins for direct VPS connections."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or Path.home() / ".coloride" / "desktop" / "host_keys.json"
        self._records: dict[str, str] | None = None

    @staticmethod
    def identity(host: str, port: int) -> str:
        clean = host.strip().lower()
        if not clean or any(char in clean for char in "\r\n\0"):
            raise ValueError("Invalid SSH host")
        if not 1 <= port <= 65535:
            raise ValueError("Invalid SSH port")
        return f"{clean}:{port}"

    def _load(self) -> dict[str, str]:
        if self._records is not None:
            return self._records
        if not self._path.exists():
            self._records = {}
            return self._records
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            self._records = {
                str(key): str(value)
                for key, value in raw.items()
                if isinstance(key, str) and isinstance(value, str)
            } if isinstance(raw, dict) else {}
        except (OSError, ValueError):
            self._records = {}
        return self._records

    def get(self, host: str, port: int) -> str | None:
        return self._load().get(self.identity(host, port))

    def forget(self, host: str, port: int) -> bool:
        records = self._load()
        removed = records.pop(self.identity(host, port), None) is not None
        if not removed:
            return False
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(records, indent=2, sort_keys=True), encoding="utf-8")
        tmp.chmod(0o600)
        tmp.replace(self._path)
        self._path.chmod(0o600)
        return True

    def inspect(self, host: str, port: int, key: asyncssh.SSHKey) -> HostKeyInspection:
        public_key = key.export_public_key().decode().strip()
        fingerprint = key.get_fingerprint("sha256")
        trusted_text = self.get(host, port)
        trusted_fingerprint = None
        if trusted_text:
            trusted_key = asyncssh.import_public_key(trusted_text)
            trusted_fingerprint = trusted_key.get_fingerprint("sha256")
        if not trusted_text:
            status = "unknown"
        elif trusted_fingerprint == fingerprint:
            status = "trusted"
        else:
            status = "changed"
        return HostKeyInspection(
            host=host,
            port=port,
            algorithm=key.get_algorithm(),
            fingerprint=fingerprint,
            public_key=public_key,
            status=status,
            trusted_fingerprint=trusted_fingerprint,
        )

    def trust(self, host: str, port: int, key: asyncssh.SSHKey) -> HostKeyInspection:
        inspection = self.inspect(host, port, key)
        records = self._load()
        records[self.identity(host, port)] = inspection.public_key
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(records, indent=2, sort_keys=True), encoding="utf-8")
        tmp.chmod(0o600)
        tmp.replace(self._path)
        self._path.chmod(0o600)
        return replace(inspection, status="trusted", trusted_fingerprint=inspection.fingerprint)
