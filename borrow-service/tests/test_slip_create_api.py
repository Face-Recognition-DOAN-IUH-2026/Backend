from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest


MOCK_PATRON_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
MOCK_BOOK_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
MOCK_COPY_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
MOCK_SLIP_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _mock_book(isbn: str = "9780544003415") -> MagicMock:
    book = MagicMock()
    book.id = MOCK_BOOK_ID
    book.isbn = isbn
    book.title = "Test Book"
    book.shelf_location = "A-1"
    return book


def _mock_copy(available: bool = True) -> MagicMock:
    copy = MagicMock()
    copy.id = MOCK_COPY_ID
    copy.is_available = available
    copy.shelf_location = "A-1"
    return copy


def _mock_slip_and_records() -> tuple[MagicMock, list[MagicMock]]:
    now = datetime.utcnow()
    slip = MagicMock()
    slip.id = MOCK_SLIP_ID
    slip.patron_id = MOCK_PATRON_ID
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
    record.patron_id = MOCK_PATRON_ID
    record.book_id = MOCK_BOOK_ID
    record.copy_id = MOCK_COPY_ID
    record.slip_id = MOCK_SLIP_ID
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

    return slip, [record]


class TestSlipCreateBusinessLogic:
    """Business logic validation for slip creation (mocked DB)"""

    SLIP_URL = "/borrow/staff/slip/create"

    def _payload(self, items: list[dict] | None = None) -> dict:
        return {
            "patron_id": str(MOCK_PATRON_ID),
            "items": items or [{"barcode": "9780544003415"}],
        }

    async def _post(self, test_client, auth_headers_staff, **overrides):
        payload = {**self._payload(), **overrides}
        return await test_client.post(self.SLIP_URL, json=payload, headers=auth_headers_staff)

    @pytest.mark.asyncio
    async def test_successful_creation(self, test_client, auth_headers_staff):
        slip, records = _mock_slip_and_records()
        book = _mock_book()
        copy = _mock_copy()

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
            async def create_slip(self, patron_id, book_ids, copy_ids, shelf_locations, created_by_user_id=None, created_by_email=None):
                return slip, records

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json=self._payload(),
                headers=auth_headers_staff,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "Tao phieu muon thanh cong" in data["message"]
        assert data["slip"] is not None
        assert len(data["slip"]["records"]) == 1

    @pytest.mark.asyncio
    async def test_duplicate_book_returns_409(self, test_client, auth_headers_staff):
        book = _mock_book()
        copy = _mock_copy()

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                pass
            async def get_book_by_isbn(self, isbn):
                return book
            async def get_available_copy(self, book_id):
                return copy
            async def get_active_borrow(self, patron_id, book_id):
                return MagicMock()

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json=self._payload(),
                headers=auth_headers_staff,
            )

        assert response.status_code == 409
        assert "da duoc" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_overdue_patron_returns_409(self, test_client, auth_headers_staff):
        book = _mock_book()
        copy = _mock_copy()

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
                return [MagicMock()]

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json=self._payload(),
                headers=auth_headers_staff,
            )

        assert response.status_code == 409
        assert "qua han" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_exceeds_max_borrow_books_returns_409(self, test_client, auth_headers_staff):
        book = _mock_book()
        copy = _mock_copy()

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
                return 3  # max_borrow_books is 3 → 3 + 1 > 3

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json=self._payload(),
                headers=auth_headers_staff,
            )

        assert response.status_code == 409
        assert "Qua gioi han" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_exceeds_per_slip_max_returns_409(self, test_client, auth_headers_staff):
        book = _mock_book()
        copy = _mock_copy()

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
                return MagicMock(), [MagicMock()]

        items = [{"barcode": f"978054400341{i}"} for i in range(6)]
        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json={"patron_id": str(MOCK_PATRON_ID), "items": items},
                headers=auth_headers_staff,
            )

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_unavailable_copy_returns_409(self, test_client, auth_headers_staff):
        book = _mock_book()
        copy = _mock_copy(available=False)

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                pass
            async def get_copy_by_barcode(self, barcode):
                return copy
            async def get_book_by_id(self, book_id):
                return book
            async def get_book_by_isbn(self, isbn):
                return None

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json={"patron_id": str(MOCK_PATRON_ID), "items": [{"barcode": "NONISBN-BARCODE"}]},
                headers=auth_headers_staff,
            )

        assert response.status_code == 409
        assert "dang duoc muon" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_copy_not_found_returns_404(self, test_client, auth_headers_staff):
        class FakeRepo:
            def __init__(self, *args, **kwargs):
                pass
            async def get_copy_by_barcode(self, barcode):
                return None
            async def get_book_by_isbn(self, isbn):
                return None
            async def get_book_by_normalized_isbn(self, isbn):
                return None

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                self.SLIP_URL,
                json={"patron_id": str(MOCK_PATRON_ID), "items": [{"barcode": "NONEXISTENT"}]},
                headers=auth_headers_staff,
            )

        assert response.status_code == 404
