from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class UsageLedger:
    """Append-only local usage rows. Cloud still owns credit charging."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path.home() / ".coloride" / "desktop" / "agent-usage.jsonl"
        self._lock = threading.Lock()

    def record(
        self,
        *,
        task_id: str,
        conversation_id: str,
        model: str,
        input_tokens: int = 0,
        cached_input_tokens: int = 0,
        output_tokens: int = 0,
        request_id: str | None = None,
        provider_cost_usd: float | None = None,
        coloride_credits: int | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "request_id": request_id or f"req_{secrets.token_hex(8)}",
            "task_id": task_id,
            "conversation_id": conversation_id,
            "model": model,
            "input_tokens": max(0, int(input_tokens or 0)),
            "cached_input_tokens": max(0, int(cached_input_tokens or 0)),
            "output_tokens": max(0, int(output_tokens or 0)),
            "provider_cost_usd": provider_cost_usd,
            "coloride_credits": coloride_credits,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        line = json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n"
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.path.parent, 0o700)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line)
            os.chmod(self.path, 0o600)
        return row

    def list_rows(self, *, limit: int = 200) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        rows: list[dict[str, Any]] = []
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if isinstance(value, dict):
                        rows.append(value)
        except OSError:
            return []
        cap = max(1, min(int(limit), 2_000))
        return rows[-cap:]
