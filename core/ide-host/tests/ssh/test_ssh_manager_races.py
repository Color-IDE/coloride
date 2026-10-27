from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

import pytest

from coloride_desktop.ssh.manager import (
    AsyncSSHConnectionManager,
    ConnectionCredentials,
    ConnectionSnapshot,
    ConnectionState,
)


class FakeConnectedConnection:
    def is_closed(self) -> bool:
        return False


@pytest.mark.asyncio
async def test_concurrent_connects_to_same_profile_are_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = AsyncSSHConnectionManager()
    credentials = ConnectionCredentials(host="example.test", port=22, username="root")
    connect_calls = 0

    async def fake_connect_locked(
        profile_id: str,
        creds: ConnectionCredentials,
    ) -> ConnectionSnapshot:
        nonlocal connect_calls
        connect_calls += 1
        await asyncio.sleep(0.01)
        manager._conn = cast(Any, FakeConnectedConnection())
        manager._snapshot = ConnectionSnapshot(
            state=ConnectionState.CONNECTED,
            profile_id=profile_id,
            rtt_ms=10,
            cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
        )
        return manager._snapshot

    monkeypatch.setattr(manager, "_connect_locked", fake_connect_locked)

    snapshots = await asyncio.gather(
        manager.connect("profile-1", credentials),
        manager.connect("profile-1", credentials),
        manager.connect("profile-1", credentials),
    )

    assert connect_calls == 1
    assert all(snapshot.state == ConnectionState.CONNECTED for snapshot in snapshots)


class StatsConnection:
    def __init__(self, manager: AsyncSSHConnectionManager) -> None:
        self.manager = manager

    async def run(self, command: str, *, check: bool) -> object:
        if command == "cat /proc/net/dev":
            self.manager._conn = None
            output = "header\nheader\neth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n"
        elif "/proc/meminfo" in command:
            output = "42"
        elif command.startswith("df -P / "):
            output = "17"
        else:
            output = ""
        return SimpleNamespace(stdout=output)


@pytest.mark.asyncio
async def test_stats_sample_keeps_stable_connection_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = AsyncSSHConnectionManager()
    connection = StatsConnection(manager)
    manager._conn = cast(Any, connection)
    manager._connected_at = datetime.now(UTC)
    manager._snapshot = ConnectionSnapshot(
        state=ConnectionState.CONNECTED,
        profile_id="profile-1",
        rtt_ms=12,
        cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
    )

    async def fake_cpu(candidate: object) -> float:
        assert candidate is connection
        return 8.5

    monkeypatch.setattr(manager, "_get_cpu_percent", fake_cpu)

    stats = await manager.get_stats()

    assert stats["server"] == {"cpu": 8.5, "memPct": 42.0, "diskPct": 17.0}
