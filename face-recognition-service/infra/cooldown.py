from __future__ import annotations

import redis.asyncio as aioredis

from infra.config import settings


class CooldownService:
    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(
                settings.redis_url, encoding="utf-8", decode_responses=True
            )
        return self._redis

    async def acquire(self, key: str, cooldown_seconds: int = 1) -> bool:
        r = await self._get_redis()
        exists = await r.exists(f"cooldown:{key}")
        if exists:
            return False
        await r.setex(f"cooldown:{key}", cooldown_seconds, "1")
        return True

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.close()
            self._redis = None
