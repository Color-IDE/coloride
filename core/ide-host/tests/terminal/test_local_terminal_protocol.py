from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from coloride_desktop.api.app import create_app
from coloride_desktop.config import LaunchConfig
from coloride_desktop.term.local_protocol import WINDOW_BYTES, wait_output_capacity
from coloride_desktop.term.sessions import TerminalRegistry


@pytest.mark.parametrize("shell", ["/bin/zsh", "/bin/bash"])
def test_shell_has_controlling_terminal_and_job_control(shell, tmp_path, monkeypatch):
    if not Path(shell).exists():
        pytest.skip(f"{shell} unavailable")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("SHELL", shell)
    monkeypatch.setenv("COLORIDE_TERMINAL_STATE_DIR", str(tmp_path / "sessions"))
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))
    headers = {"Authorization": "Bearer test-token"}
    with TestClient(app) as client:
        response = client.post(
            "/api/term/create",
            headers=headers,
            json={
                "cols": 80,
                "rows": 24,
                "cwd": str(tmp_path),
                "workspaceKind": "local",
                "sessionId": "test-shell",
            },
        )
        assert response.status_code == 200, response.text
        term_id = response.json()["termId"]
        try:
            with client.websocket_connect(f"/ws/term/{term_id}?token=test-token&protocol=2") as socket:
                start = socket.receive_json()
                assert start["version"] == 2
                offset = start["startOffset"]
                socket.send_bytes(
                    b"printf '\\nTTY_%s\\n' \"$(test -t 0 && echo YES)\"; "
                    b"sh -c 'printf \"RUNNING_%s\\n\" JOB; exec sleep 30'\r"
                )
                output = b""
                interrupted = False
                while True:
                    event = socket.receive()
                    if event.get("bytes"):
                        data = event["bytes"]
                        offset += len(data)
                        socket.send_json({"type": "ack", "offset": offset})
                        output += data
                        if b"RUNNING_JOB" in output and not interrupted:
                            socket.send_bytes(b"\x03")
                            import time

                            time.sleep(0.15)
                            socket.send_bytes(b"printf '\\nAFTER_%s\\n' INTERRUPT\r")
                            interrupted = True
                        if b"AFTER_INTERRUPT" in output:
                            break
                assert b"no job control" not in output
                assert b"can't access tty" not in output
        finally:
            client.post(f"/api/term/{term_id}/close", headers=headers)


def test_slow_consumer_blocks_producer_and_detach_unblocks():
    async def run():
        registry = TerminalRegistry()
        session = registry.create(cols=80, rows=24, local=True)
        session.local_consumers["slow"] = 0
        registry.append_local_output(session, b"x" * WINDOW_BYTES)
        waiting = asyncio.create_task(wait_output_capacity(session))
        await asyncio.sleep(0)
        assert not waiting.done()
        session.local_consumers["slow"] = WINDOW_BYTES
        session.local_ack_changed.set()
        await asyncio.wait_for(waiting, 1)
        registry.append_local_output(session, b"y" * WINDOW_BYTES)
        waiting = asyncio.create_task(wait_output_capacity(session))
        await asyncio.sleep(0)
        assert not waiting.done()
        session.local_consumers.clear()
        session.local_ack_changed.set()
        await asyncio.wait_for(waiting, 1)

    asyncio.run(run())


def test_replay_offsets_survive_history_truncation_and_clear():
    registry = TerminalRegistry()
    session = registry.create(cols=80, rows=24, local=True)
    registry.append_local_output(session, b"x" * (2 * 1024 * 1024 + 10))
    assert session.local_output_end - len(session.local_output) == 10
    registry.clear_local_output(session)
    assert session.local_output_end == 2 * 1024 * 1024 + 10
    registry.append_local_output(session, b"new")
    assert session.local_output_end - len(session.local_output) == 2 * 1024 * 1024 + 10


class MemorySocket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.outgoing = asyncio.Queue()

    async def accept(self):
        pass

    async def send_json(self, value):
        await self.outgoing.put(value)

    async def send_bytes(self, value):
        await self.outgoing.put(value)

    async def receive(self):
        return await self.incoming.get()

    async def close(self, code=1000, reason=""):
        await self.outgoing.put({"type": "closed", "code": code})


