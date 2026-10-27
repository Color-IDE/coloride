from __future__ import annotations

import asyncio
import os


class LocalPtyIO:
    """Nonblocking PTY I/O: closing never waits on an executor's read/write."""

    def __init__(self, fd: int) -> None:
        self.fd = fd
        self.loop = asyncio.get_running_loop()
        self.closed = False
        self.waiters: set[asyncio.Future[None]] = set()
        self.write_lock = asyncio.Lock()
        os.set_blocking(fd, False)

    async def _ready(self, *, writing: bool = False) -> None:
        if self.closed:
            raise EOFError("PTY closed")
        future = self.loop.create_future()
        self.waiters.add(future)

        def ready() -> None:
            if not future.done():
                future.set_result(None)

        add = self.loop.add_writer if writing else self.loop.add_reader
        remove = self.loop.remove_writer if writing else self.loop.remove_reader
        try:
            add(self.fd, ready)
            await future
        finally:
            self.waiters.discard(future)
            # close() already removed the watcher. The fd may now be reused.
            if not self.closed:
                remove(self.fd)

    async def read(self, size: int = 4096) -> bytes:
        while not self.closed:
            try:
                return os.read(self.fd, size)
            except BlockingIOError:
                await self._ready()
        return b""

    async def write(self, data: bytes) -> None:
        async with self.write_lock:
            remaining = memoryview(data)
            while remaining:
                if self.closed:
                    raise EOFError("PTY closed")
                try:
                    count = os.write(self.fd, remaining)
                    remaining = remaining[count:]
                except BlockingIOError:
                    await self._ready(writing=True)

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.loop.remove_reader(self.fd)
        self.loop.remove_writer(self.fd)
        for waiter in self.waiters:
            waiter.cancel()
        os.close(self.fd)
