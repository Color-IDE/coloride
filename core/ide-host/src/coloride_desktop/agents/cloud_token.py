"""In-process + on-disk bridge for the Coloride cloud access JWT.

The renderer holds the user session after device login. The Python agent loop
needs the same JWT to call `POST /v1/llm/responses` (managed LLM). Frontend
pushes the token via `/api/cloud-auth/agent-token` whenever it refreshes.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import threading
import time
from pathlib import Path

from ..cloud import cloud_api_base

_lock = threading.Lock()
_memory_token: str | None = None

_DEFAULT_PATH = Path.home() / ".coloride" / "desktop" / "cloud-access-token.v1"
# Refresh a bit before typical 15-minute product JWTs die mid-turn.
_REFRESH_SKEW_SECONDS = 90.0


def token_path() -> Path:
    override = os.environ.get("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", "").strip()
    if override:
        return Path(override)
    api_base = cloud_api_base(os.environ)
    if not api_base:
        return _DEFAULT_PATH
    suffix = hashlib.sha256(api_base.encode()).hexdigest()[:16]
    return _DEFAULT_PATH.with_name(f"{_DEFAULT_PATH.name}.{suffix}")


def get_cloud_access_token() -> str | None:
    """Return the latest non-empty access token, or None."""
    global _memory_token
    with _lock:
        if _memory_token and _memory_token.strip():
            # Another local process may have refreshed the disk bridge. Once
            # this cached JWT needs refresh, reread instead of polling the same
            # expired value forever. Keep opaque tokens and fresh JWTs cached.
            expires_at = cloud_access_token_expires_at(_memory_token)
            if expires_at is None or time.time() < expires_at - _REFRESH_SKEW_SECONDS:
                return _memory_token.strip()
        try:
            path = token_path()
            if not path.is_file():
                return None
            value = path.read_text(encoding="utf-8").strip()
            if not value:
                return None
            _memory_token = value
            return value
        except OSError:
            return None


def set_cloud_access_token(token: str | None) -> None:
    """Persist (or clear) the access token for the agent provider."""
    global _memory_token
    normalized = (token or "").strip()
    with _lock:
        _memory_token = normalized or None
        path = token_path()
        try:
            if not normalized:
                if path.is_file():
                    path.unlink()
                return
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(path.parent, 0o700)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(normalized, encoding="utf-8")
            os.chmod(temporary, 0o600)
            temporary.replace(path)
            os.chmod(path, 0o600)
        except OSError:
            # Memory still works for this process.
            pass


def clear_cloud_access_token() -> None:
    set_cloud_access_token(None)


def cloud_access_token_expires_at(token: str | None = None) -> float | None:
    """Return JWT exp as unix seconds, or None if the token is opaque / unreadable."""
    raw = (token if token is not None else get_cloud_access_token()) or ""
    parts = raw.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload + padding)
        data = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    exp = data.get("exp")
    try:
        return float(exp) if exp is not None else None
    except (TypeError, ValueError):
        return None


def cloud_access_token_needs_refresh(
    token: str | None = None,
    *,
    now: float | None = None,
    skew_seconds: float = _REFRESH_SKEW_SECONDS,
) -> bool:
    """True when the stored JWT is missing, expired, or about to expire."""
    current = token if token is not None else get_cloud_access_token()
    if not current:
        return True
    expires_at = cloud_access_token_expires_at(current)
    if expires_at is None:
        return False
    return float(now if now is not None else time.time()) >= (expires_at - max(0.0, skew_seconds))


async def wait_for_fresh_cloud_access_token(
    *,
    timeout_seconds: float = 10.0,
    poll_seconds: float = 0.2,
) -> str | None:
    """Wait until the renderer pushes a JWT that is not expired / about to expire."""
    deadline = time.monotonic() + max(0.2, timeout_seconds)
    interval = max(0.05, poll_seconds)
    while True:
        current = get_cloud_access_token()
        if current and not cloud_access_token_needs_refresh(current):
            return current
        if time.monotonic() >= deadline:
            current = get_cloud_access_token()
            if current and not cloud_access_token_needs_refresh(current):
                return current
            return None
        await asyncio.sleep(interval)
