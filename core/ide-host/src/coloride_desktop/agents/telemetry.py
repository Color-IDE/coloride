from __future__ import annotations

import json
import os
import threading
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MAX_METRICS_BYTES = 4 * 1024 * 1024
MAX_SUMMARY_RECORDS = 10_000
TRACKED_EVENTS = frozenset(
    {
        "turn_started",
        "turn_completed",
        "turn_failed",
        "tool_call",
        "tool_result",
        "usage",
        "context_compacted",
        "checkpoint_created",
        "checkpoint_restored",
        "error",
        "turn_telemetry",
    }
)


class AgentTelemetryStore:
    """Private local operational metrics with no prompts, outputs or file contents."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path.home() / ".coloride" / "desktop" / "agent-metrics.jsonl"
        self._lock = threading.Lock()

    def record(
        self,
        event_type: str,
        *,
        session_id: str,
        tool: str = "",
        failed: bool = False,
        duration_ms: int | None = None,
        input_tokens: int | None = None,
        cached_input_tokens: int | None = None,
        output_tokens: int | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if event_type not in TRACKED_EVENTS:
            return
        value: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event": event_type,
            "sessionId": session_id,
            "failed": bool(failed),
        }
        if tool:
            value["tool"] = tool[:120]
        if duration_ms is not None:
            value["durationMs"] = max(0, int(duration_ms))
        if input_tokens is not None:
            value["inputTokens"] = max(0, int(input_tokens))
        if cached_input_tokens is not None:
            value["cachedInputTokens"] = max(0, int(cached_input_tokens))
        if output_tokens is not None:
            value["outputTokens"] = max(0, int(output_tokens))
        if extra:
            for key, field in extra.items():
                if key in value or field is None:
                    continue
                if isinstance(field, (str, int, float, bool)):
                    value[key] = field
        line = json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n"
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(self.path.parent, 0o700)
            self._rotate_if_needed(len(line.encode("utf-8")))
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line)
            os.chmod(self.path, 0o600)

    def summary(self) -> dict[str, Any]:
        records = self._read()
        events = Counter(str(value.get("event") or "") for value in records)
        tools = Counter(
            str(value.get("tool") or "")
            for value in records
            if isinstance(value.get("tool"), str) and value.get("tool")
        )
        durations = [
            int(value["durationMs"])
            for value in records
            if value.get("event") == "turn_completed" and isinstance(value.get("durationMs"), int)
        ]
        return {
            "private": True,
            "records": len(records),
            "turns": events["turn_started"],
            "completedTurns": events["turn_completed"],
            "failedTurns": events["turn_failed"],
            "toolCalls": events["tool_call"],
            "toolFailures": sum(
                1 for value in records if value.get("event") == "tool_result" and value.get("failed")
            ),
            "checkpoints": events["checkpoint_created"],
            "compactions": events["context_compacted"],
            "inputTokens": sum(_integer(value.get("inputTokens")) for value in records),
            "cachedInputTokens": sum(
                _integer(value.get("cachedInputTokens")) for value in records
            ),
            "outputTokens": sum(_integer(value.get("outputTokens")) for value in records),
            "averageTurnMs": round(sum(durations) / len(durations)) if durations else 0,
            "topTools": [{"name": name, "calls": calls} for name, calls in tools.most_common(8)],
        }

    def _read(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()[-MAX_SUMMARY_RECORDS:]
        except OSError:
            return []
        records: list[dict[str, Any]] = []
        for line in lines:
            try:
                value = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(value, dict):
                records.append(value)
        return records

    def _rotate_if_needed(self, incoming_bytes: int) -> None:
        try:
            current_size = self.path.stat().st_size
        except OSError:
            return
        if current_size + incoming_bytes <= MAX_METRICS_BYTES:
            return
        archived = self.path.with_suffix(".previous.jsonl")
        try:
            self.path.replace(archived)
            os.chmod(archived, 0o600)
        except OSError:
            pass


def _integer(value: object) -> int:
    return int(value) if isinstance(value, int | float) else 0
