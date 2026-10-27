from __future__ import annotations

import contextlib
import sys
from collections.abc import Callable, Coroutine
from typing import Any

OutputCallback = Callable[[bytes], Coroutine[Any, Any, None]]


def unescape_output(data: bytes) -> bytes:
    """Decode tmux control-mode ``%output`` escaping.

    tmux escapes any non-printable byte (and the backslash itself) as a
    backslash followed by three octal digits, e.g. ``b'\\015'`` -> ``b'\\r'``.
    Printable ASCII passes through untouched. Multibyte UTF-8 arrives as a
    run of octal escapes (one per byte), so decoding byte-by-byte is correct.
    """
    out = bytearray()
    i = 0
    n = len(data)
    while i < n:
        b = data[i]
        if (
            b == 0x5C  # backslash
            and i + 3 < n
            and 0x30 <= data[i + 1] <= 0x37
            and 0x30 <= data[i + 2] <= 0x37
            and 0x30 <= data[i + 3] <= 0x37
        ):
            out.append(int(data[i + 1 : i + 4], 8) & 0xFF)
            i += 4
        else:
            out.append(b)
            i += 1
    return bytes(out)


class TmuxControlClient:
    """Minimal tmux control-mode (``tmux -CC``) client for a single pane.

    In control mode tmux does not draw a full-screen UI. Instead it emits
    notifications (lines starting with ``%``) and pane output as escaped
    ``%output`` lines. We turn that back into raw bytes so xterm renders it
    as normal output -- which means xterm keeps its own smooth scrollback
    and working scrollbar, while the session still lives in tmux on the
    server (survives SSH drops).

    Keystrokes are delivered with ``send-keys -H`` (hex) so arbitrary bytes
    survive intact; resize uses ``refresh-client -C``.
    """

    def __init__(self, proc: Any, session: str, on_output: OutputCallback) -> None:
        self._proc = proc
        self._session = session
        self._on_output = on_output
        self._closed = False
        self._size: tuple[int, int] | None = None

    async def start(self, cols: int, rows: int) -> None:
        """Configure the client, then pump output until EOF/exit."""
        # The SSH control PTY is created with this exact size. Reapplying it
        # here sends an unnecessary SIGWINCH to the shell, which can redraw the
        # current prompt immediately after its captured copy was replayed.
        self._size = (cols, rows)
        await self._send_cmd(f"set-option -t {self._session} -g status off")
        await self._send_cmd(f"set-option -t {self._session} -g mouse off")
        await self._pump()

    async def _pump(self) -> None:
        buf = b""
        while not self._closed:
            try:
                chunk = await self._proc.stdout.read(4096)
            except Exception as exc:
                print(f"[TMUXCC] read error: {exc}", file=sys.stderr)
                break
            if not chunk:
                break
            buf += chunk
            while True:
                idx = buf.find(b"\n")
                if idx == -1:
                    break
                line = buf[:idx].rstrip(b"\r")
                buf = buf[idx + 1 :]
                await self._handle_line(line)

    async def _handle_line(self, line: bytes) -> None:
        if line.startswith(b"%output "):
            rest = line[len(b"%output ") :]
            # rest looks like: b"%0 <escaped-data>"
            sp = rest.find(b" ")
            if sp == -1:
                return
            raw = unescape_output(rest[sp + 1 :])
            if raw:
                # Shell Integration uses a private OSC channel. Keep this
                # deliberately content-free: it proves the marker survived
                # the SSH/tmux control-mode path without logging user commands.
                if b"\x1b]633;Coloride" in raw:
                    # Event kind only; never command text or other user data.
                    event = raw.split(b"\x1b]633;", 1)[1].split(b";", 1)[0]
                    print(
                        f"[TMUXCC] shell integration event={event.decode('ascii', 'replace')}",
                        file=sys.stderr,
                    )
                await self._on_output(raw)
        elif line.startswith(b"%exit"):
            self._closed = True
        elif line.startswith(b"%error"):
            print(f"[TMUXCC] {line.decode('utf-8', 'replace')}", file=sys.stderr)
        # Other notifications (%begin/%end/%window-*/%layout-change/...) are
        # not needed for a single-pane terminal, so we ignore them.

    async def send_input(self, data: bytes) -> None:
        """Forward raw keystroke bytes to the active pane via send-keys -H."""
        if self._closed or not data:
            return
        hexs = " ".join(f"{b:02x}" for b in data)
        await self._send_cmd(f"send-keys -t {self._session} -H {hexs}")

    async def resize(self, cols: int, rows: int) -> None:
        if self._closed or self._size == (cols, rows):
            return
        await self._send_cmd(f"refresh-client -C {cols}x{rows}")
        self._size = (cols, rows)

    async def _send_cmd(self, cmd: str) -> None:
        try:
            self._proc.stdin.write((cmd + "\n").encode())
            await self._proc.stdin.drain()
        except Exception as exc:
            print(f"[TMUXCC] write error: {exc}", file=sys.stderr)

    async def close(self) -> None:
        self._closed = True
        with contextlib.suppress(Exception):
            self._proc.stdin.close()
        with contextlib.suppress(Exception):
            self._proc.terminate()
