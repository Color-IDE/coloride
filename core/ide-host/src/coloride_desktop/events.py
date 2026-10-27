from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from typing import Any

from .models import EventEnvelope

# Large enough for bursty text/reasoning deltas without dropping the subscriber.
# If still full, drop oldest envelopes until the new one fits (never drop the new event
# while the queue still has room after eviction).
_QUEUE_MAXSIZE = 8_000


class EventHub:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[EventEnvelope]] = set()

    async def publish(self, event: str, payload: dict[str, Any]) -> None:
        envelope = EventEnvelope(event=event, payload=payload)
        for queue in list(self._subscribers):
            self._enqueue(queue, envelope)

    def _enqueue(self, queue: asyncio.Queue[EventEnvelope], envelope: EventEnvelope) -> None:
        """Enqueue, evicting oldest events until the new one is accepted."""
        for _ in range(_QUEUE_MAXSIZE + 1):
            try:
                queue.put_nowait(envelope)
                return
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    # Queue emptied under us — retry put.
                    continue
        # Last resort (should not happen): try once more without eviction.
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(envelope)

    async def subscribe(self) -> AsyncIterator[asyncio.Queue[EventEnvelope]]:
        queue: asyncio.Queue[EventEnvelope] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
