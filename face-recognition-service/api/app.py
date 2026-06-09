from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import access, auth, camera, face, kiosk, patrons, tasks, users
from infra.config import settings

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")


def _camera_callback_factory():
    """Create a callback that sends camera frames to Celery worker."""
    import logging
    _logger = logging.getLogger("uvicorn")
    from celery import Celery as _Celery
    _worker = _Celery("face_recognition", broker=settings.celery_broker_url, backend=settings.celery_result_backend)

    def _on_frame(camera_id: str, frame):
        import cv2, base64
        _logger.info("Camera %s received frame, queuing Celery task...", camera_id)
        try:
            _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            b64 = base64.b64encode(buf).decode("utf-8")
            _worker.send_task("process_camera_frame", kwargs={"camera_id": camera_id, "image_bytes": b64})
            _logger.info("Camera %s task queued successfully", camera_id)
        except Exception as e:
            _logger.error("Camera %s failed to queue Celery task: %s", camera_id, e)

    return _on_frame


@asynccontextmanager
async def lifespan(app: FastAPI):
    from infra.cooldown import CooldownService
    from infra.database import Base, engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    entry = settings.entry_cam_url
    exit_ = settings.exit_cam_url
    _sse_thread = None
    if entry or exit_:
        try:
            from worker.stream_service import stream_service
            cb = _camera_callback_factory()
            if entry:
                stream_service.register_camera("entry_gate", entry)
                stream_service.set_callback("entry_gate", cb)
            if exit_:
                stream_service.register_camera("exit_gate", exit_)
                stream_service.set_callback("exit_gate", cb)
            stream_service.start_all()
        except Exception as e:
            import logging
            logging.getLogger("uvicorn").error("Camera startup error: %s", e, exc_info=True)

    try:
        import asyncio
        from infra.redis_pubsub import start_sse_bridge
        _sse_thread = start_sse_bridge(asyncio.get_running_loop())
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").warning("SSE bridge not started: %s", e)

    yield

    try:
        if entry or exit_:
            from worker.stream_service import stream_service
            stream_service.stop_all()
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").error("Camera shutdown error: %s", e)
    await engine.dispose()
    cooldown = CooldownService()
    await cooldown.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Face Recognition Platform",
        version="0.1.0",
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
    app.include_router(tasks.router)
    app.include_router(users.router)
    app.include_router(patrons.router)
    app.include_router(access.router)
    app.include_router(camera.router)
    app.include_router(kiosk.router)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app