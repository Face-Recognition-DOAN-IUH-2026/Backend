from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Set

from pydantic import BaseModel


class SSEEvent(BaseModel):
    event: str
    data: Dict[str, Any]


class SSEManager:
    def __init__(self, queue_max: int = 100, keepalive_seconds: float = 30.0):
        self._clients: Set[asyncio.Queue] = set()
        self._queue_max = queue_max
        self._keepalive_seconds = keepalive_seconds

    def register(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._queue_max)
        self._clients.add(queue)
        return queue

    def unregister(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)

    async def broadcast(self, event: str, data: Dict[str, Any]) -> None:
        payload = SSEEvent(event=event, data=data)

        dead: list[asyncio.Queue] = []
        # Avoid awaiting on each client; push using non-blocking semantics.
        for q in list(self._clients):
            try:
                if q.full():
                    # Drop oldest message to keep latency bounded.
                    try:
                        _ = q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(payload)
            except Exception:
                dead.append(q)

        for q in dead:
            self._clients.discard(q)


    async def event_generator(self):
        queue = self.register()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"event: {event.event}\ndata: {json.dumps(event.data, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self.unregister(queue)


sse_manager = SSEManager()
