from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx

from src.config import settings

logger = logging.getLogger("borrow-service.http")

_SHARED_CLIENT: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _SHARED_CLIENT
    if _SHARED_CLIENT is None or _SHARED_CLIENT.is_closed:
        _SHARED_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0, pool=30.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=50),
            headers={"X-Internal-Api-Key": settings.internal_api_key} if settings.internal_api_key else {},
        )
    return _SHARED_CLIENT


async def close_http_client():
    global _SHARED_CLIENT
    if _SHARED_CLIENT and not _SHARED_CLIENT.is_closed:
        await _SHARED_CLIENT.aclose()
    _SHARED_CLIENT = None


@dataclass
class CircuitBreakerState:
    failures: int = 0
    last_failure_time: float = 0.0
    is_open: bool = False
    open_until: float = 0.0
    threshold: int = 3
    cooldown_seconds: float = 60.0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def record_failure(self):
        async with self._lock:
            self.failures += 1
            self.last_failure_time = time.time()
            if self.failures >= self.threshold:
                self.is_open = True
                self.open_until = time.time() + self.cooldown_seconds
                logger.warning(
                    "Circuit breaker OPEN for OpenLibrary "
                    "(failures=%d, cooldown=%.0fs)", self.failures, self.cooldown_seconds
                )

    async def record_success(self):
        async with self._lock:
            self.failures = 0
            if self.is_open:
                self.is_open = False
                logger.info("Circuit breaker CLOSED for OpenLibrary (success)")

    async def can_request(self) -> bool:
        async with self._lock:
            if not self.is_open:
                return True
            if time.time() >= self.open_until:
                self.is_open = False
                self.failures = 0
                logger.info("Circuit breaker HALF-OPEN for OpenLibrary (cooldown expired)")
                return True
            return False

    async def reset(self):
        async with self._lock:
            self.failures = 0
            self.is_open = False


openlibrary_circuit = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
user_service_circuit = CircuitBreakerState(threshold=3, cooldown_seconds=30.0)
access_service_circuit = CircuitBreakerState(threshold=3, cooldown_seconds=30.0)
google_books_circuit = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
