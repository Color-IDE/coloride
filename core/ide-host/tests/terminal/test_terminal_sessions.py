from __future__ import annotations

import asyncio
import struct
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

from coloride_desktop.term.sessions import TerminalRegistry
from coloride_desktop.term.tmux_control import TmuxControlClient


class FakeProcess:
    def __init__(self) -> None:
        self.sizes: list[tuple[int, int]] = []

    def change_terminal_size(self, cols: int, rows: int) -> None:
        self.sizes.append((cols, rows))


def test_resize_does_not_resize_outer_pty_in_tmux_control_mode() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=120, rows=30)
    process = FakeProcess()
    session.process = cast(Any, process)
    session.control = cast(TmuxControlClient, object())

    registry.resize(session.term_id, 80, 24)

    assert (session.cols, session.rows) == (80, 24)
    assert process.sizes == []


def test_local_resize_skips_repeated_pty_size(monkeypatch) -> None:
    calls: list[tuple[int, int]] = []

    def fake_ioctl(_fd: int, _request: int, packed: bytes) -> None:
        rows, cols = struct.unpack("HHHH", packed)[:2]
        calls.append((cols, rows))

    monkeypatch.setattr("coloride_desktop.term.sessions.fcntl", SimpleNamespace(ioctl=fake_ioctl))
    monkeypatch.setattr(
        "coloride_desktop.term.sessions.termios",
        SimpleNamespace(TIOCSWINSZ=1),
    )
    registry = TerminalRegistry()
    session = registry.create(cols=80, rows=24)
    session.local = True
    session.local_master_fd = 7

    registry.resize(session.term_id, 80, 24)
    registry.resize(session.term_id, 80, 24)
    registry.resize(session.term_id, 100, 30)
    registry.resize(session.term_id, 80, 24)
    registry.resize(session.term_id, 100, 30)
    registry.resize(session.term_id, 100, 30)

    assert calls == [(80, 24), (100, 30), (80, 24), (100, 30)]
    assert session.local_pty_size == (100, 30)


def test_resize_keeps_pty_fallback_without_tmux_control_mode() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=120, rows=30)
    process = FakeProcess()
    session.process = cast(Any, process)

    registry.resize(session.term_id, 80, 24)

    assert process.sizes == [(80, 24)]


def test_attach_does_not_repeat_initial_size_in_tmux_control_mode() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=120, rows=30)
    process = FakeProcess()
    session.control = cast(TmuxControlClient, object())

    registry.attach(session.term_id, cast(Any, process))

    assert session.process is process
    assert process.sizes == []


def test_attach_applies_initial_size_without_tmux_control_mode() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=120, rows=30)
    process = FakeProcess()

    registry.attach(session.term_id, cast(Any, process))

    assert process.sizes == [(120, 30)]


def test_session_id_restores_same_logical_terminal() -> None:
    registry = TerminalRegistry()
    first = registry.create(cols=120, rows=30, session_id="session_persistent_123")
    restored = registry.create(cols=90, rows=24, session_id="session_persistent_123")

    assert restored is first
    assert restored.term_id == first.term_id
    assert (restored.cols, restored.rows) == (90, 24)


def test_suspend_is_non_destructive_but_close_removes_session() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=80, rows=24, session_id="session_suspend_123")

    assert registry.suspend(session.term_id) is True
    assert registry.get(session.term_id) is session
    assert session.suspended is True

    registry.close(session.term_id)
    assert registry.get(session.term_id) is None


def test_local_output_is_capped_at_two_mebibytes() -> None:
    registry = TerminalRegistry()
    session = registry.create(cols=80, rows=24, session_id="session_output_123", local=True)

    registry.append_local_output(session, b"a" * (2 * 1024 * 1024))
    registry.append_local_output(session, b"tail")

    assert len(session.local_output) <= 2 * 1024 * 1024
    assert session.local_output.endswith(b"tail")


def test_close_connection_is_isolated_from_local_and_other_servers() -> None:
    registry = TerminalRegistry()
    local = registry.create(
        cols=80,
        rows=24,
        session_id="session_local_123",
        local=True,
    )
    first_server = registry.create(
        cols=80,
        rows=24,
        session_id="session_server_a_123",
        connection_id="server-a",
    )
    other_server = registry.create(
        cols=80,
        rows=24,
        session_id="session_server_b_123",
        connection_id="server-b",
    )

    registry.close_connection("server-a")

    assert registry.get(first_server.term_id) is None
    assert registry.get(local.term_id) is local
    assert registry.get(other_server.term_id) is other_server


def test_suspend_all_keeps_session_descriptors() -> None:
    registry = TerminalRegistry()
    local = registry.create(cols=80, rows=24, session_id="session_local_suspend", local=True)
    remote = registry.create(
        cols=80,
        rows=24,
        session_id="session_remote_suspend",
        connection_id="server-a",
    )

    registry.suspend_all()

    assert registry.get(local.term_id) is local
    assert registry.get(remote.term_id) is remote
    assert local.suspended is True
    assert remote.suspended is True


def test_local_scrollback_survives_registry_restart(tmp_path: Path) -> None:
    first_registry = TerminalRegistry(tmp_path)
    first = first_registry.create(
        cols=80,
        rows=24,
        session_id="session_disk_recovery",
        local=True,
    )
    first_registry.append_local_output(first, b"before restart\r\n")

    restored_registry = TerminalRegistry(tmp_path)
    restored = restored_registry.create(
        cols=80,
        rows=24,
        session_id="session_disk_recovery",
        local=True,
    )

    assert restored.local_output == b"before restart\r\n"
    assert (tmp_path / "session_disk_recovery.scrollback").stat().st_mode & 0o777 == 0o600

    restored_registry.clear_local_output(restored)

    assert restored.local_output == b""
    assert (tmp_path / "session_disk_recovery.scrollback").read_bytes() == b""


def test_local_persistence_batches_and_flushes_on_host_shutdown(tmp_path: Path) -> None:
    async def scenario() -> None:
        registry = TerminalRegistry(tmp_path)
        session = registry.create(cols=80, rows=24, session_id="batched_history", local=True)
        path = tmp_path / "batched_history.scrollback"
        registry.append_local_output(session, b"first")
        timer = session.local_persist_timer
        registry.append_local_output(session, b" second")
        assert session.local_persist_timer is timer
        assert not path.exists()
        await asyncio.sleep(0.3)
        assert path.read_bytes() == b"first second"
        registry.append_local_output(session, b" final")
        registry.close(session.term_id, preserve_history=True)
        assert session.local_persist_timer is None
        assert path.read_bytes() == b"first second final"
        restored = registry.create(cols=80, rows=24, session_id="batched_history", local=True)
        assert restored.local_output == b"first second final"
        registry.append_local_output(restored, b" discard")
        registry.clear_local_output(restored)
        assert restored.local_persist_timer is None
        assert path.read_bytes() == b""
        registry.close(restored.term_id)
        assert not path.exists()

    asyncio.run(scenario())
