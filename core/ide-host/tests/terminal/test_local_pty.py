import asyncio
import os
import pty
import tty

import pytest
import uvloop

from coloride_desktop.term.local_pty import LocalPtyIO
from coloride_desktop.term.sessions import TerminalRegistry


@pytest.mark.parametrize("loop_factory", [asyncio.new_event_loop, uvloop.new_event_loop])
def test_close_idle_terminal_keeps_loop_and_other_terminal_alive(loop_factory):
    async def run():
        registry = TerminalRegistry()
        slaves = []
        tasks = []
        try:
            sessions = []
            for _ in range(2):
                master, slave = pty.openpty()
                slaves.append(slave)
                tty.setraw(slave)
                session = registry.create(cols=80, rows=24, local=True)
                session.local_master_fd = master
                session.local_io = LocalPtyIO(master)
                sessions.append(session)
            waiting = asyncio.create_task(sessions[0].local_io.read())
            tasks.append(waiting)
            sessions[0].local_pump = waiting
            await asyncio.sleep(0.01)
            registry.close(sessions[0].term_id)
            await asyncio.gather(waiting, return_exceptions=True)
            assert waiting.cancelled()
            # Another terminal must still exchange bytes after the first closes.
            os.write(slaves[1], b"alive\n")
            assert await asyncio.wait_for(sessions[1].local_io.read(), 1) == b"alive\n"
            await sessions[1].local_io.write(b"input\n")
            assert os.read(slaves[1], 6) == b"input\n"
            await asyncio.wait_for(asyncio.sleep(0), 1)
        finally:
            registry.close_all()
            for slave in slaves:
                os.close(slave)
            await asyncio.gather(*tasks, return_exceptions=True)

    with asyncio.Runner(loop_factory=loop_factory) as runner:
        runner.run(run())


@pytest.mark.parametrize("loop_factory", [asyncio.new_event_loop, uvloop.new_event_loop])
def test_close_terminal_with_backpressured_write(loop_factory):
    async def run():
        master, slave = pty.openpty()
        tty.setraw(slave)
        io = LocalPtyIO(master)
        writer = asyncio.create_task(io.write(b"x" * (2 * 1024 * 1024)))
        try:
            await asyncio.sleep(0.02)
            assert not writer.done()
            io.close()
            await asyncio.gather(writer, return_exceptions=True)
            assert writer.cancelled()
            io.close()  # Idempotent cleanup must not close a reused fd.
            await asyncio.wait_for(asyncio.sleep(0), 1)
        finally:
            io.close()
            os.close(slave)
            await asyncio.gather(writer, return_exceptions=True)

    with asyncio.Runner(loop_factory=loop_factory) as runner:
        runner.run(run())
