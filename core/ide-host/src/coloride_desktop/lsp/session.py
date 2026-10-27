"""One remote language-server process bridged to local WebSocket clients."""

from __future__ import annotations

import asyncio
import contextlib
import secrets
import shlex
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from .framing import LspFrameDecoder, encode_lsp_message

OpenProcess = Callable[..., Awaitable[Any]]
Status = Literal["starting", "ready", "error", "exited"]

def build_launch_shell(argv: list[str], root_path: str) -> str:
    if "\x00" in root_path:
        raise ValueError("rootPath must be an absolute workspace path")
    if not root_path.startswith("/") and not (
        len(root_path) >= 3 and root_path[0].isalpha() and root_path[1] == ":" and root_path[2] in "\\/"
    ):
        raise ValueError("rootPath must be an absolute workspace path")
    if not argv:
        raise ValueError("Empty LSP command")
    quoted = " ".join(shlex.quote(part) for part in argv)
    script = f"""
set +e
# GUI apps do not inherit a terminal PATH. Xcode's clangd, Homebrew,
# cargo and go live outside /usr/bin.
if [ -x /usr/libexec/path_helper ]; then
  eval "$(/usr/libexec/path_helper -s)"
fi
export PATH="$HOME/.coloride/tools/node/bin:\
$HOME/.coloride/lsp/typescript/node_modules/.bin:\
$HOME/.coloride/lsp/python/node_modules/.bin:\
$HOME/.coloride/lsp/vscode-langservers/node_modules/.bin:\
$HOME/.coloride/lsp/yaml/node_modules/.bin:\
$HOME/.coloride/lsp/shell/node_modules/.bin:\
$HOME/.coloride/lsp/dockerfile/node_modules/.bin:\
$HOME/.coloride/lsp/php/node_modules/.bin:\
$HOME/.coloride/lsp/toml/node_modules/.bin:\
$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/go/bin:$HOME/.cargo/bin:\
/usr/local/go/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:\
/Library/Developer/CommandLineTools/usr/bin:/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" >/dev/null 2>/dev/null
fi
ROOT={shlex.quote(root_path)}
echo "[lsp] user=$(whoami) workspace=$ROOT" >&2
if [ ! -d "$ROOT" ]; then
  echo "[lsp] workspace directory does not exist" >&2
  exit 91
fi
cd "$ROOT" || {{
  echo "[lsp] cd failed" >&2
  exit 91
}}
BIN={shlex.quote(argv[0])}
echo "[lsp] bin=$BIN" >&2
NODE="$(command -v node)"
LINE1="$(head -n 1 "$BIN" 2>/dev/null || true)"
case "$BIN$LINE1" in
  *.js*|*"env node"*|*"#!/usr/bin/env node"*)
    if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
      echo "[lsp] node not found PATH=$PATH" >&2
      exit 92
    fi
    exec "$NODE" {quoted}
    ;;
  *)
    exec {quoted}
    ;;
esac
"""
    return f"bash -c {shlex.quote(script)}"


