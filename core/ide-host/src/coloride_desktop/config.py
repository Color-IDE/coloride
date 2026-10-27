from __future__ import annotations

import os
import secrets
import socket
from dataclasses import dataclass


def find_free_port() -> int:
    """Ask the OS for a free localhost port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _env_port() -> int | None:
    raw = os.environ.get("COLORIDE_PORT", "").strip()
    if not raw:
        return None
    try:
        port = int(raw)
    except ValueError:
        return None
    if 1 <= port <= 65535:
        return port
    return None


@dataclass(frozen=True, slots=True)
class LaunchConfig:
    host: str
    port: int
    bearer_token: str
    frontend_dist: str | None = None

    @classmethod
    def create(cls, *, frontend_dist: str | None = None) -> LaunchConfig:
        token = (os.environ.get("COLORIDE_TOKEN") or "").strip() or secrets.token_urlsafe(32)
        return cls(
            host=(os.environ.get("COLORIDE_HOST") or "127.0.0.1").strip() or "127.0.0.1",
            port=_env_port() or find_free_port(),
            bearer_token=token,
            frontend_dist=frontend_dist,
        )
