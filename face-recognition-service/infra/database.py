from __future__ import annotations

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from infra.config import settings

ASYNC_POSTGRES_URL = settings.postgres_url.replace(
    "postgresql+psycopg://", "postgresql+psycopg_async://"
)

engine = create_async_engine(
    ASYNC_POSTGRES_URL,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_pre_ping=True,
)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass
