from __future__ import annotations

import asyncio
import contextlib
import os
import secrets
import signal
import struct
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

try:
    import fcntl
    import termios
except ImportError:  # Windows — local PTY ioctl resize is Unix-only.
    fcntl = None  # type: ignore[assignment]
    termios = None  # type: ignore[assignment]

import asyncssh

from .local_pty import LocalPtyIO

if TYPE_CHECKING:
    from .tmux_control import TmuxControlClient


def _signal_local_session(session_pid: int, *, force: bool = False) -> None:
    """Signal every job in this PTY session, including bash background groups."""
    if session_pid == os.getsid(0):
        return
    try:
        listing = subprocess.run(
            ["/bin/ps", "-axo", "pid=,pgid="],
            capture_output=True,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    groups: set[int] = set()
    for line in listing.stdout.splitlines():
        fields = line.split()
        if len(fields) != 2:
            continue
        pid, group = map(int, fields)
        with contextlib.suppress(ProcessLookupError, PermissionError):
            if os.getsid(pid) == session_pid and group != os.getpgrp():
                groups.add(group)
    for group in groups:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            if force:
                os.killpg(group, signal.SIGKILL)
            else:
                os.killpg(group, signal.SIGHUP)
                os.killpg(group, signal.SIGCONT)
                os.killpg(group, signal.SIGTERM)


@dataclass(slots=True)
class TerminalSession:
    term_id: str
    session_id: str
    cols: int
    rows: int
    cwd: str | None = None
    process: asyncssh.SSHClientProcess[str] | None = None
    tmux_session: str | None = None  # e.g. "coloride_term_xxx" for immortal terminals
    shell: str = "default"
    control: TmuxControlClient | None = None  # set when running in tmux control mode (-CC)
    exit_reported: bool = False
    local: bool = False
    connection_id: str | None = None
    local_master_fd: int | None = None
    # Last size actually pushed to the local PTY. A repeated ioctl still
    # delivers SIGWINCH, and zsh redraws the prompt on every one.
    local_pty_size: tuple[int, int] | None = None
    local_io: LocalPtyIO | None = None
    local_process: object | None = None
    local_start_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    local_persist_timer: asyncio.TimerHandle | None = None
    local_output_end: int = 0
    local_consumers: dict[str, int] = field(default_factory=dict)
    local_output_changed: asyncio.Event = field(default_factory=asyncio.Event)
    local_ack_changed: asyncio.Event = field(default_factory=asyncio.Event)
    local_output: bytearray = field(default_factory=bytearray)
    local_clients: set[asyncio.Queue[bytes]] = field(default_factory=set)
    local_pump: asyncio.Task[None] | None = None
    suspended: bool = False
    exited: bool = False
    agent_owner: str | None = None
    agent_workspace: str | None = None
    agent_title: str | None = None
    agent_revealed: bool = True


class TerminalRegistry:
    def __init__(self, persistence_root: str | Path | None = None) -> None:
        self._sessions: dict[str, TerminalSession] = {}
        self._reported_exits: set[str] = set()
        self._persistence_root = Path(persistence_root).expanduser() if persistence_root else None
        if self._persistence_root is not None:
            self._persistence_root.mkdir(mode=0o700, parents=True, exist_ok=True)
            with contextlib.suppress(OSError):
                self._persistence_root.chmod(0o700)

    def create(
        self,
        *,
        cols: int,
        rows: int,
        cwd: str | None = None,
        local: bool = False,
        connection_id: str | None = None,
        session_id: str | None = None,
    ) -> TerminalSession:
        # Local sessions have no SSH profile identity. Renderer callers may
        # use either null or the UI sentinel "local" for the same machine.
        connection_id = "local" if local else connection_id
        stable_id = session_id or f"session_{secrets.token_hex(12)}"
        existing = self.find_by_session_id(stable_id, connection_id=connection_id, local=local)
        if existing is not None:
            existing.cols = cols
            existing.rows = rows
            existing.cwd = cwd or existing.cwd
            existing.suspended = False
            return existing
        session = TerminalSession(
            term_id=f"term_{secrets.token_hex(8)}",
            session_id=stable_id,
            cols=cols,
            rows=rows,
            cwd=cwd,
            local=local,
            connection_id=connection_id,
        )
        if local:
            persisted = self._scrollback_path(stable_id)
            if persisted is not None:
                with contextlib.suppress(OSError):
                    session.local_output.extend(persisted.read_bytes()[-2 * 1024 * 1024 :])
                    session.local_output_end = len(session.local_output)
        self._sessions[session.term_id] = session
        return session

    def find_by_session_id(
        self,
        session_id: str,
        *,
        connection_id: str | None = None,
        local: bool | None = None,
    ) -> TerminalSession | None:
        return next(
            (
                session
                for session in self._sessions.values()
                if session.session_id == session_id
                and (local is True or connection_id is None or session.connection_id == connection_id)
                and (local is None or session.local == local)
            ),
            None,
        )

    def list(self) -> list[TerminalSession]:
        return list(self._sessions.values())

    def suspend(self, term_id: str) -> bool:
        session = self._sessions.get(term_id)
        if session is None:
            return False
        session.suspended = True
        if session.control is not None:
            session.control = None
        if session.process is not None and not session.local:
            with contextlib.suppress(Exception):
                session.process.close()
            session.process = None
        return True

    def suspend_all(self) -> None:
        """Detach transports while keeping shells and persistent identities alive."""
        for term_id in tuple(self._sessions):
            self.suspend(term_id)

    def bounce_remote(self) -> None:
        """Drop live SSH PTYs so the UI reconnects as the current Linux user."""
        for session in tuple(self._sessions.values()):
            if not session.local:
                self.suspend(session.term_id)

    def append_local_output(self, session: TerminalSession, data: bytes) -> None:
        session.local_output_end += len(data)
        session.local_output.extend(data)
        session.local_output_changed.set()
        overflow = len(session.local_output) - 2 * 1024 * 1024
        if overflow > 0:
            del session.local_output[:overflow]
        if self._persistence_root is not None and session.local_persist_timer is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                self._persist_local_output(session)
            else:
                # A full 2MiB ring must not be rewritten for every 4KiB read.
                session.local_persist_timer = loop.call_later(0.25, self._persist_local_output, session)

    def _persist_local_output(self, session: TerminalSession) -> None:
        session.local_persist_timer = None
        persisted = self._scrollback_path(session.session_id)
        if persisted is None:
            return
        temporary = persisted.with_suffix(".scrollback.tmp")
        try:
            temporary.write_bytes(session.local_output)
            temporary.chmod(0o600)
            temporary.replace(persisted)
        except OSError:
            with contextlib.suppress(OSError):
                temporary.unlink()

    def clear_local_output(self, session: TerminalSession) -> None:
        if session.local_persist_timer is not None:
            session.local_persist_timer.cancel()
            session.local_persist_timer = None
        session.local_output.clear()
        session.local_output_changed.set()
        session.local_ack_changed.set()
        persisted = self._scrollback_path(session.session_id)
        if persisted is not None:
            with contextlib.suppress(OSError):
                persisted.write_bytes(b"")
                persisted.chmod(0o600)

    def attach(self, term_id: str, process: asyncssh.SSHClientProcess[str]) -> None:
        if term_id in self._sessions:
            sess = self._sessions[term_id]
            sess.process = process
            # A tmux control client was created with this exact size and owns
            # future resizing through refresh-client. Sending a second SSH
            # resize here makes readline redraw the active command, which can
            # leave duplicated fragments in xterm.
            if sess.control is None:
                with contextlib.suppress(Exception):
                    process.change_terminal_size(sess.cols, sess.rows)

    def get(self, term_id: str) -> TerminalSession | None:
        return self._sessions.get(term_id)

    def get_process(self, term_id: str) -> asyncssh.SSHClientProcess[str] | None:
        sess = self._sessions.get(term_id)
        return sess.process if sess else None

    def detach_process(self, term_id: str) -> None:
        sess = self._sessions.get(term_id)
        if sess:
            sess.process = None

    def resize(self, term_id: str, cols: int, rows: int) -> None:
        """Update the size of a terminal.
        - Always store the new size.
        - Apply to PTY using change_terminal_size (proper SSH window size update).
        - Do NOT inject 'stty' commands as text (they would appear in the terminal output).
        """
        sess = self._sessions.get(term_id)
        if not sess:
            print(f"[RESIZE] unknown term_id={term_id}", file=sys.stderr)
            return

        old_cols, old_rows = sess.cols, sess.rows
        # A newly opened local PTY still needs its first TIOCSWINSZ even
        # when the requested size already matches the registry metadata.
        local_size_pending = (
            sess.local_master_fd is not None and sess.local_pty_size != (cols, rows)
        )
        if old_cols == cols and old_rows == rows and not local_size_pending:
            return

        sess.cols = cols
        sess.rows = rows

        # A control-mode tmux client owns its size through `refresh-client -C`.
        # Resizing its outer SSH PTY as well makes tmux process the same layout
        # change twice and can redraw the prompt over output already in xterm.
        if sess.process and sess.control is None:
            try:
                sess.process.change_terminal_size(cols, rows)
                print(
                    f"[RESIZE] applied term={term_id} {old_cols}x{old_rows} -> {cols}x{rows}",
                    file=sys.stderr,
                )
            except Exception as e:
                print(f"[RESIZE] change_terminal_size failed: {e}", file=sys.stderr)
        elif sess.control is not None:
            print(
                f"[RESIZE] stored for control mode term={term_id} {old_cols}x{old_rows} -> {cols}x{rows}",
                file=sys.stderr,
            )
        else:
            print(f"[RESIZE] stored (no PTY yet) term={term_id} -> {cols}x{rows}", file=sys.stderr)
        if (
            sess.local_master_fd is not None
            and fcntl is not None
            and termios is not None
            and sess.local_pty_size != (cols, rows)
        ):
            with contextlib.suppress(OSError):
                fcntl.ioctl(
                    sess.local_master_fd,
                    termios.TIOCSWINSZ,
                    struct.pack("HHHH", rows, cols, 0, 0),
                )
                sess.local_pty_size = (cols, rows)

    def close(self, term_id: str, *, preserve_history: bool = False) -> None:
        sess = self._sessions.pop(term_id, None)
        if sess and sess.local:
            if sess.local_persist_timer is not None:
                sess.local_persist_timer.cancel()
                sess.local_persist_timer = None
            if preserve_history:
                self._persist_local_output(sess)
            sess.exited = True
            sess.local_output_changed.set()
            sess.local_ack_changed.set()
        if sess and sess.local_pump:
            sess.local_pump.cancel()
            sess.local_pump = None
        foreground_group = None
        if sess and sess.local_master_fd is not None:
            with contextlib.suppress(OSError):
                foreground_group = os.tcgetpgrp(sess.local_master_fd)
            with contextlib.suppress(OSError):
                if sess.local_io is not None:
                    sess.local_io.close()
                else:
                    os.close(sess.local_master_fd)
            sess.local_master_fd = None
        if sess and sess.local_process:
            with contextlib.suppress(Exception):
                # The shell owns a session; stop jobs as well as the shell.
                pid = sess.local_process.pid  # type: ignore[union-attr]
                _signal_local_session(pid)
                with contextlib.suppress(RuntimeError):
                    asyncio.get_running_loop().call_later(1, lambda: _signal_local_session(pid, force=True))
                if foreground_group and foreground_group not in {pid, os.getpgrp()}:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(foreground_group, signal.SIGHUP)
                if pid != os.getpgrp():
                    os.killpg(pid, signal.SIGHUP)
                sess.local_process.terminate()  # type: ignore[union-attr]
        if sess and sess.process:
            proc = sess.process
            with contextlib.suppress(Exception):
                proc.stdin.close()
            with contextlib.suppress(Exception):
                proc.terminate()
            with contextlib.suppress(Exception):
                sess.process.close()
        if sess and sess.local and not preserve_history:
            persisted = self._scrollback_path(sess.session_id)
            if persisted is not None:
                with contextlib.suppress(OSError):
                    persisted.unlink()

    def close_all(self) -> None:
        """Force close every open terminal session.
        Called when the whole SSH connection is dropped."""
        for term_id in list(self._sessions.keys()):
            self.close(term_id)

    def close_connection(self, connection_id: str | None) -> None:
        """Close only terminals owned by one SSH profile.

        Local terminals and sessions parked for another VPS must survive an
        unrelated server disconnect.
        """
        for session in tuple(self._sessions.values()):
            if not session.local and session.connection_id == connection_id:
                self.close(session.term_id)

    def mark_exit_reported(self, term_id: str) -> None:
        sess = self._sessions.get(term_id)
        if sess:
            sess.exit_reported = True
        self._reported_exits.add(term_id)

    def has_reported_exit(self, term_id: str) -> bool:
        if term_id in self._reported_exits:
            return True
        sess = self._sessions.get(term_id)
        return bool(sess and sess.exit_reported)

    def _scrollback_path(self, session_id: str) -> Path | None:
        if self._persistence_root is None:
            return None
        safe_id = "".join(character for character in session_id if character.isalnum() or character in "_-")
        if not safe_id:
            return None
        return self._persistence_root / f"{safe_id}.scrollback"