async def next_frame(socket):
    return await asyncio.wait_for(socket.outgoing.get(), 1)


def test_resume_sends_only_missing_bytes_and_ack_bounds_are_enforced():
    from coloride_desktop.term.local_protocol import serve_local_terminal

    async def run():
        registry = TerminalRegistry()
        session = registry.create(cols=80, rows=24, local=True)
        registry.append_local_output(session, b"already seen|tail")
        socket = MemorySocket()
        task = asyncio.create_task(serve_local_terminal(socket, session, 13))
        start = await next_frame(socket)
        assert start["reset"] is False
        assert start["startOffset"] == 13
        assert await next_frame(socket) == b"tail"
        assert (await next_frame(socket))["type"] == "replay_end"
        # A client must never ACK bytes the host did not send.
        await socket.incoming.put(
            {"type": "websocket.receive", "text": json.dumps({"type": "ack", "offset": 9999})}
        )
        assert (await next_frame(socket))["code"] == 1008
        await asyncio.wait_for(task, 1)
        assert not session.local_consumers

    asyncio.run(run())


def test_slow_socket_receives_at_most_one_window_without_ack():
    from coloride_desktop.term.local_protocol import serve_local_terminal

    async def run():
        registry = TerminalRegistry()
        session = registry.create(cols=80, rows=24, local=True)
        registry.append_local_output(session, b"x" * (WINDOW_BYTES * 3))
        socket = MemorySocket()
        task = asyncio.create_task(serve_local_terminal(socket, session, 0))
        await next_frame(socket)
        received = b""
        while len(received) < WINDOW_BYTES:
            received += await next_frame(socket)
        await asyncio.sleep(0.01)
        assert socket.outgoing.empty()
        assert len(received) == WINDOW_BYTES
        await socket.incoming.put(
            {"type": "websocket.receive", "text": json.dumps({"type": "ack", "offset": WINDOW_BYTES})}
        )
        assert await next_frame(socket) == b"x" * 16384
        await socket.incoming.put({"type": "websocket.disconnect"})
        await asyncio.wait_for(task, 1)
        assert not session.local_consumers

    asyncio.run(run())


def test_truncated_replay_is_marked_and_failed_handshake_releases_capacity():
    from coloride_desktop.term.local_protocol import serve_local_terminal

    async def run():
        registry = TerminalRegistry()
        session = registry.create(cols=80, rows=24, local=True)
        registry.append_local_output(session, b"x" * (2 * 1024 * 1024 + 100))
        socket = MemorySocket()
        task = asyncio.create_task(serve_local_terminal(socket, session, 0))
        start = await next_frame(socket)
        assert start["reset"] is True
        assert start["truncated"] is True
        assert start["startOffset"] == 100
        await socket.incoming.put({"type": "websocket.disconnect"})
        await asyncio.wait_for(task, 1)

        class BrokenSocket(MemorySocket):
            async def send_json(self, value):
                raise OSError("connection gone during handshake")

        with pytest.raises(OSError):
            await serve_local_terminal(BrokenSocket(), session, 0)
        assert not session.local_consumers
        await asyncio.wait_for(wait_output_capacity(session), 1)

    asyncio.run(run())


def test_simultaneous_attach_starts_only_one_local_shell(tmp_path, monkeypatch):
    import httpx

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("SHELL", "/bin/bash")
    (tmp_path / ".bashrc").write_text(f"printf start >> '{tmp_path}/started'\n")
    app = create_app(LaunchConfig(host="127.0.0.1", port=0, bearer_token="test-token"))

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer test-token"},
        ) as client:
            payload = {
                "cols": 80,
                "rows": 24,
                "cwd": str(tmp_path),
                "workspaceKind": "local",
                "sessionId": "same-session",
            }
            first, second = await asyncio.gather(
                client.post("/api/term/create", json=payload), client.post("/api/term/create", json=payload)
            )
            assert first.json()["termId"] == second.json()["termId"]
            try:
                for _ in range(100):
                    if (tmp_path / "started").exists():
                        break
                    await asyncio.sleep(0.01)
                assert (tmp_path / "started").read_text() == "start"
            finally:
                await client.post(f"/api/term/{first.json()['termId']}/close")

    asyncio.run(run())
