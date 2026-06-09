from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any

from infra.config import settings
from infra.sse_manager import sse_manager

logger = logging.getLogger(__name__)

CHANNEL = "camera:events"


def _get_redis():
    import redis as _redis
    return _redis.Redis.from_url(settings.celery_broker_url)

def publish(channel: str, data: dict[str, Any]) -> None:
    try:
        r = _get_redis()
        r.publish(channel, json.dumps(data, default=str))
        r.close()
        logger.info("Published to Redis channel %s: %s", channel, data.get("status", "unknown"))
    except Exception as e:
        logger.error("Redis publish failed: %s - data=%s", e, data)


def _subscribe_loop(channel: str, loop: asyncio.AbstractEventLoop) -> None:
    try:
        r = _get_redis()
        pubsub = r.pubsub()
        pubsub.subscribe(channel)
        logger.info("Redis subscribed to %s", channel)
        for msg in pubsub.listen():
            if msg["type"] != "message":
                continue
            try:
                data = json.loads(msg["data"])
                logger.info("Redis message received on %s: %s", channel, data.get("status", "unknown"))
                future = asyncio.run_coroutine_threadsafe(
                    sse_manager.broadcast("camera_event", data), loop
                )
                future.add_done_callback(
                    lambda f: logger.info("SSE broadcast completed for status=%s", data.get("status"))
                    if not f.exception() else logger.error("SSE broadcast failed: %s", f.exception())
                )
            except Exception as e:
                logger.warning("SSE broadcast error: %s", e)
    except Exception as e:
        logger.warning("Redis subscribe error: %s", e)


def start_sse_bridge(loop: asyncio.AbstractEventLoop) -> threading.Thread:
    t = threading.Thread(target=_subscribe_loop, args=(CHANNEL, loop), daemon=True)
    t.start()
    return t
