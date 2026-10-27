"""Append-only agent debug log.

File: ~/.coloride/desktop/agent-debug.log

Every notable agent event is one JSON line. Token/thinking deltas are skipped
so the file stays readable. The Agent view tails this file.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_DEFAULT_PATH = Path.home() / ".coloride" / "desktop" / "agent-debug.log"
_LOG_PATH = _DEFAULT_PATH
_LOCK = threading.Lock()
_ENABLED_OVERRIDE: bool | None = None
MAX_LOG_BYTES = 8 * 1024 * 1024
MAX_STR = 400
MAX_LIST = 12
MAX_KEYS = 24
SKIP_EMIT_TYPES = frozenset({"text_delta", "thinking_delta", "reasoning_delta", "file_write_delta"})


def configure_agent_debug_log(path: Path | None, *, enabled: bool | None = None) -> None:
    """Tests override the default home-dir path. `enabled` forces the dev gate."""
    global _LOG_PATH, _ENABLED_OVERRIDE
    _LOG_PATH = path if path is not None else _DEFAULT_PATH
    _ENABLED_OVERRIDE = enabled if path is not None else None


def agent_debug_enabled() -> bool:
    """File + API logging is a development aid — never in packaged/production."""
    if _ENABLED_OVERRIDE is not None:
        return _ENABLED_OVERRIDE
    return os.environ.get("COLORIDE_DEV") == "1"


def agent_debug_path() -> str:
    return str(_LOG_PATH)


def compact_log_value(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if isinstance(value, str):
        return value if len(value) <= MAX_STR else f"{value[:MAX_STR]}…"
    if isinstance(value, BaseException):
        return f"{type(value).__name__}: {value}"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        items = [compact_log_value(item, depth + 1) for item in value[:MAX_LIST]]
        if len(value) > MAX_LIST:
            items.append(f"…+{len(value) - MAX_LIST}")
        return items
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for index, (key, field) in enumerate(value.items()):
            if index >= MAX_KEYS:
                out["…"] = f"+{len(value) - MAX_KEYS}"
                break
            out[str(key)] = compact_log_value(field, depth + 1)
        return out
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def agent_debug(message: str, **fields: Any) -> None:
    """Best-effort structured log line. Never raises into the agent loop."""
    if not agent_debug_enabled():
        return
    try:
        payload: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "msg": message,
        }
        for key, value in fields.items():
            if value is None:
                continue
            if isinstance(value, BaseException):
                payload[key] = f"{type(value).__name__}: {value}"
                payload[f"{key}Trace"] = "".join(
                    traceback.format_exception(type(value), value, value.__traceback__)
                )[-4000:]
            else:
                payload[key] = compact_log_value(value)
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        encoded = line.encode("utf-8")
        with _LOCK:
            _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            _rotate_if_needed(len(encoded))
            with _LOG_PATH.open("a", encoding="utf-8") as handle:
                handle.write(line)
    except Exception:
        pass


def agent_debug_console(message: str, **fields: Any) -> None:
    """Write one safe, structured diagnostic to the Electron dev console.

    The sidecar's stdout starts with its discovery JSON, so diagnostics must go
    to stderr.  Keep this opt-in to ``COLORIDE_DEV`` just like the file log: it
    is for diagnosing an integration, never a production telemetry channel.
    """
    if not agent_debug_enabled():
        return
    try:
        payload = {key: compact_log_value(value) for key, value in fields.items() if value is not None}
        print(
            f"[coloride][agent] {message} {json.dumps(payload, ensure_ascii=False)}",
            file=sys.stderr,
            flush=True,
        )
    except Exception:
        # Diagnostics must never interfere with the model turn.
        pass


def read_agent_debug_records(session_id: str | None = None) -> list[dict[str, Any]]:
    """Debug file lines. Pass session_id to keep only that chat."""
    path = _LOG_PATH
    if not path.exists():
        return []
    wanted = (session_id or "").strip()
    records: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for index, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except (ValueError, TypeError):
                    if wanted:
                        continue
                    records.append({"line": index, "_unparsed": line.rstrip("\n")})
                    continue
                if not isinstance(value, dict):
                    if wanted:
                        continue
                    records.append({"line": index, "_value": value})
                    continue
                if wanted and str(value.get("sessionId") or "") != wanted:
                    continue
                value.setdefault("line", index)
                records.append(value)
    except OSError:
        return records
    return records


def write_agent_dump(file_name: str, content: str) -> str:
    """Persist a complete dump next to the debug log. Returns absolute path."""
    directory = _LOG_PATH.parent / "agent-dumps"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / file_name
    path.write_text(content, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return str(path)


def log_agent_emit(session_id: str, event_type: str, data: dict[str, Any] | None = None) -> None:
    """Mirror a session event into the debug log (skips high-frequency deltas)."""
    if event_type in SKIP_EMIT_TYPES:
        return
    payload = dict(data) if isinstance(data, dict) else {}
    # Event payloads often already include sessionId / message (loop_warning).
    payload.pop("sessionId", None)
    payload.pop("msg", None)
    detail = payload.pop("message", None)
    if detail is not None and "detail" not in payload:
        payload["detail"] = detail
    agent_debug(event_type, sessionId=session_id, **payload)


def read_agent_debug(*, after: int | None = None, tail: int = 300, limit: int = 400) -> dict[str, Any]:
    """Read JSON lines. `after` is a 0-based line offset already consumed."""
    path = _LOG_PATH
    empty = {
        "enabled": agent_debug_enabled(),
        "path": str(path),
        "after": 0,
        "nextAfter": 0,
        "total": 0,
        "entries": [],
    }
    if not agent_debug_enabled():
        return empty
    limit = max(1, min(int(limit), 2000))
    tail = max(1, min(int(tail), 2000))
    if not path.exists():
        return empty
    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return empty
    total = len(raw_lines)
    if after is None:
        start = max(0, total - tail)
    else:
        start = max(0, int(after))
        if start > total:
            start = max(0, total - tail)
    chunk = raw_lines[start : start + limit]
    entries: list[dict[str, Any]] = []
    for offset, line in enumerate(chunk):
        payload: dict[str, Any]
        try:
            parsed = json.loads(line)
            payload = parsed if isinstance(parsed, dict) else {"msg": str(parsed)}
        except (ValueError, TypeError):
            payload = {"msg": line}
        payload["line"] = start + offset + 1
        entries.append(payload)
    return {
        "enabled": True,
        "path": str(path),
        "after": start,
        "nextAfter": start + len(chunk),
        "total": total,
        "entries": entries,
    }


def _rotate_if_needed(incoming_bytes: int) -> None:
    try:
        current_size = _LOG_PATH.stat().st_size
    except OSError:
        return
    if current_size + incoming_bytes <= MAX_LOG_BYTES:
        return
    archived = _LOG_PATH.with_suffix(".previous.log")
    try:
        _LOG_PATH.replace(archived)
        os.chmod(archived, 0o600)
    except OSError:
        pass
