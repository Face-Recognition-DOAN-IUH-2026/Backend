from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routers import borrow
from src.config import settings

logger = logging.getLogger("borrow-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from src.infra.database import init_db
    from src.lib.http_client import get_http_client
    await init_db()
    get_http_client()
    logger.info("Borrow service started (db=connected, http=ready)")
    yield
    from src.infra.database import close_db
    from src.lib.http_client import close_http_client
    await close_db()
    await close_http_client()
    logger.info("Borrow service shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Borrow Service",
        version="0.1.0",
        description="Book borrow/return microservice",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(borrow.router)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": settings.service_name}

    @app.get("/ready")
    async def ready():
        from src.infra.database import Base
        db_ok = False
        try:
            from src.infra.database import engine
            from sqlalchemy import text
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception as e:
            logger.error("Health check DB failed: %s", e)
        status_str = "ok" if db_ok else "degraded"
        return {"status": status_str, "service": settings.service_name, "db_ok": db_ok}

    return app