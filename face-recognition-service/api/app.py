from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.dependencies import require_internal_key_or_staff
from api.routers import auth, camera, diagnostics, face, kiosk, ocr, patrons, tasks, users
from infra.config import settings

logger = logging.getLogger(__name__)

CORS_ORIGINS = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]


def _camera_callback_factory():
    import logging

    _logger = logging.getLogger("uvicorn")
    from celery import Celery as _Celery

    _worker = _Celery(
        "face_recognition",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend or settings.redis_url,
    )

    def _on_frame(camera_id: str, frame):
        import uuid as _uuid

        import cv2

        _logger.info("Camera %s received frame, caching to Redis...", camera_id)
        try:
            import redis as _redis
            r = _redis.Redis.from_url(settings.redis_url)
            try:
                queue_key = f"camera_queue:{camera_id}"
                depth = r.incr(queue_key)
                if depth == 1:
                    r.expire(queue_key, 60)
                if depth > settings.camera_max_queue_depth:
                    _logger.warning(
                        "Camera %s queue depth %d > %d, dropping frame",
                        camera_id,
                        depth,
                        settings.camera_max_queue_depth,
                    )
                    r.decr(queue_key)
                    return
            finally:
                r.close()
        except Exception:
            pass

        _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        object_key = f"camera_frames/{camera_id}/{str(_uuid.uuid4())}.jpg"
        from infra.redis_cache import redis_client as _rc

        _rc.setex(f"temp_frame:{object_key}", 120, buf.tobytes())
        _worker.send_task(
            "process_camera_frame",
            kwargs={"camera_id": camera_id, "object_key": object_key},
        )
        _logger.info("Camera %s task queued (key=%s)", camera_id, object_key)

    return _on_frame


@asynccontextmanager
async def lifespan(app: FastAPI):
    from infra.cooldown import CooldownService
    from infra.database import engine

    entry = settings.entry_cam_url
    exit_ = settings.exit_cam_url
    if entry or exit_:
        import threading as _t
        def _start_cameras():
            try:
                from worker.stream_service import stream_service
                cb = _camera_callback_factory()
                if entry:
                    stream_service.register_camera(settings.entry_cam_id, entry)
                    stream_service.set_callback(settings.entry_cam_id, cb)
                if exit_ and exit_ != entry:
                    stream_service.register_camera(settings.exit_cam_id, exit_)
                    stream_service.set_callback(settings.exit_cam_id, cb)
                stream_service.start_all()
            except Exception as e:
                import logging
                logging.getLogger("uvicorn").error("Camera startup error: %s", e, exc_info=True)
        _t.Thread(target=_start_cameras, daemon=True).start()

    _sse_stop = None
    try:
        import asyncio

        from infra.amqp_pubsub import start_sse_bridge
        _sse_thread, _sse_stop = start_sse_bridge(asyncio.get_running_loop())
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").warning("AMQP SSE bridge not started: %s", e)

    _user_stop = None
    try:
        import asyncio

        from infra.amqp_pubsub import start_user_event_listener
        _user_thread, _user_stop = start_user_event_listener(asyncio.get_running_loop())
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").warning("AMQP User event listener not started: %s", e)

    yield

    try:
        from worker.stream_service import stream_service
        stream_service.stop_all()
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").error("Camera shutdown error: %s", e)
    if _sse_stop:
        try:
            _sse_stop()
        except Exception as e:
            logging.getLogger("uvicorn").error("SSE bridge stop error: %s", e)
    if _user_stop:
        try:
            _user_stop()
        except Exception as e:
            logging.getLogger("uvicorn").error("User event listener stop error: %s", e)
    await engine.dispose()
    cooldown = CooldownService()
    await cooldown.close()
    try:
        from infra.http_client import close_http_client
        await close_http_client()
    except Exception as e:
        logging.getLogger("uvicorn").error("HTTP client close error: %s", e)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Face Recognition Platform",
        version="0.2.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(face.router)
    app.include_router(ocr.router)
    app.include_router(tasks.router)
    app.include_router(users.router)
    app.include_router(patrons.router)
    app.include_router(camera.router)
    app.include_router(kiosk.router)
    app.include_router(diagnostics.router)

    @app.get("/internal/face/{user_id}/status")
    async def check_face_enrollment(
        user_id: str,
        _auth: None = Depends(require_internal_key_or_staff),
    ):
        from infra.milvus_client import get_milvus_client
        mc = get_milvus_client()
        try:
            results = mc.client.query(
                mc.collection_name,
                filter=f'user_id == "{user_id}"',
                output_fields=["user_id"],
                limit=1,
            )
            enrolled = len(results) > 0
        except Exception as exc:
            logger.error("Milvus enrollment lookup failed for %s: %s", user_id, exc)
            enrolled = False
        return {"enrolled": enrolled}

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app
