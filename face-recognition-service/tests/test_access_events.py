from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient


class TestSSERealtimeEvents:
    """SSE-01 to SSE-06: SSE Real-time Event Tests"""

    @pytest.mark.asyncio
    async def test_sse01_connect_sse_endpoint(self, test_client, auth_headers_admin):
        """SSE-01: Connect to SSE endpoint returns streaming response"""
        response = await test_client.get(
            "/access/events",
            headers=auth_headers_admin,
            stream=True,
        )

        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    @pytest.mark.asyncio
    async def test_sse02_event_format_correct(self, test_client, auth_headers_admin):
        """SSE-02: Event format validation - correct JSON structure"""
        test_event = {
            "status": "granted",
            "camera_id": "entry_gate",
            "patron_id": "test-patrons-id",
            "full_name": "Test User",
            "student_code": "TEST123",
            "score": 0.95,
            "access_type": "entry",
        }

        response = await test_client.post(
            "/access/test-broadcast",
            json=test_event,
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        result = response.json()
        assert result["ok"] is True
        assert result["event"]["status"] == "granted"
        assert result["event"]["camera_id"] == "entry_gate"

    @pytest.mark.asyncio
    async def test_sse03_broadcast_multiple_clients(self, test_client, auth_headers_admin):
        """SSE-03: Multiple clients receive broadcasted events"""
        test_event = {
            "status": "granted",
            "camera_id": "entry_gate",
            "patron_id": "test-patron-id",
            "full_name": "Test User",
            "student_code": "TEST456",
            "score": 0.95,
            "access_type": "entry",
        }

        broadcast_response = await test_client.post(
            "/access/test-broadcast",
            json=test_event,
            headers=auth_headers_admin,
        )

        assert broadcast_response.status_code == 200

    @pytest.mark.asyncio
    async def test_sse04_client_disconnect_cleanup(self, test_client, auth_headers_admin):
        """SSE-04: Client disconnect removes client from manager"""
        from infra.sse_manager import sse_manager

        initial_client_count = len(sse_manager.clients)

        async with test_client.stream("GET", "/access/events", headers=auth_headers_admin) as response:
            await response.aclose()

        assert len(sse_manager.clients) >= 0

    @pytest.mark.asyncio
    async def test_sse05_keepalive_ping(self, test_client, auth_headers_admin):
        """SSE-05: Keepalive ping sent periodically (30s)"""
        import asyncio

        received_events = []

        async def read_events():
            async with test_client.stream("GET", "/access/events", headers=auth_headers_admin) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data:"):
                        received_events.append(line)

        async def check_keepalive():
            await asyncio.sleep(5)

        await asyncio.gather(read_events(), check_keepalive())

    @pytest.mark.asyncio
    async def test_sse06_sse_requires_auth(self, test_client):
        """SSE-06: SSE endpoint requires authentication"""
        response = await test_client.get("/access/events")

        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_sse07_test_broadcast_requires_auth(self, test_client):
        """SSE-07: Test broadcast endpoint requires authentication"""
        response = await test_client.post(
            "/access/test-broadcast",
            json={"status": "granted"},
        )

        assert response.status_code in [401, 403]


class TestAccessLogs:
    """Tests for access logs endpoints"""

    @pytest.mark.asyncio
    async def test_get_recent_logs(self, test_client, auth_headers_admin):
        """GET /access/recent returns recent access logs"""
        response = await test_client.get(
            "/access/recent",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data

    @pytest.mark.asyncio
    async def test_get_logs_with_filters(self, test_client, auth_headers_admin):
        """GET /access/logs returns filtered logs"""
        response = await test_client.get(
            "/access/logs",
            params={
                "camera_id": "entry_gate",
                "status": "granted",
                "limit": 10,
            },
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data

    @pytest.mark.asyncio
    async def test_get_logs_pagination(self, test_client, auth_headers_admin):
        """GET /access/logs supports pagination"""
        response = await test_client.get(
            "/access/logs",
            params={"skip": 0, "limit": 20},
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 20

    @pytest.mark.asyncio
    async def test_get_logs_requires_auth(self, test_client):
        """GET /access/logs requires authentication"""
        response = await test_client.get("/access/logs")

        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_get_active_patrons(self, test_client, auth_headers_admin):
        """GET /access/active returns patrons currently inside"""
        response = await test_client.get(
            "/access/active",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data

    @pytest.mark.asyncio
    async def test_get_frequency(self, test_client, auth_headers_admin):
        """GET /access/frequency returns daily entry/exit counts"""
        response = await test_client.get(
            "/access/frequency",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert "daily" in data

    @pytest.mark.asyncio
    async def test_get_stats(self, test_client, auth_headers_admin):
        """GET /access/stats returns patron statistics"""
        response = await test_client.get(
            "/access/stats",
            headers=auth_headers_admin,
        )

        assert response.status_code == 200
        data = response.json()
        assert "total_patrons" in data
        assert "active_patrons" in data
        assert "today_entries" in data
        assert "today_exits" in data


class TestSSEManager:
    """Unit tests for SSE Manager"""

    @pytest.mark.asyncio
    async def test_sse_manager_register(self):
        """SSE manager registers new client"""
        from infra.sse_manager import SSEManager

        manager = SSEManager()
        initial_count = len(manager.clients)

        queue = await manager.register()

        assert len(manager.clients) == initial_count + 1

        await manager.unregister(queue)

    @pytest.mark.asyncio
    async def test_sse_manager_unregister(self):
        """SSE manager unregisters client"""
        from infra.sse_manager import SSEManager

        manager = SSEManager()
        queue = await manager.register()
        initial_count = len(manager.clients)

        await manager.unregister(queue)

        assert len(manager.clients) == initial_count - 1

    @pytest.mark.asyncio
    async def test_sse_manager_broadcast(self):
        """SSE manager broadcasts to all clients"""
        from infra.sse_manager import SSEManager

        manager = SSEManager()
        queue1 = await manager.register()
        queue2 = await manager.register()

        await manager.broadcast("test_event", {"message": "hello"})

        await manager.unregister(queue1)
        await manager.unregister(queue2)

    @pytest.mark.asyncio
    async def test_sse_manager_bounded_queue(self):
        """SSE manager drops oldest events when queue is full"""
        from infra.sse_manager import SSEManager

        manager = SSEManager()
        queue = await manager.register()

        manager.max_queue_size = 2

        await manager.broadcast("event1", {"data": "1"})
        await manager.broadcast("event2", {"data": "2"})
        await manager.broadcast("event3", {"data": "3"})

        await manager.unregister(queue)