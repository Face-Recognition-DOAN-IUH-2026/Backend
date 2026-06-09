from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Set

from pydantic import BaseModel


class SSEEvent(BaseModel):
    event: str
    data: Dict[str, Any]


class SSEManager:
    def __init__(self):
        self._clients: Set[asyncio.Queue] = set()

    def register(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._clients.add(queue)
        return queue

    def unregister(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)

    async def broadcast(self, event: str, data: Dict[str, Any]) -> None:
        payload = SSEEvent(event=event, data=data)
        dead: list[asyncio.Queue] = []
        for q in self._clients:
            try:
                await q.put(payload)
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
