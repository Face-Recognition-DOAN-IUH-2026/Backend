from __future__ import annotations

from unittest.mock import patch

import pytest


class TestBorrowEndpointAuth:
    """Tests for borrow endpoint authentication"""

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, test_client, expired_token):
        """Expired tokens are rejected"""
        response = await test_client.get(
            "/borrow/history",
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_token_returns_401_or_403(self, test_client):
        """Missing authorization returns 401 or 403"""
        response = await test_client.get("/borrow/history")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_invalid_token_format_returns_401(self, test_client):
        """Malformed token returns 401"""
        response = await test_client.get(
            "/borrow/history",
            headers={"Authorization": "Bearer not-valid-base64-here"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_token_accepted(self, test_client, auth_headers_patron):
        """Valid token is accepted (may return 500 due to mock, but not 401/403)"""
        response = await test_client.get(
            "/borrow/history",
            headers=auth_headers_patron,
        )
        assert response.status_code != 401
        assert response.status_code != 403

    @pytest.mark.asyncio
    async def test_borrow_endpoint_requires_auth(self, test_client):
        """POST /borrow/ requires authentication"""
        response = await test_client.post(
            "/borrow/",
            json={"barcode": "ANY"},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_return_requires_auth(self, test_client):
        """POST /borrow/staff-return requires authentication"""
        response = await test_client.post(
            "/borrow/staff-return",
            json={"barcode": "ANY"},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_lookup_barcode_requires_auth(self, test_client):
        """GET /borrow/barcode/{barcode} requires authentication"""
        response = await test_client.get("/borrow/barcode/ANY")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_patron_active_requires_auth(self, test_client):
        """GET /borrow/staff/patrons/{student_code}/active requires authentication"""
        response = await test_client.get("/borrow/staff/patrons/SV001/active")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_return_by_patron_requires_auth(self, test_client):
        """POST /borrow/staff-return/by-patron requires authentication"""
        response = await test_client.post(
            "/borrow/staff-return/by-patron",
            json={"student_code": "SV001", "barcode_or_isbn": "9780134685991"},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_list_books_requires_auth(self, test_client):
        """GET /borrow/books requires authentication"""
        response = await test_client.get("/borrow/books")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_get_book_requires_auth(self, test_client):
        """GET /borrow/book/{isbn} requires authentication"""
        response = await test_client.get("/borrow/book/978-0-13-468599-1")
        assert response.status_code in [401, 403]


class TestBorrowValidation:
    """Tests for input validation"""

    @pytest.mark.asyncio
    async def test_borrow_empty_body(self, test_client, auth_headers_patron):
        """POST /borrow/ with empty body returns 422"""
        response = await test_client.post(
            "/borrow/",
            json={},
            headers=auth_headers_patron,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_borrow_missing_barcode(self, test_client, auth_headers_patron):
        """POST /borrow/ without barcode returns 422"""
        response = await test_client.post(
            "/borrow/",
            json={"some_field": "value"},
            headers=auth_headers_patron,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_staff_return_empty_body(self, test_client, auth_headers_staff):
        """POST /borrow/staff-return with empty body returns 422"""
        response = await test_client.post(
            "/borrow/staff-return",
            json={},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_staff_return_by_patron_empty_body(self, test_client, auth_headers_staff):
        """POST /borrow/staff-return/by-patron with empty body returns 422"""
        response = await test_client.post(
            "/borrow/staff-return/by-patron",
            json={},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422


class TestHealthEndpoint:
    """Tests for health check endpoints"""

    @pytest.mark.asyncio
    async def test_healthz(self, test_client):
        """GET /healthz returns 200"""
        response = await test_client.get("/healthz")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_ready_endpoint(self, test_client):
        """GET /ready returns status"""
        response = await test_client.get("/ready")
        assert response.status_code == 200
