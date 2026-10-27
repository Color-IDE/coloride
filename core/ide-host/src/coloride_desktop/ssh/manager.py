from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import inspect
import re
import shlex
import sys
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

import asyncssh
import httpx

from ..term.shell_integration import remote_install_command, remote_shell_command


class ConnectionState(StrEnum):
    IDLE = "idle"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DEGRADED = "degraded"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


@dataclass(slots=True)
class ConnectionSnapshot:
    state: ConnectionState
    profile_id: str | None
    rtt_ms: int
    cert_expires_at: datetime


@dataclass(slots=True)
class ConnectionCredentials:
    host: str
    port: int
    username: str
    password: str | None = None
    private_key: str | None = None
    private_key_passphrase: str | None = None
    certificate: str | None = None
    trusted_host_key: str | None = None
    host_ca_key: str | None = None


@dataclass(slots=True)
class ControlPtyHandle:
    process: Any
    owned_connection: asyncssh.SSHClientConnection | None = None


def _as_text(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value


class AsyncSSHConnectionManager:
    """Owns the single SSH connection and channel helpers."""

    def __init__(self) -> None:
        self._snapshot = ConnectionSnapshot(
            state=ConnectionState.IDLE,
            profile_id=None,
            rtt_ms=0,
            cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
        )
        self._conn: asyncssh.SSHClientConnection | None = None
        self._connected_at: datetime | None = None
        self._publish: Callable[[str, dict[str, object]], Awaitable[None]] | None = None
        self._stats_task: asyncio.Task[None] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._sftp: asyncssh.SFTPClient | None = None
        self._last_rx = 0
        self._last_tx = 0
        self._last_net_ts = 0.0
        self._last_disk_read = 0
        self._last_disk_write = 0
        self._last_disk_ts = 0.0
        self._last_creds: ConnectionCredentials | None = None
        self._last_profile_id: str | None = None
        self._serverd_base_url: str | None = None
        self._http: httpx.AsyncClient | None = None
        self._connect_lock = asyncio.Lock()
        # A number of VPS providers temporarily reject simultaneous PTY channel
        # opens, even though they allow the same terminals one after another.
        # The lock covers *only* setup; long-running terminal traffic remains
        # fully independent once the channel has been created.
        self._terminal_open_lock = asyncio.Lock()
        # Extra SSH session for an approved admin-user switch. The visible
        # desktop connection stays on the restricted account so the UI does
        # not bounce to Welcome while files/terminal/agent run as root.
        self._elevated_conn: asyncssh.SSHClientConnection | None = None
        self._elevated_username: str | None = None
        self._elevated_creds: ConnectionCredentials | None = None
        self._sftp_conn: asyncssh.SSHClientConnection | None = None
        # Local SOCKS5 listener that tunnels browser traffic through the VPS SSH hop.
        self._socks_listener: asyncssh.SSHListener | None = None
        self._socks_port: int | None = None
        self._shell_integration_connection: asyncssh.SSHClientConnection | None = None

    @property
    def snapshot(self) -> ConnectionSnapshot:
        return self._snapshot

    @property
    def connection(self) -> asyncssh.SSHClientConnection | None:
        return self._conn

    @property
    def command_connection(self) -> asyncssh.SSHClientConnection | None:
        """Connection used for files, terminals, LSP, and agent commands.

        When Computer / a system path is open this is the extra root session.
        The connection monitor stays on `_conn` so the UI does not bounce.
        """
        elevated = self._elevated_conn
        if elevated is not None and not elevated.is_closed():
            return elevated
        return self._conn

    def session_credentials(self) -> ConnectionCredentials | None:
        elevated = self._elevated_conn
        if (
            elevated is not None
            and not elevated.is_closed()
            and self._elevated_creds is not None
        ):
            return self._elevated_creds
        return self._last_creds

    @property
    def socks_port(self) -> int | None:
        """Local SOCKS5 port for routing desktop Chromium through the VPS, or None."""
        if self._conn is None or self._conn.is_closed():
            return None
        return self._socks_port

    def set_event_publisher(self, publish: Callable[[str, dict[str, object]], Awaitable[None]]) -> None:
        self._publish = publish

    def set_serverd_base_url(self, base_url: str | None) -> None:
        self._serverd_base_url = base_url.rstrip("/") if base_url else None
        if self._serverd_base_url and self._http is None:
            self._http = httpx.AsyncClient(timeout=5.0)

    def _connection_kwargs(self, creds: ConnectionCredentials) -> dict[str, Any]:
        if creds.host_ca_key:
            host_ca = asyncssh.import_public_key(creds.host_ca_key)
            known_hosts: object = ([], [host_ca], [])
        elif creds.trusted_host_key:
            host_key = asyncssh.import_public_key(creds.trusted_host_key)
            known_hosts = ([host_key], [], [])
        else:
            raise RuntimeError("SSH host identity has not been trusted")

        connect_kwargs: dict[str, Any] = {
            "host": creds.host,
            "port": creds.port,
            "username": creds.username,
            "known_hosts": known_hosts,
            "connect_timeout": 10,
            "keepalive_interval": 15,
            "keepalive_count_max": 3,
        }
        if creds.private_key:
            try:
                private_key = asyncssh.import_private_key(
                    creds.private_key,
                    passphrase=creds.private_key_passphrase or None,
                )
                if creds.certificate:
                    certificate = asyncssh.import_certificate(creds.certificate)
                    connect_kwargs["client_keys"] = [(private_key, certificate)]
                else:
                    connect_kwargs["client_keys"] = [private_key]
            except Exception as exc:
                raise RuntimeError(f"Failed to load SSH private key or certificate: {exc}") from exc
        elif creds.password:
            connect_kwargs["password"] = creds.password
        return connect_kwargs

    @contextlib.asynccontextmanager
    async def temporary_connection(
        self,
        creds: ConnectionCredentials,
    ) -> AsyncIterator[asyncssh.SSHClientConnection]:
        """Open a short-lived SSH channel without replacing the active user session."""
        conn = await asyncssh.connect(**self._connection_kwargs(creds))
        try:
            yield conn
        finally:
            conn.close()
            with contextlib.suppress(Exception):
                await conn.wait_closed()

    async def connect(
        self,
        profile_id: str,
        creds: ConnectionCredentials,
        *,
        force: bool = False,
    ) -> ConnectionSnapshot:
        async with self._connect_lock:
            if (
                not force
                and self._snapshot.state == ConnectionState.CONNECTED
                and self._snapshot.profile_id == profile_id
                and self._conn is not None
                and not self._conn.is_closed()
            ):
                return self._snapshot
            return await self._connect_locked(profile_id, creds)

    async def _connect_locked(
        self,
        profile_id: str,
        creds: ConnectionCredentials,
    ) -> ConnectionSnapshot:
        if not creds.host:
            raise RuntimeError("Profile has no host configured")

        await self.close_elevated_connection()
        await self._close_connection_only()
        self._snapshot = ConnectionSnapshot(
            state=ConnectionState.CONNECTING,
            profile_id=profile_id,
            rtt_ms=0,
            cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
        )

        connect_kwargs = self._connection_kwargs(creds)

        try:
            self._conn = await asyncssh.connect(**connect_kwargs)
            self._connected_at = datetime.now(UTC)
            self._last_rx = 0
            self._last_tx = 0
            self._last_net_ts = 0.0
            self._last_disk_read = 0
            self._last_disk_write = 0
            self._last_disk_ts = 0.0

            rtt = await self._measure_rtt()
            await self._start_socks_proxy()
            self._snapshot = ConnectionSnapshot(
                state=ConnectionState.CONNECTED,
                profile_id=profile_id,
                rtt_ms=rtt,
                cert_expires_at=self._connected_at + timedelta(hours=24),
            )
            self._last_rx, self._last_tx = await self._get_net_bytes()
            self._last_net_ts = time.monotonic()
            self._last_profile_id = profile_id
            self._last_creds = creds

            if self._stats_task is None or self._stats_task.done():
                self._stats_task = asyncio.create_task(self._stats_loop())

            current_task = asyncio.current_task()
            if (
                self._monitor_task
                and self._monitor_task is not current_task
                and not self._monitor_task.done()
            ):
                self._monitor_task.cancel()
            self._monitor_task = asyncio.create_task(self._connection_monitor(profile_id))

            print(
                f"[CONN] connected profile={profile_id} rtt={rtt}ms socks={self._socks_port}",
                file=sys.stderr,
            )
            return self._snapshot
        except Exception as exc:
            await self._stop_socks_proxy()
            self._conn = None
            self._connected_at = None
            self._snapshot = ConnectionSnapshot(
                state=ConnectionState.FAILED,
                profile_id=profile_id,
                rtt_ms=0,
                cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
            )
            await self._publish_state("failed", profile_id)
            print(f"[CONN] failed profile={profile_id} error={exc}", file=sys.stderr)
            raise

    async def disconnect(self) -> None:
        current_task = asyncio.current_task()
        if self._monitor_task and self._monitor_task is not current_task:
            self._monitor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._monitor_task
        self._monitor_task = None

        if self._stats_task:
            self._stats_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stats_task
        self._stats_task = None

        await self._close_sftp()

        await self._stop_socks_proxy()
        await self.close_elevated_connection()
        await self._close_connection_only()

        if self._http is not None:
            with contextlib.suppress(Exception):
                await self._http.aclose()
            self._http = None

        self._connected_at = None
        self._last_rx = 0
        self._last_tx = 0
        self._last_net_ts = 0.0
        self._last_disk_read = 0
        self._last_disk_write = 0
        self._last_disk_ts = 0.0
        self._serverd_base_url = None
        self._snapshot = ConnectionSnapshot(
            state=ConnectionState.IDLE,
            profile_id=None,
            rtt_ms=0,
            cert_expires_at=self._snapshot.cert_expires_at,
        )

    async def open_elevated_connection(self, creds: ConnectionCredentials) -> str:
        """Open or reuse a second SSH session as the bootstrap/admin user."""
        current = self._elevated_conn
        if (
            current is not None
            and not current.is_closed()
            and self._elevated_username == creds.username
        ):
            self._elevated_creds = creds
            return creds.username
        await self.close_elevated_connection()
        self._elevated_conn = await asyncssh.connect(**self._connection_kwargs(creds))
        self._elevated_username = creds.username
        self._elevated_creds = creds
        self._shell_integration_connection = None
        await self._close_sftp()
        return creds.username

    async def close_elevated_connection(self) -> None:
        conn = self._elevated_conn
        self._elevated_conn = None
        self._elevated_username = None
        self._elevated_creds = None
        self._shell_integration_connection = None
        await self._close_sftp()
        if conn is None:
            return
        with contextlib.suppress(Exception):
            conn.close()
            await conn.wait_closed()

    async def _close_sftp(self) -> None:
        client = self._sftp
        self._sftp = None
        self._sftp_conn = None
        if client is None:
            return
        with contextlib.suppress(Exception):
            close = getattr(client, "close", None)
            if close is None:
                return
            result = close()
            if inspect.isawaitable(result):
                await result

    async def _close_connection_only(self) -> None:
        await self._stop_socks_proxy()
        if self._conn is not None:
            with contextlib.suppress(Exception):
                self._conn.close()
                await self._conn.wait_closed()
            self._conn = None

    async def _start_socks_proxy(self) -> None:
        """Bind a local SOCKS5 proxy that tunnels through the active SSH connection.

        Electron WebContentsView routes ALL embed traffic here (including
        localhost / 127.0.0.1). SOCKS CONNECT to 127.0.0.1 is resolved on the
        VPS, so any http://localhost:<port> in the embedded browser is whatever
        process is listening on the remote machine (any language/framework) —
        never the Mac loopback. Not limited to React/Next or the agent panel.
        """
        await self._stop_socks_proxy()
        conn = self._conn
        if conn is None or conn.is_closed():
            return

        last_error: Exception | None = None
        # Prefer an ephemeral port (0); retry a few times if the bind races.
        for _ in range(5):
            try:
                listener = await conn.forward_socks("127.0.0.1", 0)
                # asyncssh exposes the chosen port on the listener / get_port().
                port = getattr(listener, "get_port", None)
                socks_port = int(port()) if callable(port) else int(getattr(listener, "port", 0) or 0)
                if socks_port <= 0:
                    # Fall back to inspecting the underlying sockets.
                    sockets = getattr(listener, "get_addresses", None)
                    if callable(sockets):
                        addrs = sockets()
                        if addrs:
                            socks_port = int(addrs[0][1])
                    elif hasattr(listener, "_port"):
                        socks_port = int(listener._port)  # noqa: SLF001
                if socks_port <= 0:
                    with contextlib.suppress(Exception):
                        listener.close()
                    raise RuntimeError("SOCKS listener did not report a local port")
                self._socks_listener = listener
                self._socks_port = socks_port
                print(f"[CONN] SOCKS5 proxy listening on 127.0.0.1:{socks_port}", file=sys.stderr)
                return
            except Exception as exc:
                last_error = exc
                await asyncio.sleep(0.05)

        # Non-fatal: browser embed will surface a clear error; SSH itself still works.
        self._socks_listener = None
        self._socks_port = None
        print(f"[CONN] SOCKS proxy unavailable: {last_error}", file=sys.stderr)

    async def _stop_socks_proxy(self) -> None:
        listener = self._socks_listener
        self._socks_listener = None
        self._socks_port = None
        if listener is None:
            return
        with contextlib.suppress(Exception):
            close = getattr(listener, "close", None)
            if close is not None:
                result = close()
                if inspect.isawaitable(result):
                    await result
        with contextlib.suppress(Exception):
            wait_closed = getattr(listener, "wait_closed", None)
            if wait_closed is not None:
                result = wait_closed()
                if inspect.isawaitable(result):
                    await result

    async def _publish_state(self, state: str, profile_id: str | None) -> None:
        if self._publish:
            with contextlib.suppress(Exception):
                await self._publish("conn:state", {"state": state, "profileId": profile_id})

    async def _measure_rtt(self) -> int:
        if self._conn is None:
            return 0
        start = time.monotonic()
        try:
            await self._conn.run("echo pong", check=True)
            return max(1, int((time.monotonic() - start) * 1000))
        except Exception:
            return 0

    async def _get_net_bytes(
        self,
        connection: asyncssh.SSHClientConnection | None = None,
    ) -> tuple[int, int]:
        conn = connection or self._conn
        if conn is None:
            return 0, 0
        try:
            result = await conn.run("cat /proc/net/dev", check=False)
            for line in _as_text(result.stdout).splitlines()[2:]:
                if ":" not in line:
                    continue
                name, rest = line.split(":", 1)
                if name.strip() == "lo":
                    continue
                values = rest.split()
                return int(values[0]), int(values[8])
        except Exception:
            pass
        return 0, 0

    async def _get_cpu_percent(
        self,
        connection: asyncssh.SSHClientConnection | None = None,
    ) -> float:
        conn = connection or self._conn
        if conn is None:
            return 0.0
        try:
            first = await conn.run("cat /proc/stat", check=False)
            line1 = next(
                (line for line in _as_text(first.stdout).splitlines() if line.startswith("cpu ")), ""
            )
            if not line1:
                return 0.0
            parts1 = [int(value) for value in line1.split()[1:]]
            total1 = sum(parts1)
            idle1 = parts1[3] if len(parts1) > 3 else 0

            await asyncio.sleep(0.25)

            second = await conn.run("cat /proc/stat", check=False)
            line2 = next(
                (line for line in _as_text(second.stdout).splitlines() if line.startswith("cpu ")), ""
            )
            parts2 = [int(value) for value in line2.split()[1:]]
            total2 = sum(parts2)
            idle2 = parts2[3] if len(parts2) > 3 else 0

            total_delta = total2 - total1
            if total_delta <= 0:
                return 0.0
            usage = (total_delta - (idle2 - idle1)) / total_delta * 100
            return round(usage, 1)
        except Exception:
            return 0.0

    async def _stats_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(5)
                if self._snapshot.state != ConnectionState.CONNECTED:
                    break
                # RTT measured at connect time quickly becomes stale (especially on
                # mobile/Wi-Fi). Refresh it with the same lightweight SSH round-trip
                # that established the initial value so status-bar signal changes live.
                rtt = await self._measure_rtt()
                if rtt > 0 and self._snapshot.state == ConnectionState.CONNECTED:
                    self._snapshot.rtt_ms = rtt
                stats = await self.get_stats()
                if self._publish:
                    await self._publish("conn:stats", stats)
            except asyncio.CancelledError:
                break
            except Exception:
                pass

    async def _connection_monitor(self, profile_id: str) -> None:
        closed_detected = False
        while True:
            await asyncio.sleep(3)
            conn = self._conn
            if conn is None:
                break
            if conn.is_closed():
                closed_detected = True
                self._sftp = None
                self._sftp_conn = None
                self._snapshot = ConnectionSnapshot(
                    state=ConnectionState.DEGRADED,
                    profile_id=profile_id,
                    rtt_ms=self._snapshot.rtt_ms,
                    cert_expires_at=self._snapshot.cert_expires_at,
                )
                await self._publish_state("degraded", profile_id)
                print(f"[CONN] detected closed connection for profile={profile_id}", file=sys.stderr)
                break
        if closed_detected:
            await self._try_reconnect_once(profile_id)

    async def _try_reconnect_once(self, profile_id: str) -> None:
        if not self._last_creds or self._last_profile_id != profile_id:
            self._snapshot = ConnectionSnapshot(
                state=ConnectionState.FAILED,
                profile_id=profile_id,
                rtt_ms=0,
                cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
            )
            await self._publish_state("failed", profile_id)
            print(f"[CONN] cannot reconnect profile={profile_id} (no saved creds)", file=sys.stderr)
            return

        self._snapshot = ConnectionSnapshot(
            state=ConnectionState.RECONNECTING,
            profile_id=profile_id,
            rtt_ms=0,
            cert_expires_at=self._snapshot.cert_expires_at,
        )
        await self._publish_state("reconnecting", profile_id)
        await asyncio.sleep(0.5)

        try:
            await self.connect(profile_id, self._last_creds)
            print(f"[CONN] auto-reconnect succeeded profile={profile_id}", file=sys.stderr)
        except Exception as exc:
            self._conn = None
            self._connected_at = None
            self._snapshot = ConnectionSnapshot(
                state=ConnectionState.FAILED,
                profile_id=profile_id,
                rtt_ms=0,
                cert_expires_at=datetime.now(UTC) + timedelta(hours=24),
            )
            await self._publish_state("failed", profile_id)
            print(f"[CONN] auto-reconnect failed profile={profile_id} error={exc}", file=sys.stderr)

    async def reconnect(self) -> ConnectionSnapshot:
        if not self._last_creds or not self._last_profile_id:
            raise RuntimeError("No saved connection is available to reconnect")
        self._snapshot = ConnectionSnapshot(
            state=ConnectionState.RECONNECTING,
            profile_id=self._last_profile_id,
            rtt_ms=0,
            cert_expires_at=self._snapshot.cert_expires_at,
        )
        await self._publish_state("reconnecting", self._last_profile_id)
        return await self.connect(self._last_profile_id, self._last_creds, force=True)

    def _require_connection(self) -> asyncssh.SSHClientConnection:
        conn = self.command_connection
        if conn is None or self._snapshot.state != ConnectionState.CONNECTED:
            raise RuntimeError("Connection not open")
        return conn

    async def get_dashboard(self) -> dict[str, object]:
        conn = self._require_connection()
        stats = await self.get_stats()

        memory_result = await conn.run(
            "awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} /SwapTotal:/{st=$2} /SwapFree:/{sf=$2} END {printf \"%s %s %s %s\", t*1024, a*1024, st*1024, sf*1024}' /proc/meminfo",
            check=False,
        )
        disk_result = await conn.run("df -B1 -P / | tail -1 | awk '{print $2, $3}'", check=False)
        process_result = await conn.run(
            "ps -eo pid=,comm=,%cpu=,rss= --sort=-%cpu | head -n 12", check=False
        )
        service_result = await conn.run(
            "systemctl list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null | head -n 20",
            check=False,
        )
        port_result = await conn.run("ss -ltnH 2>/dev/null | head -n 40", check=False)
        logs_result = await conn.run(
            "journalctl -n 80 --no-pager -o short-iso 2>/dev/null || tail -n 80 /var/log/syslog 2>/dev/null || tail -n 80 /var/log/messages 2>/dev/null",
            check=False,
        )

        memory_values = _ints(_as_text(memory_result.stdout), 4)
        memory_total = memory_values[0] if memory_values else 0
        memory_available = memory_values[1] if len(memory_values) > 1 else 0
        memory_used = max(0, memory_total - memory_available)
        swap_total = memory_values[2] if len(memory_values) > 2 else 0
        swap_free = memory_values[3] if len(memory_values) > 3 else 0
        swap_used = max(0, swap_total - swap_free)

        disk_values = _ints(_as_text(disk_result.stdout), 2)
        disk_total = disk_values[0] if disk_values else 0
        disk_used = disk_values[1] if len(disk_values) > 1 else 0

        load_values = _floats(await self._run_text("cat /proc/loadavg | awk '{print $1, $2, $3}'"), 3)
        disk_read_bps, disk_write_bps = await self._get_disk_io_bps()
        server = stats.get("server") if isinstance(stats.get("server"), dict) else {}
        return {
            "capturedAt": datetime.now(UTC).isoformat(),
            "cpuPct": float(server.get("cpu", 0.0)),
            "load1m": load_values[0] if load_values else 0.0,
            "load5m": load_values[1] if len(load_values) > 1 else 0.0,
            "load15m": load_values[2] if len(load_values) > 2 else 0.0,
            "memory": {
                "usedBytes": memory_used,
                "totalBytes": memory_total,
                "pct": round(memory_used * 100 / memory_total, 1) if memory_total else 0.0,
            },
            "swap": {
                "usedBytes": swap_used,
                "totalBytes": swap_total,
                "pct": round(swap_used * 100 / swap_total, 1) if swap_total else 0.0,
            },
            "disk": {
                "usedBytes": disk_used,
                "totalBytes": disk_total,
                "pct": round(disk_used * 100 / disk_total, 1) if disk_total else 0.0,
            },
            "upBps": int(stats.get("upBps", 0)),
            "downBps": int(stats.get("downBps", 0)),
            "diskReadBps": disk_read_bps,
            "diskWriteBps": disk_write_bps,
            "processes": _parse_processes(_as_text(process_result.stdout)),
            "services": _parse_services(_as_text(service_result.stdout)),
            "ports": _parse_ports(_as_text(port_result.stdout)),
            "logs": _parse_logs(_as_text(logs_result.stdout)),
        }

    async def _get_disk_io_bps(self) -> tuple[int, int]:
        result = await self._require_connection().run("cat /proc/diskstats", check=False)
        read_bytes = 0
        write_bytes = 0
        for line in _as_text(result.stdout).splitlines():
            fields = line.split()
            if len(fields) < 10 or fields[2].startswith(("loop", "ram", "fd")):
                continue
            try:
                read_bytes += int(fields[5]) * 512
                write_bytes += int(fields[9]) * 512
            except ValueError:
                continue
        now = time.monotonic()
        read_bps = 0
        write_bps = 0
        if self._last_disk_ts > 0 and now > self._last_disk_ts:
            delta = now - self._last_disk_ts
            read_bps = max(0, int((read_bytes - self._last_disk_read) / delta))
            write_bps = max(0, int((write_bytes - self._last_disk_write) / delta))
        self._last_disk_read = read_bytes
        self._last_disk_write = write_bytes
        self._last_disk_ts = now
        return read_bps, write_bps

    async def _run_text(self, command: str) -> str:
        result = await self._require_connection().run(command, check=False)
        return _as_text(result.stdout)

    async def list_authorized_keys(self) -> list[dict[str, str]]:
        content = await self._run_text("cat ~/.ssh/authorized_keys 2>/dev/null || true")
        return _parse_authorized_keys(content)

    async def add_authorized_key(self, public_key: str) -> list[dict[str, str]]:
        line = _validate_public_key(public_key)
        quoted = shlex.quote(line)
        await self._require_connection().run(
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys "
            "&& chmod 600 ~/.ssh/authorized_keys && "
            f"(grep -Fqx -- {quoted} ~/.ssh/authorized_keys || printf '%s\\n' {quoted} >> ~/.ssh/authorized_keys)",
            check=False,
        )
        return await self.list_authorized_keys()

    async def delete_authorized_key(self, key_id: str) -> list[dict[str, str]]:
        if not key_id or len(key_id) > 128:
            raise RuntimeError("Invalid authorized key identifier")
        content = await self._run_text("cat ~/.ssh/authorized_keys 2>/dev/null || true")
        matching = next((item for item in _authorized_key_lines(content) if item[0]["id"] == key_id), None)
        if matching is None:
            raise RuntimeError("Authorized key not found")
        line = shlex.quote(matching[1])
        await self._require_connection().run(
            f"(grep -Fvx -- {line} ~/.ssh/authorized_keys || true) > ~/.ssh/authorized_keys.coloride.tmp "
            "&& chmod 600 ~/.ssh/authorized_keys.coloride.tmp "
            "&& mv ~/.ssh/authorized_keys.coloride.tmp ~/.ssh/authorized_keys",
            check=True,
        )
        return await self.list_authorized_keys()

    async def open_process(self, command: str, *, encoding: str | None = "utf-8") -> ControlPtyHandle:
        """Open a long-running remote process, falling back to a dedicated SSH connection.

        Agent protocols use stdin/stdout for structured messages and must not
        compete with terminals, SFTP and monitoring for the server's channel
        limit.
        """
        conn = self.command_connection
        if conn is None or self._snapshot.state != ConnectionState.CONNECTED:
            raise RuntimeError("No active SSH connection. Call /api/conn/connect first.")
        process_kwargs: dict[str, object] = {"encoding": encoding}
        try:
            process = await conn.create_process(command, **process_kwargs)
            return ControlPtyHandle(process=process)
        except asyncssh.ChannelOpenError as shared_error:
            creds = self.session_credentials()
            if creds is None:
                raise

            dedicated: asyncssh.SSHClientConnection | None = None
            try:
                dedicated = await asyncssh.connect(**self._connection_kwargs(creds))
                process = await dedicated.create_process(command, **process_kwargs)
            except Exception as dedicated_error:
                if dedicated is not None:
                    with contextlib.suppress(Exception):
                        dedicated.close()
                        await dedicated.wait_closed()
                raise RuntimeError(
                    "The SSH server refused an agent channel on both the shared and "
                    f"dedicated connections: {dedicated_error}"
                ) from shared_error

            print(
                "[AGENT] shared SSH channel refused; using a dedicated connection",
                file=sys.stderr,
            )
            return ControlPtyHandle(process=process, owned_connection=dedicated)

    async def open_control_pty(
        self,
        cols: int,
        rows: int,
        *,
        tmux_session: str,
        cwd: str | None = None,
        shell: str = "default",
    ) -> ControlPtyHandle:
        """Open one tmux control channel without racing other PTY startup."""
        async with self._terminal_open_lock:
            return await self._open_control_pty_locked(
                cols,
                rows,
                tmux_session=tmux_session,
                cwd=cwd,
                shell=shell,
            )

    async def _open_control_pty_locked(
        self,
        cols: int,
        rows: int,
        *,
        tmux_session: str,
        cwd: str | None = None,
        shell: str = "default",
    ) -> ControlPtyHandle:
        """Launch tmux in *control mode* (-CC) for a single session.

        Unlike a full-screen tmux attach, this asks tmux to speak its
        control protocol. The caller wraps the returned
        process in a TmuxControlClient, which turns %output lines back into
        raw bytes. This keeps xterm's native scrollback/scrollbar working
        while the session still survives SSH drops on the server.
        """
        conn = self.command_connection
        if conn is None:
            raise RuntimeError("No active SSH connection. Call /api/conn/connect first.")
        safe_session = shlex.quote(tmux_session)
        safe_cwd = cwd if cwd and cwd.startswith("/") and "\0" not in cwd else None
        cwd_flag = f" -c {shlex.quote(safe_cwd)}" if safe_cwd else ""
        # -CC attaches in control mode. new-session -A creates-or-attaches so the
        # same session is reused across reconnects. "exec bash -i" gives a clean,
        # non-login interactive shell (skips Plesk /etc/profile banners).
        # Install once per SSH transport. These files live in Coloride's own
        # private directory and source the user's normal rc before adding hooks.
        if self._shell_integration_connection is not conn:
            try:
                result = await conn.run(remote_install_command(), check=False)
                if result.exit_status == 0:
                    self._shell_integration_connection = conn
                    print("[PTY] shell integration installed", file=sys.stderr)
                else:
                    print("[PTY] shell integration install returned non-zero", file=sys.stderr)
            except Exception as exc:
                # Shell integration is progressive enhancement. A hardened VPS
                # may deny writes under HOME; the terminal itself must still open.
                print(f"[PTY] shell integration unavailable: {exc}", file=sys.stderr)
        shell_command = remote_shell_command(shell)
        command = f"tmux -CC new-session -A -s {safe_session}{cwd_flag} {shlex.quote(f'exec {shell_command}')}"
        process_kwargs = {
            "term_type": "xterm-256color",
            "term_size": (cols, rows),
            "encoding": None,
        }
        try:
            process = await conn.create_process(command, **process_kwargs)
            return ControlPtyHandle(process=process)
        except asyncssh.ChannelOpenError as shared_error:
            # Some SSH servers allow very few concurrent channels per TCP
            # connection. Keep files/metrics on the main connection and give
            # this terminal its own securely verified SSH connection.
            creds = self.session_credentials()
            if creds is None:
                raise

            dedicated: asyncssh.SSHClientConnection | None = None
            try:
                dedicated = await asyncssh.connect(**self._connection_kwargs(creds))
                process = await dedicated.create_process(command, **process_kwargs)
            except Exception as dedicated_error:
                if dedicated is not None:
                    with contextlib.suppress(Exception):
                        dedicated.close()
                        await dedicated.wait_closed()
                raise RuntimeError(
                    "The SSH server refused a terminal channel on both the shared and "
                    f"dedicated connections: {dedicated_error}"
                ) from shared_error

            print(
                "[TMUXCC] shared SSH channel refused; using a dedicated terminal connection",
                file=sys.stderr,
            )
            return ControlPtyHandle(process=process, owned_connection=dedicated)

    def authentication_method(self) -> str:
        credentials = self._last_creds
        if credentials is None:
            return "ssh-agent"
        if credentials.certificate:
            return "certificate"
        if credentials.private_key:
            return "private-key"
        if credentials.password:
            return "password"
        return "ssh-agent"

    async def get_server_info(self) -> dict[str, object]:
        if self._conn is None:
            raise RuntimeError("No active SSH connection. Call /api/conn/connect first.")
        command = (
            "printf '%s\\n' \"$(hostname 2>/dev/null || printf unknown)\"; "
            ". /etc/os-release 2>/dev/null; printf '%s\\n' \"${PRETTY_NAME:-Unknown Linux}\"; "
            "uname -m 2>/dev/null || printf unknown; "
            "uname -r 2>/dev/null || printf unknown; "
            "cut -d. -f1 /proc/uptime 2>/dev/null || printf 0"
        )
        result = await self._conn.run(command, check=False)
        lines = _as_text(result.stdout).splitlines()
        while len(lines) < 5:
            lines.append("unknown")
        try:
            uptime_seconds = max(0, int(lines[4].strip()))
        except ValueError:
            uptime_seconds = 0
        return {
            "hostname": lines[0].strip() or "unknown",
            "operatingSystem": lines[1].strip() or "Unknown Linux",
            "architecture": lines[2].strip() or "unknown",
            "kernel": lines[3].strip() or "unknown",
            "uptimeSeconds": uptime_seconds,
        }

    async def get_sftp(self) -> asyncssh.SFTPClient:
        conn = self.command_connection
        if conn is None:
            raise RuntimeError("No active SSH connection. Call /api/conn/connect first.")

        # Prefer the elevated admin session when the user opened a live folder.
        if self._sftp is not None:
            try:
                stale = self._sftp_conn is not conn or getattr(conn, "is_closed", lambda: False)()
            except Exception:
                stale = True
            if stale:
                await self._close_sftp()

        if self._sftp is not None:
            return self._sftp

        try:
            self._sftp = await conn.start_sftp_client()
            self._sftp_conn = conn
            return self._sftp
        except Exception as exc:
            await self._close_sftp()
            msg = str(exc).lower()
            if "open failed" in msg or "subsystem" in msg or "sftp" in msg:
                raise RuntimeError(
                    "Failed to open SFTP channel. "
                    "SFTP is probably not enabled on your server. "
                    "On the remote run: "
                    "`sudo sed -i 's/#Subsystem sftp/Subsystem sftp/' "
                    "/etc/ssh/sshd_config && sudo systemctl restart sshd` "
                    "(or use 'internal-sftp'). Then reconnect. "
                    f"Details: {exc}"
                ) from exc
            raise RuntimeError(f"Failed to open SFTP channel: {exc}") from exc

    async def get_stats(self) -> dict[str, object]:
        snap = self._snapshot
        cert_ttl = 0
        if snap.state == ConnectionState.CONNECTED and self._connected_at:
            remaining = (self._connected_at + timedelta(hours=24)) - datetime.now(UTC)
            cert_ttl = max(0, int(remaining.total_seconds()))

        up_bps = 0
        down_bps = 0
        server_stats: dict[str, float] = {"cpu": 0.0, "mem_pct": 0.0, "disk_pct": 0.0}
        used_serverd = False

        if self._serverd_base_url and self._http is not None and snap.state == ConnectionState.CONNECTED:
            with contextlib.suppress(Exception):
                response = await self._http.get(f"{self._serverd_base_url}/health")
                if response.status_code == 200:
                    health = response.json()
                    server_stats = {
                        "cpu": float(health.get("cpuPct") or 0.0),
                        "mem_pct": float(health.get("memPct") or 0.0),
                        "disk_pct": float(health.get("diskPct") or 0.0),
                    }
                    used_serverd = True

        conn = self._conn
        if conn is not None and snap.state == ConnectionState.CONNECTED:
            try:
                now = time.monotonic()
                rx, tx = await self._get_net_bytes(conn)
                if self._last_net_ts > 0 and (now - self._last_net_ts) > 0.5:
                    delta = now - self._last_net_ts
                    down_bps = max(0, int((rx - self._last_rx) / delta))
                    up_bps = max(0, int((tx - self._last_tx) / delta))
                self._last_rx = rx
                self._last_tx = tx
                self._last_net_ts = now

                if not used_serverd:
                    cpu = await self._get_cpu_percent(conn)
                    mem_command = (
                        "awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} "
                        'END {printf "%.0f", (t-a)*100/t}\' /proc/meminfo'
                    )
                    mem_res = await conn.run(mem_command, check=False)
                    disk_res = await conn.run(
                        "df -P / | tail -1 | awk '{printf \"%.0f\", ($3/$2)*100 }'",
                        check=False,
                    )
                    mem_pct = _numeric_percent(_as_text(mem_res.stdout))
                    disk_pct = _numeric_percent(_as_text(disk_res.stdout))
                    server_stats = {"cpu": cpu, "mem_pct": mem_pct, "disk_pct": disk_pct}
            except Exception as exc:
                print(f"[STATS] error: {exc}", file=sys.stderr)

        return {
            "rttMs": snap.rtt_ms,
            "upBps": up_bps,
            "downBps": down_bps,
            "certTtlSec": cert_ttl,
            "server": {
                "cpu": server_stats["cpu"],
                "memPct": server_stats["mem_pct"],
                "diskPct": server_stats["disk_pct"],
            },
        }


def _numeric_percent(value: str) -> float:
    stripped = value.strip()
    if stripped and stripped.replace(".", "", 1).isdigit():
        return float(stripped)
    return 0.0


def _ints(value: str, limit: int) -> list[int]:
    parsed: list[int] = []
    for token in value.split():
        try:
            parsed.append(int(token))
        except ValueError:
            continue
        if len(parsed) >= limit:
            break
    return parsed




def _floats(value: str, limit: int) -> list[float]:
    parsed: list[float] = []
    for token in value.split():
        try:
            parsed.append(float(token))
        except ValueError:
            continue
        if len(parsed) >= limit:
            break
    return parsed


def _parse_processes(value: str) -> list[dict[str, object]]:
    processes: list[dict[str, object]] = []
    for line in value.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        try:
            processes.append(
                {
                    "pid": int(fields[0]),
                    "name": fields[1],
                    "cpuPct": float(fields[2]),
                    "memoryBytes": int(fields[3]) * 1024,
                }
            )
        except ValueError:
            continue
    return processes


def _parse_services(value: str) -> list[dict[str, str]]:
    services: list[dict[str, str]] = []
    for line in value.splitlines():
        fields = line.removeprefix("● ").split(maxsplit=4)
        if len(fields) < 4:
            continue
        services.append(
            {
                "name": fields[0].removesuffix(".service"),
                "status": fields[2],
                "description": fields[4] if len(fields) > 4 else "",
            }
        )
    return services


def _parse_ports(value: str) -> list[dict[str, object]]:
    ports: list[dict[str, object]] = []
    seen: set[tuple[int, str]] = set()
    for line in value.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        address = fields[3]
        port_text = address.rsplit(":", 1)[-1]
        try:
            port = int(port_text)
        except ValueError:
            continue
        key = (port, address)
        if key in seen:
            continue
        seen.add(key)
        ports.append({"port": port, "protocol": "tcp", "address": address})
    return ports


def _parse_logs(value: str) -> list[dict[str, str | None]]:
    logs: list[dict[str, str | None]] = []
    iso_entry = re.compile(r"^(?P<timestamp>\d{4}-\d{2}-\d{2}T\S+)\s+(?P<content>.*)$")
    syslog_entry = re.compile(r"^(?P<timestamp>\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(?P<content>.*)$")
    for line in value.splitlines()[-80:]:
        text = line.strip()
        if not text:
            continue
        match = iso_entry.match(text) if len(text) >= 10 and text[4:5] == "-" else syslog_entry.match(text)
        timestamp = match.group("timestamp") if match else None
        content = match.group("content") if match else text
        _, separator, content = content.partition(" ")
        source, separator_after_source, message = content.partition(": ")
        if not separator_after_source:
            source, message = "system", content
        if not separator:
            source, message = "system", text
        lower = message.lower()
        level = "error" if any(word in lower for word in (" error", " failed", " fatal")) else "warning" if " warn" in lower else "info"
        logs.append({"timestamp": timestamp, "source": source or "system", "level": level, "message": message})
    return logs


def _authorized_key_lines(content: str) -> list[tuple[dict[str, str], str]]:
    items: list[tuple[dict[str, str], str]] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        key_index = next(
            (index for index, field in enumerate(fields) if field.startswith(("ssh-", "ecdsa-", "sk-"))),
            None,
        )
        if key_index is None or len(fields) <= key_index + 1:
            continue
        algorithm = fields[key_index]
        encoded = fields[key_index + 1]
        try:
            decoded = base64.b64decode(encoded.encode("ascii"), validate=True)
        except Exception:
            continue
        digest = base64.b64encode(hashlib.sha256(decoded).digest()).decode("ascii").rstrip("=")
        items.append(
            (
                {
                    "id": hashlib.sha256(line.encode("utf-8")).hexdigest()[:24],
                    "algorithm": algorithm,
                    "fingerprint": f"SHA256:{digest}",
                    "comment": " ".join(fields[key_index + 2 :]),
                },
                line,
            )
        )
    return items


def _parse_authorized_keys(content: str) -> list[dict[str, str]]:
    return [item for item, _ in _authorized_key_lines(content)]


def _validate_public_key(value: str) -> str:
    line = value.strip()
    if not line or "\n" in line or "\r" in line:
        raise RuntimeError("Enter one SSH public key per line")
    fields = line.split()
    key_index = next(
        (index for index, field in enumerate(fields) if field.startswith(("ssh-", "ecdsa-", "sk-"))),
        None,
    )
    if key_index is None or len(fields) <= key_index + 1:
        raise RuntimeError("That does not look like a valid SSH public key")
    try:
        base64.b64decode(fields[key_index + 1].encode("ascii"), validate=True)
    except Exception as exc:
        raise RuntimeError("That does not look like a valid SSH public key") from exc
    return line