@dataclass
class LspSession:
    session_id: str
    root_path: str
    command: str
    language: str = "typescript"
    status: Status = "starting"
    error: str | None = None
    created_at: float = field(default_factory=time.monotonic)
    last_used_at: float = field(default_factory=time.monotonic)

    handle: Any | None = field(default=None, repr=False)
    _reader_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _stderr_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _clients: set[Any] = field(default_factory=set, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    _decoder: LspFrameDecoder = field(default_factory=LspFrameDecoder, repr=False)
    _pending_requests: dict[int, asyncio.Future[Any]] = field(default_factory=dict, repr=False)
    _request_sequence: int = field(default=0, repr=False)

    def touch(self) -> None:
        self.last_used_at = time.monotonic()

    def to_info(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "language": self.language,
            "rootPath": self.root_path,
            "command": self.command.replace("\x00", " ") if "\x00" in self.command else self.command,
            "status": self.status,
            "error": self.error,
        }

    def _argv(self) -> list[str]:
        if "\x00" in self.command:
            return [part for part in self.command.split("\x00") if part]
        return shlex.split(self.command)

    async def start(self, open_process: OpenProcess) -> None:
        argv = self._argv()
        if not argv:
            raise RuntimeError("Empty LSP command")
        display = " ".join(argv)
        shell = build_launch_shell(argv, self.root_path)
        try:
            handle = await open_process(shell, encoding=None)
            self.handle = handle
            self.command = display
            self.status = "ready"
            self._reader_task = asyncio.create_task(
                self._read_loop(),
                name=f"lsp-read-{self.session_id}",
            )
            self._stderr_task = asyncio.create_task(
                self._stderr_loop(),
                name=f"lsp-err-{self.session_id}",
            )
            print(
                f"[lsp:{self.language}] process started "
                f"session={self.session_id} cmd={display}",
                file=sys.stderr,
            )
        except Exception as error:  # noqa: BLE001
            self.status = "error"
            self.error = str(error)
            self.command = display
            print(f"[lsp:{self.language}] failed to start: {error}", file=sys.stderr)
            raise

    async def _read_loop(self) -> None:
        process = getattr(self.handle, "process", None)
        if process is None:
            return
        stdout = process.stdout
        try:
            while True:
                chunk = await stdout.read(65536)
                if not chunk:
                    break
                if isinstance(chunk, str):
                    chunk = chunk.encode("utf-8", errors="replace")
                try:
                    messages = self._decoder.feed(chunk)
                except ValueError as error:
                    preview = chunk[:120] if isinstance(chunk, (bytes, str)) else b""
                    print(
                        f"[LSP] framing error session={self.session_id}: {error} preview={preview!r}",
                        file=sys.stderr,
                    )
                    self._decoder = LspFrameDecoder()
                    continue
                for message in messages:
                    print(
                        f"[LSP] from {self.language} id={message.get('id')} method={message.get('method')}",
                        file=sys.stderr,
                    )
                    response_id = message.get("id")
                    pending = (
                        self._pending_requests.pop(response_id, None)
                        if isinstance(response_id, int)
                        else None
                    )
                    if pending is not None:
                        if "error" in message:
                            pending.set_exception(RuntimeError(str(message.get("error"))))
                        else:
                            pending.set_result(message.get("result"))
                        continue
                    await self._broadcast({"type": "rpc", "message": message})
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            print(f"[LSP] read loop error session={self.session_id}: {error}", file=sys.stderr)
        finally:
            exit_status = getattr(process, "exit_status", None)
            print(
                f"[lsp:{self.language}] stdout closed session={self.session_id} exit={exit_status}",
                file=sys.stderr,
            )
            if self.status != "error":
                self.status = "exited"
                if exit_status not in (None, 0):
                    self.error = f"{self.language} language server exited with status {exit_status}"
            await self._broadcast({"type": "status", "status": self.status, "detail": self.error})

    async def _stderr_loop(self) -> None:
        process = getattr(self.handle, "process", None)
        stderr = getattr(process, "stderr", None) if process is not None else None
        if stderr is None:
            return
        try:
            while True:
                chunk = await stderr.read(4096)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="replace") if isinstance(chunk, bytes) else str(chunk)
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped:
                        print(f"[lsp:{self.language}] {stripped}", file=sys.stderr)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            print(
                f"[lsp:{self.language}] stderr loop error "
                f"session={self.session_id}: {error}",
                file=sys.stderr,
            )

    async def write_rpc(self, message: dict[str, Any]) -> None:
        self.touch()
        process = getattr(self.handle, "process", None)
        if process is None or self.status not in ("ready", "starting"):
            raise RuntimeError("LSP session is not running")
        frame = encode_lsp_message(message)
        print(
            f"[LSP] to {self.language} id={message.get('id')} method={message.get('method')}",
            file=sys.stderr,
        )
        stdin = process.stdin
        async with self._lock:
            try:
                stdin.write(frame)
            except TypeError:
                stdin.write(frame.decode("utf-8"))
            if hasattr(stdin, "drain"):
                await stdin.drain()

    async def request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float = 2.0,
    ) -> Any:
        loop = asyncio.get_running_loop()
        self._request_sequence += 1
        request_id = 1_000_000_000 + self._request_sequence
        future: asyncio.Future[Any] = loop.create_future()
        self._pending_requests[request_id] = future
        try:
            await self.write_rpc(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
            )
            return await asyncio.wait_for(future, timeout=max(0.1, timeout))
        finally:
            self._pending_requests.pop(request_id, None)

    async def attach_client(self, websocket: Any) -> None:
        self._clients.add(websocket)
        self.touch()
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "status", "status": self.status, "detail": self.error})

    def detach_client(self, websocket: Any) -> None:
        self._clients.discard(websocket)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[Any] = []
        for client in list(self._clients):
            try:
                await client.send_json(payload)
            except Exception:  # noqa: BLE001
                dead.append(client)
        for client in dead:
            self._clients.discard(client)

    async def close(self) -> None:
        for future in self._pending_requests.values():
            if not future.done():
                future.cancel()
        self._pending_requests.clear()
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._reader_task = None
        self._stderr_task = None

        process = getattr(self.handle, "process", None)
        if process is not None:
            with contextlib.suppress(Exception):
                if hasattr(process, "terminate"):
                    process.terminate()
            with contextlib.suppress(Exception):
                if hasattr(process, "close"):
                    process.close()
            with contextlib.suppress(Exception):
                if hasattr(process, "wait_closed"):
                    await process.wait_closed()

        owned = getattr(self.handle, "owned_connection", None)
        if owned is not None:
            with contextlib.suppress(Exception):
                owned.close()
                await owned.wait_closed()

        self.handle = None
        if self.status not in ("error", "exited"):
            self.status = "exited"
        await self._broadcast({"type": "status", "status": self.status, "detail": self.error})
        self._clients.clear()


def new_session_id() -> str:
    return f"lsp_{secrets.token_hex(8)}"
