from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, Callable

import aio_pika

from infra.config import settings

logger = logging.getLogger(__name__)

SSE_EXCHANGE = "access.realtime.fanout"
USER_EXCHANGE = "user.events.fanout"

_running = True


async def _sse_bridge_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Subscribe to access.realtime.fanout and broadcast to SSE clients."""
    from infra.sse_manager import sse_manager

    rabbitmq_url = settings.rabbitmq_url or "amqp://guest:guest@rabbitmq:5672"
    try:
        connection = await aio_pika.connect_robust(rabbitmq_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(SSE_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False)
        queue = await channel.declare_queue("", exclusive=True, auto_delete=True)
        await queue.bind(exchange)
        logger.info("[AMQP SSE] Subscribed to %s", SSE_EXCHANGE)

        async with queue.iterator() as qi:
            async for message in qi:
                if not _running:
                    break
                async with message.process(requeue=False):
                    try:
                        data = json.loads(message.body.decode())
                        logger.info("[AMQP SSE] Received event: %s", data.get("status", "unknown"))
                        future = asyncio.run_coroutine_threadsafe(
                            sse_manager.broadcast("camera_event", data), loop
                        )
                        future.add_done_callback(
                            lambda f: logger.info("SSE broadcast completed")
                            if not f.exception()
                            else logger.error("SSE broadcast failed: %s", f.exception())
                        )
                    except Exception as e:
                        logger.warning("[AMQP SSE] Parse error: %s", e)
    except Exception as e:
        logger.warning("[AMQP SSE] Connection error: %s", e)


async def _user_event_loop() -> None:
    """Subscribe to user.events.fanout and trigger face cleanup on USER_DELETED."""
    rabbitmq_url = settings.rabbitmq_url or "amqp://guest:guest@rabbitmq:5672"
    try:
        connection = await aio_pika.connect_robust(rabbitmq_url)
        channel = await connection.channel()
        exchange = await channel.declare_exchange(USER_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=False)
        queue = await channel.declare_queue("", exclusive=True, auto_delete=True)
        await queue.bind(exchange)
        logger.info("[AMQP User] Subscribed to %s", USER_EXCHANGE)

        async with queue.iterator() as qi:
            async for message in qi:
                if not _running:
                    break
                async with message.process(requeue=False):
                    try:
                        data = json.loads(message.body.decode())
                        if data.get("event") == "USER_DELETED":
                            user_id = data.get("user_id")
                            logger.info("[AMQP User] USER_DELETED for %s, queuing face cleanup", user_id)
                            from worker.tasks import delete_user_task
                            delete_user_task.delay(user_id=user_id)
                    except Exception as e:
                        logger.warning("[AMQP User] Handler error: %s", e)
    except Exception as e:
        logger.warning("[AMQP User] Connection error: %s", e)


def _run_async_in_thread(coro_func: Callable, loop: asyncio.AbstractEventLoop) -> None:
    """Run an async coroutine in a new thread with its own event loop."""
    def _thread_target():
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        try:
            new_loop.run_until_complete(coro_func(loop))
        except Exception as e:
            logger.error("Async thread error: %s", e)
        finally:
            new_loop.close()
    t = threading.Thread(target=_thread_target, daemon=True)
    t.start()


def start_sse_bridge(loop: asyncio.AbstractEventLoop) -> tuple[threading.Thread, Callable]:
    global _running
    _running = True

    def _target():
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        try:
            new_loop.run_until_complete(_sse_bridge_loop(loop))
        except Exception as e:
            logger.error("[AMQP SSE] Thread error: %s", e)
        finally:
            new_loop.close()

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    return t, stop_sse_bridge


def start_user_event_listener(loop: asyncio.AbstractEventLoop) -> tuple[threading.Thread, Callable]:
    global _running
    _running = True

    def _target():
        new_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(new_loop)
        try:
            new_loop.run_until_complete(_user_event_loop())
        except Exception as e:
            logger.error("[AMQP User] Thread error: %s", e)
        finally:
            new_loop.close()

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    return t, stop_sse_bridge


def stop_sse_bridge() -> None:
    global _running
    _running = False
