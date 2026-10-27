from __future__ import annotations

import pytest

from coloride_desktop.term.tmux_control import TmuxControlClient


class FakeStdin:
    def __init__(self) -> None:
        self.commands: list[bytes] = []

    def write(self, data: bytes) -> None:
        self.commands.append(data)

    async def drain(self) -> None:
        return None


class FakeStdout:
    async def read(self, _size: int) -> bytes:
        return b""


class FakeControlProcess:
    def __init__(self) -> None:
        self.stdin = FakeStdin()
        self.stdout = FakeStdout()


@pytest.mark.asyncio
async def test_start_does_not_repeat_the_initial_pty_size() -> None:
    process = FakeControlProcess()

    async def on_output(_data: bytes) -> None:
        return None

    client = TmuxControlClient(process, "coloride_test", on_output)
    await client.start(120, 22)

    assert b"refresh-client -C 120x22\n" not in process.stdin.commands
    assert process.stdin.commands == [
        b"set-option -t coloride_test -g status off\n",
        b"set-option -t coloride_test -g mouse off\n",
    ]

    await client.resize(80, 24)

    assert process.stdin.commands[-1] == b"refresh-client -C 80x24\n"
