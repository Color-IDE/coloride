"""Local terminal protocol v2: bounded, acknowledged, resumable byte stream."""

from __future__ import annotations

import asyncio
import contextlib
import secrets

import anyio
from fastapi import WebSocket, WebSocketDisconnect

from .sessions import TerminalSession

WINDOW_BYTES = 128 * 1024


async def wait_output_capacity(session: TerminalSession) -> None:
    while session.local_consumers:
        session.local_ack_changed.clear()
        if session.local_output_end - min(session.local_consumers.values()) < WINDOW_BYTES:
            return
        await session.local_ack_changed.wait()


async def serve_local_terminal(websocket: WebSocket, session: TerminalSession, offset: int | None) -> None:
    await websocket.accept()
    consumer = secrets.token_hex(8)
    start = session.local_output_end - len(session.local_output)
    end = session.local_output_end
    reset = offset is None or offset < start or offset > end
    cursor = start if reset else offset
    assert cursor is not None
    acknowledged = cursor
    session.local_consumers[consumer] = cursor
    session.suspended = False
    try:
        await websocket.send_json(
            {
                "type": "replay_start",
                "version": 2,
                "startOffset": cursor,
                "endOffset": end,
                "reset": reset,
                "truncated": reset and start > 0,
            }
        )
    except BaseException:
        session.local_consumers.pop(consumer, None)
        session.local_ack_changed.set()
        session.suspended = not session.local_consumers and not session.local_clients
        raise

    async def output() -> None:
        nonlocal cursor, acknowledged
        replay_done = False
        while True:
            session.local_output_changed.clear()
            session.local_ack_changed.clear()
            if not replay_done and cursor >= end:
                await websocket.send_json({"type": "replay_end", "offset": cursor})
                replay_done = True
            base = session.local_output_end - len(session.local_output)
            if cursor < base:
                # A clear-history action may advance the retained boundary.
                cursor = base
                session.local_consumers[consumer] = cursor
                acknowledged = cursor
                session.local_ack_changed.set()
                await websocket.send_json(
                    {
                        "type": "replay_start",
                        "version": 2,
                        "startOffset": cursor,
                        "endOffset": session.local_output_end,
                        "reset": True,
                        "truncated": True,
                    }
                )
            available = min(
                session.local_output_end - cursor,
                WINDOW_BYTES - (cursor - session.local_consumers[consumer]),
                16384,
            )
            if available > 0:
                data = bytes(session.local_output[cursor - base : cursor - base + available])
                await websocket.send_bytes(data)
                cursor += len(data)
                continue
            if session.exited and cursor == session.local_output_end and acknowledged >= cursor:
                process = session.local_process
                await websocket.send_json({"type": "exit", "code": getattr(process, "returncode", None)})
                await websocket.close(code=4001, reason="terminal exited")
                return
            changed = asyncio.create_task(session.local_output_changed.wait())
            ack = asyncio.create_task(session.local_ack_changed.wait())
            try:
                await asyncio.wait({changed, ack}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                changed.cancel()
                ack.cancel()
                await asyncio.gather(changed, ack, return_exceptions=True)

    async def input() -> None:
        nonlocal acknowledged
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("bytes") is not None:
                if session.local_io is not None and not session.exited:
                    await session.local_io.write(message["bytes"])
            elif message.get("text") is not None:
                import json

                try:
                    control = json.loads(message["text"])
                except (ValueError, TypeError):
                    await websocket.close(code=1008)
                    return
                value = control.get("offset") if isinstance(control, dict) else None
                if (
                    not isinstance(control, dict)
                    or control.get("type") != "ack"
                    or type(value) is not int
                    or not acknowledged <= value <= cursor
                ):
                    await websocket.close(code=1008)
                    return
                acknowledged = value
                session.local_consumers[consumer] = value
                session.local_ack_changed.set()

    tasks = {asyncio.create_task(output()), asyncio.create_task(input())}
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, EOFError, OSError, asyncio.CancelledError):
        pass
    finally:
        # Starlette cancels the connection scope on disconnect. Cleanup must
        # still release producer backpressure and await both child tasks.
        with anyio.CancelScope(shield=True):
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            session.local_consumers.pop(consumer, None)
            session.local_ack_changed.set()
            session.suspended = not session.local_consumers and not session.local_clients
            with contextlib.suppress(Exception):
                await websocket.close()
