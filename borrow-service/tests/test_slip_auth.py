from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import uuid


class TestSlipCreateEndpointAuth:
    """Auth + role checks for POST /borrow/staff/slip/create"""

    @pytest.mark.asyncio
    async def test_no_auth_returns_401_or_403(self, test_client):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4()), "items": [{"barcode": "9780544003415"}]},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_patron_token_returns_403(self, test_client, auth_headers_patron):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4()), "items": [{"barcode": "9780544003415"}]},
            headers=auth_headers_patron,
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_staff_token_accepted(self, test_client, auth_headers_staff):
        now = datetime.utcnow()
        slip = MagicMock()
        slip.id = uuid.uuid4()
        slip.patron_id = uuid.uuid4()
        slip.borrow_at = now
        slip.due_at = now
        slip.status = "active"
        slip.created_by_user_id = None
        slip.created_by_email = None
        slip.total_items = 1
        slip.created_at = now
        slip.updated_at = now

        record = MagicMock()
        record.id = uuid.uuid4()
        record.patron_id = uuid.uuid4()
        record.book_id = uuid.uuid4()
        record.copy_id = uuid.uuid4()
        record.slip_id = uuid.uuid4()
        record.borrow_at = now
        record.due_at = now
        record.return_at = None
        record.status = "borrowed"
        record.note = None
        record.shelf_location = "A-1"
        record.returned_by_user_id = None
        record.returned_by_email = None
        record.return_method = None
        record.book = None

        book = MagicMock()
        book.id = uuid.uuid4()
        book.isbn = "9780544003415"
        book.title = "Test Book"
        book.shelf_location = "A-1"
        copy = MagicMock()
        copy.id = uuid.uuid4()
        copy.is_available = True
        copy.shelf_location = "A-1"

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                pass
            async def get_book_by_isbn(self, isbn):
                return book
            async def get_available_copy(self, book_id):
                return copy
            async def get_active_borrow(self, patron_id, book_id):
                return None
            async def get_overdue_borrows(self, patron_id):
                return []
            async def get_active_borrow_count(self, patron_id):
                return 0
            async def get_copy_by_id(self, copy_id):
                return copy
            async def mark_copy_unavailable(self, copy):
                pass
            async def create_slip(self, patron_id, book_ids, copy_ids, shelf_locations,
                                 created_by_user_id=None, created_by_email=None):
                return slip, [record]

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                "/borrow/staff/slip/create",
                json={"patron_id": str(uuid.uuid4()), "items": [{"barcode": "9780544003415"}]},
                headers=auth_headers_staff,
            )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, test_client, expired_token):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4()), "items": [{"barcode": "9780544003415"}]},
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert response.status_code == 401


class TestSlipCreateValidation:
    """Input validation for POST /borrow/staff/slip/create"""

    @pytest.mark.asyncio
    async def test_empty_body_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_patron_id_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"items": [{"barcode": "9780544003415"}]},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_missing_items_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4())},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_empty_items_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4()), "items": []},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_item_missing_barcode_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": str(uuid.uuid4()), "items": [{}]},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_patron_id_returns_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff/slip/create",
            json={"patron_id": "not-a-uuid", "items": [{"barcode": "9780544003415"}]},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422
