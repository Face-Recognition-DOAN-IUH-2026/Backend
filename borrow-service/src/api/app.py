from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routers import borrow
from src.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    from src.infra.database import init_db
    await init_db()
    yield
    from src.infra.database import close_db
    await close_db()


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
        from src.infra.database import engine
        db_ok = False
        try:
            from sqlalchemy import text
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            pass
        return {"status": "ok" if db_ok else "degraded", "service": settings.service_name, "db_ok": db_ok}

    return app