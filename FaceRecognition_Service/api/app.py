from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import auth, face, tasks, users

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from infra.database import engine
    from infra.cooldown import CooldownService
    from infra.database import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield
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

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app