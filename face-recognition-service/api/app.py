from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import auth, camera, face, kiosk, ocr, patrons, tasks, users
from infra.config import settings

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")


def _camera_callback_factory():
    import logging
    _logger = logging.getLogger("uvicorn")
    from celery import Celery as _Celery
    _worker = _Celery("face_recognition", broker=settings.celery_broker_url, backend=settings.celery_result_backend or None)

    def _on_frame(camera_id: str, frame):
        import cv2, uuid as _uuid
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
                    _logger.warning("Camera %s queue depth %d > %d, dropping frame", camera_id, depth, settings.camera_max_queue_depth)
                    return
            finally:
                r.close()
        except Exception:
            pass

        _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        object_key = f"camera_frames/{camera_id}/{str(_uuid.uuid4())}.jpg"
        from infra.redis_cache import redis_client as _rc
        _rc.setex(f"temp_frame:{object_key}", 120, buf.tobytes())
        _worker.send_task("process_camera_frame", kwargs={"camera_id": camera_id, "object_key": object_key})
        _logger.info("Camera %s task queued (key=%s)", camera_id, object_key)

    return _on_frame


@asynccontextmanager
async def lifespan(app: FastAPI):
    from infra.cooldown import CooldownService
    from infra.database import Base, engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        from sqlalchemy import text

        await conn.execute(
            text("ALTER TABLE patron_faces ADD COLUMN IF NOT EXISTS angle VARCHAR(20) NOT NULL DEFAULT 'frontal'")
        )

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
                if exit_:
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

    _rabbitmq_stop = None
    try:
        from infra.rabbitmq_consumer import start_rabbitmq_consumer
        _rabbitmq_thread, _rabbitmq_stop = start_rabbitmq_consumer()
    except Exception as e:
        import logging
        logging.getLogger("uvicorn").warning("RabbitMQ consumer not started: %s", e)

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
    if _rabbitmq_stop:
        try:
            _rabbitmq_stop()
        except Exception as e:
            logging.getLogger("uvicorn").error("RabbitMQ consumer stop error: %s", e)
    await engine.dispose()
    cooldown = CooldownService()
    await cooldown.close()


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

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/debug/face-collections")
    async def debug_face_collections():
        from infra.milvus_client import MilvusClient
        from infra.database import async_session_factory
        from infra.models import PatronFaceModel
        from sqlalchemy import select, func as sa_func
        m = MilvusClient(
            host=settings.milvus_host,
            port=settings.milvus_port,
            collection_name=settings.milvus_collection,
            dim=512,
        )
        results = m.client.query(m.collection_name, filter="", output_fields=["user_id"], limit=1000)
        milvus_ids = {r["user_id"] for r in results}
        async with async_session_factory() as db:
            rs = await db.execute(select(PatronFaceModel))
            faces = rs.scalars().all()
        pg_ids = {str(f.patron_id) for f in faces if f.is_active}
        missing = pg_ids - milvus_ids
        orphan = milvus_ids - pg_ids
        return {
            "milvus_count": len(milvus_ids),
            "patron_faces_count": len(pg_ids),
            "milvus_ids": sorted(milvus_ids),
            "pg_ids": sorted(pg_ids),
            "missing_in_milvus": sorted(missing),
            "orphan_in_milvus": sorted(orphan),
        }

    return app
