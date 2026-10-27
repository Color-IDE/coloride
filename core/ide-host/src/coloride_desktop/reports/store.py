from __future__ import annotations

import json
import os
import platform
import re
import secrets
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [^-\n]*PRIVATE KEY-----.*?-----END [^-\n]*PRIVATE KEY-----",
    re.IGNORECASE | re.DOTALL,
)
_SECRET_VALUE_RE = re.compile(
    r"(?i)\b(password|passwd|token|api[_-]?key|secret|authorization)\b"
    r"(\s*[:=]\s*|\s+)([^\s,;]+)",
)


def redact_report_text(value: str) -> str:
    """Remove common credentials if they were pasted into a report by mistake."""
    redacted = _PRIVATE_KEY_RE.sub("[REDACTED PRIVATE KEY]", value)
    return _SECRET_VALUE_RE.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", redacted)


class BugReportStore:
    def __init__(self, directory: Path | None = None) -> None:
        self._directory = directory or Path.home() / ".coloride" / "desktop" / "bug-reports"

    def save(
        self,
        *,
        categories: list[str],
        description: str,
        include_diagnostics: bool,
        connection_state: str,
    ) -> dict[str, Any]:
        created_at = datetime.now(UTC)
        report_id = f"bug_{created_at.strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(3)}"
        payload: dict[str, Any] = {
            "id": report_id,
            "createdAt": created_at.isoformat(),
            "categories": categories,
            "description": redact_report_text(description.strip()),
            "diagnostics": self._diagnostics(connection_state) if include_diagnostics else None,
            "delivery": "local",
        }

        self._directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self._directory, 0o700)
        destination = self._directory / f"{report_id}.json"
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(destination)
        os.chmod(destination, 0o600)
        return payload

    @staticmethod
    def _diagnostics(connection_state: str) -> dict[str, str]:
        return {
            "appVersion": "0.1.0",
            "connectionState": connection_state,
            "operatingSystem": platform.system(),
            "operatingSystemRelease": platform.release(),
            "architecture": platform.machine(),
            "pythonVersion": platform.python_version(),
            "runtime": sys.implementation.name,
        }
