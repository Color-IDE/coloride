from __future__ import annotations

from typing import Any, cast

import asyncssh
import pytest

from coloride_desktop.ssh.manager import AsyncSSHConnectionManager, ConnectionCredentials


class FakeSharedConnection:
    async def create_process(self, command: str, **kwargs: object) -> object:
        raise asyncssh.ChannelOpenError(1, "open failed")


class FakeDedicatedConnection:
    def __init__(self) -> None:
        self.process = object()
        self.commands: list[str] = []

    def is_closed(self) -> bool:
        return False

    async def run(self, command: str, **kwargs: object) -> object:
        self.commands.append(command)
        return type("Result", (), {"exit_status": 0, "stdout": "", "stderr": ""})()

    async def create_process(self, command: str, **kwargs: object) -> object:
        self.commands.append(command)
        return self.process


@pytest.mark.asyncio
async def test_control_pty_falls_back_to_dedicated_ssh_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = AsyncSSHConnectionManager()
    manager._conn = cast(Any, FakeSharedConnection())
    manager._last_creds = ConnectionCredentials(host="example.test", port=22, username="root")
    dedicated = FakeDedicatedConnection()

    monkeypatch.setattr(manager, "_connection_kwargs", lambda creds: {"host": creds.host})

    async def fake_connect(**kwargs: object) -> FakeDedicatedConnection:
        return dedicated

    monkeypatch.setattr(asyncssh, "connect", fake_connect)

    handle = await manager.open_control_pty(
        80,
        24,
        tmux_session="coloride_test",
        cwd="/root",
    )

    assert handle.process is dedicated.process
    assert handle.owned_connection is dedicated


@pytest.mark.asyncio
async def test_control_pty_uses_elevated_connection_when_present() -> None:
    manager = AsyncSSHConnectionManager()
    restricted = FakeDedicatedConnection()
    elevated = FakeDedicatedConnection()
    manager._conn = cast(Any, restricted)
    manager._elevated_conn = cast(Any, elevated)
    manager._elevated_username = "root"
    manager._elevated_creds = ConnectionCredentials(host="example.test", port=22, username="root")
    manager._last_creds = ConnectionCredentials(host="example.test", port=22, username="coloride")

    handle = await manager.open_control_pty(
        80,
        24,
        tmux_session="coloride_test",
        cwd="/",
    )

    assert handle.process is elevated.process
    assert handle.owned_connection is None
    assert any("tmux" in command for command in elevated.commands)
    assert restricted.commands == []
