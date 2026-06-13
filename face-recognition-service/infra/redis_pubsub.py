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

_running = True

_redis_client = None
_redis_lock = threading.Lock()


def _get_redis():
    """Reuse a single Redis client per process to avoid socket churn."""
    global _redis_client
    if _redis_client is None:
        with _redis_lock:
            if _redis_client is None:
                import redis as _redis

                _redis_client = _redis.Redis.from_url(
                    settings.celery_broker_url,
                    decode_responses=True,
                    socket_keepalive=True,
                    socket_timeout=5,
                    retry_on_timeout=True,
                )
    return _redis_client


def publish(channel: str, data: dict[str, Any]) -> None:
    try:
        r = _get_redis()
        r.publish(channel, json.dumps(data, default=str))
    except Exception as e:
        logger.error("Redis publish failed: %s - data=%s", e, data)



def _subscribe_loop(channel: str, loop: asyncio.AbstractEventLoop) -> None:
    global _running
    pubsub = None
    r = None
    try:
        r = _get_redis()
        pubsub = r.pubsub()
        pubsub.subscribe(channel)
        logger.info("Redis subscribed to %s", channel)
        for msg in pubsub.listen():
            if not _running:
                break
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
    finally:
        if pubsub:
            try:
                pubsub.unsubscribe()
                pubsub.close()
            except Exception:
                pass
        _running = False


def start_sse_bridge(loop: asyncio.AbstractEventLoop) -> tuple[threading.Thread, callable]:
    global _running
    _running = True
    t = threading.Thread(target=_subscribe_loop, args=(CHANNEL, loop), daemon=True)
    t.start()
    return t, stop_sse_bridge


def stop_sse_bridge() -> None:
    global _running
    _running = False


USER_CHANNEL = "user.events"

def _user_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _running
    r = _get_redis()
    pubsub = r.pubsub()
    pubsub.subscribe(USER_CHANNEL)
    logger.info("Subscribed to %s", USER_CHANNEL)
    for msg in pubsub.listen():
        if not _running:
            break
        if msg["type"] != "message":
            continue
        try:
            data = json.loads(msg["data"])
            if data.get("event") == "USER_DELETED":
                user_id = data.get("user_id")
                logger.info("USER_DELETED event for %s, queuing face cleanup", user_id)
                from worker.tasks import delete_user_task
                delete_user_task.delay(user_id=user_id)
        except Exception as e:
            logger.warning("User event handler error: %s", e)
    pubsub.unsubscribe()
    pubsub.close()


def start_user_event_listener(loop: asyncio.AbstractEventLoop) -> tuple[threading.Thread, callable]:
    t = threading.Thread(target=_user_event_loop, args=(loop,), daemon=True)
    t.start()
    return t, stop_sse_bridge
