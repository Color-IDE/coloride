from __future__ import annotations

import base64
import json

import pytest

from coloride_desktop.agents.cloud_token import (
    cloud_access_token_expires_at,
    cloud_access_token_needs_refresh,
)


def _jwt(*, exp: float | None = None, extra: dict[str, object] | None = None) -> str:
    payload: dict[str, object] = {}
    if extra:
        payload.update(extra)
    if exp is not None:
        payload["exp"] = exp
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    return f"header.{encoded.rstrip('=')}.sig"


def test_cloud_access_token_expires_at_reads_jwt_exp() -> None:
    token = _jwt(exp=1_700_000_090)
    assert cloud_access_token_expires_at(token) == 1_700_000_090.0


def test_cloud_access_token_expires_at_opaque_token() -> None:
    assert cloud_access_token_expires_at("not-a-jwt") is None
    assert cloud_access_token_expires_at("") is None


def test_cloud_access_token_needs_refresh_near_expiry() -> None:
    now = 1_700_000_000.0
    assert cloud_access_token_needs_refresh(_jwt(exp=now + 30), now=now, skew_seconds=90)
    assert not cloud_access_token_needs_refresh(_jwt(exp=now + 200), now=now, skew_seconds=90)


def test_cloud_access_token_needs_refresh_missing_and_opaque(tmp_path, monkeypatch) -> None:
    from coloride_desktop.agents.cloud_token import clear_cloud_access_token

    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(tmp_path / "cloud.jwt"))
    clear_cloud_access_token()
    assert cloud_access_token_needs_refresh("")
    assert cloud_access_token_needs_refresh(None)
    assert not cloud_access_token_needs_refresh("opaque-token", now=1_700_000_000.0)


@pytest.mark.asyncio
async def test_wait_for_fresh_cloud_access_token(tmp_path, monkeypatch) -> None:
    import asyncio
    import time

    from coloride_desktop.agents.cloud_token import (
        clear_cloud_access_token,
        set_cloud_access_token,
        wait_for_fresh_cloud_access_token,
    )

    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(tmp_path / "cloud.jwt"))
    clear_cloud_access_token()
    set_cloud_access_token(_jwt(exp=time.time() - 10))

    async def push_fresh() -> None:
        await asyncio.sleep(0.05)
        set_cloud_access_token(_jwt(exp=time.time() + 600))

    asyncio.create_task(push_fresh())
    fresh = await wait_for_fresh_cloud_access_token(timeout_seconds=1.0, poll_seconds=0.02)
    assert fresh is not None
    assert not cloud_access_token_needs_refresh(fresh)
    clear_cloud_access_token()


async def test_expired_memory_token_observes_refresh_from_another_process(tmp_path, monkeypatch):
    import time

    from coloride_desktop.agents.cloud_token import (
        clear_cloud_access_token,
        get_cloud_access_token,
        set_cloud_access_token,
        wait_for_fresh_cloud_access_token,
    )

    path = tmp_path / "cloud.jwt"
    monkeypatch.setenv("COLORIDE_CLOUD_ACCESS_TOKEN_PATH", str(path))
    expired = _jwt(exp=time.time() - 10)
    fresh = _jwt(exp=time.time() + 600)
    try:
        set_cloud_access_token(expired)
        assert get_cloud_access_token() == expired
        path.write_text(fresh)  # Renderer/another local host refreshed the disk bridge.
        assert await wait_for_fresh_cloud_access_token(timeout_seconds=0.2) == fresh
    finally:
        clear_cloud_access_token()
