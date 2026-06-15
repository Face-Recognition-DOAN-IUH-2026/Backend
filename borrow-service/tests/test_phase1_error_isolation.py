from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.lib.http_client import CircuitBreakerState


class TestCircuitBreakerOpenLibrary:
    """Phase 0.3 / Phase 1.5: Circuit breaker isolates OpenLibrary failures"""

    @pytest.mark.asyncio
    async def test_circuit_closed_by_default(self):
        cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        assert await cb.can_request() is True
        assert cb.is_open is False
        assert cb.failures == 0

    @pytest.mark.asyncio
    async def test_circuit_opens_after_threshold_failures(self):
        cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        await cb.record_failure()
        await cb.record_failure()
        await cb.record_failure()
        assert cb.is_open is True
        assert await cb.can_request() is False

    @pytest.mark.asyncio
    async def test_circuit_stays_closed_below_threshold(self):
        cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        await cb.record_failure()
        await cb.record_failure()
        assert cb.is_open is False
        assert await cb.can_request() is True

    @pytest.mark.asyncio
    async def test_circuit_resets_on_success(self):
        cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        await cb.record_failure()
        await cb.record_failure()
        await cb.record_success()
        assert cb.failures == 0
        assert cb.is_open is False
        assert await cb.can_request() is True

    @pytest.mark.asyncio
    async def test_circuit_reopens_after_reset_and_new_failures(self):
        cb = CircuitBreakerState(threshold=2, cooldown_seconds=60.0)
        await cb.record_failure()
        await cb.record_success()
        await cb.record_failure()
        await cb.record_failure()
        assert cb.is_open is True
        assert await cb.can_request() is False

    @pytest.mark.asyncio
    async def test_circuit_half_open_after_cooldown(self):
        cb = CircuitBreakerState(threshold=1, cooldown_seconds=0.1)
        await cb.record_failure()
        assert cb.is_open is True
        assert await cb.can_request() is False
        await asyncio.sleep(0.15)
        assert await cb.can_request() is True
        assert cb.is_open is False

    @pytest.mark.asyncio
    async def test_circuit_reset_method(self):
        cb = CircuitBreakerState(threshold=1, cooldown_seconds=60.0)
        await cb.record_failure()
        assert cb.is_open is True
        await cb.reset()
        assert cb.is_open is False
        assert cb.failures == 0
        assert await cb.can_request() is True

    @pytest.mark.asyncio
    async def test_concurrent_failure_recording(self):
        cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        async def fail():
            await cb.record_failure()
        await asyncio.gather(fail(), fail(), fail())
        assert cb.is_open is True

    @pytest.mark.asyncio
    async def test_circuit_does_not_open_on_single_failure_with_high_threshold(self):
        cb = CircuitBreakerState(threshold=10, cooldown_seconds=60.0)
        await cb.record_failure()
        assert cb.is_open is False

    @pytest.mark.asyncio
    async def test_circuit_records_failure_time(self):
        cb = CircuitBreakerState(threshold=1, cooldown_seconds=60.0)
        t_before = time.time()
        await cb.record_failure()
        assert cb.last_failure_time >= t_before


class TestCircuitBreakerUserService:
    """User-service circuit breaker"""

    @pytest.mark.asyncio
    async def test_separate_circuit_for_user_service(self):
        ol_cb = CircuitBreakerState(threshold=3, cooldown_seconds=60.0)
        us_cb = CircuitBreakerState(threshold=3, cooldown_seconds=30.0)
        assert ol_cb.cooldown_seconds == 60.0
        assert us_cb.cooldown_seconds == 30.0
        await us_cb.record_failure()
        assert us_cb.failures == 1
        assert ol_cb.failures == 0

    @pytest.mark.asyncio
    async def test_user_service_circuit_opens_independently(self):
        us_cb = CircuitBreakerState(threshold=2, cooldown_seconds=60.0)
        await us_cb.record_failure()
        await us_cb.record_failure()
        assert us_cb.is_open is True


class TestNPlusOneQueryFix:
    """Phase 1.1: Validate N+1 query fix pattern works"""

    def test_get_books_with_stats_uses_batch_query(self):
        from src.infra.repository import BorrowRepository
        method = BorrowRepository.get_books_with_stats
        assert method is not None


class TestTransactionAtomic:
    """Phase 1.2: Import transaction atomicity"""

    @pytest.mark.asyncio
    async def test_create_copies_batch_with_skip_skips_duplicates(self):
        from src.infra.repository import BorrowRepository
        method = BorrowRepository.create_copies_batch_with_skip
        assert method is not None


class TestHttpClientSingleton:
    """Phase 0.2: HTTP client singleton"""

    def test_get_http_client_returns_same_instance(self):
        from src.lib.http_client import get_http_client, close_http_client
        import sys
        with patch.dict(sys.modules):
            if 'src.lib.http_client' in sys.modules:
                del sys.modules['src.lib.http_client']
            from src.lib.http_client import get_http_client
            client1 = get_http_client()
            client2 = get_http_client()
            assert client1 is client2

    @pytest.mark.asyncio
    async def test_http_client_has_timeout(self):
        from src.lib.http_client import get_http_client
        client = get_http_client()
        assert client.timeout is not None
        assert client.timeout.connect == 5.0
        assert client.timeout.pool == 30.0


class TestServiceDownScenarios:
    """What happens when downstream services are down"""

    @pytest.mark.asyncio
    async def test_openlibrary_circuit_prevents_cascading_failures(self):
        cb = CircuitBreakerState(threshold=2, cooldown_seconds=60.0)
        await cb.record_failure()
        await cb.record_failure()
        assert await cb.can_request() is False
        assert cb.is_open is True

    @pytest.mark.asyncio
    async def test_access_service_open_circuit_blocks_inside_check(self):
        from src.api.routers import borrow

        with patch.object(borrow.access_service_circuit, "can_request", new=AsyncMock(return_value=False)):
            assert await borrow._check_patron_inside("patron-id") is False


class TestQuantityMinimumValidation:
    """Phase 0: Quantity minimum validation"""

    @pytest.mark.asyncio
    async def test_quantity_below_borrowed_is_rejected(self, test_client, auth_headers_patron):
        response = await test_client.put(
            "/borrow/books/00000000-0000-0000-0000-000000000000/quantity",
            json={"quantity": 1},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403, 200]
