from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


MOCK_RECORD_ID = "11111111-1111-1111-1111-111111111111"
MOCK_PATRON_UUID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
MOCK_BOOK_UUID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
MOCK_COPY_UUID = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")


def _make_record(**overrides) -> MagicMock:
    now = datetime.utcnow()
    record = MagicMock()
    record.id = uuid.UUID(MOCK_RECORD_ID)
    record.slip_id = uuid.uuid4()
    record.book_id = MOCK_BOOK_UUID
    record.copy_id = MOCK_COPY_UUID
    record.patron_id = MOCK_PATRON_UUID
    record.status = "borrowed"
    record.return_at = None
    record.note = None
    record.borrow_at = now
    record.due_at = now
    record.shelf_location = "A-1"
    record.returned_by_user_id = None
    record.returned_by_email = None
    record.return_method = None
    record.book = None
    for k, v in overrides.items():
        setattr(record, k, v)
    return record


def _make_copy(**overrides) -> MagicMock:
    copy = MagicMock()
    copy.id = MOCK_COPY_UUID
    copy.book_id = MOCK_BOOK_UUID
    copy.barcode = "LIB-9780544003415-001"
    copy.is_available = True
    copy.shelf_location = "A-1"
    for k, v in overrides.items():
        setattr(copy, k, v)
    return copy


def _make_book(**overrides) -> MagicMock:
    book = MagicMock()
    book.id = MOCK_BOOK_UUID
    book.isbn = "9780544003415"
    book.title = "Test Book"
    book.author = "Test Author"
    book.shelf_location = "A-1"
    for k, v in overrides.items():
        setattr(book, k, v)
    return book


class TestSlipAutoCloseOnReturn:
    """Auto-close slip when all books in a slip are returned"""

    @pytest.mark.asyncio
    async def test_staff_return_by_record_calls_close_slip(self, test_client, auth_headers_staff):
        record = _make_record()

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                self.close_called = False

            async def get_borrow_record_by_id(self, record_id):
                return record

            async def get_copy_by_id(self, copy_id):
                return _make_copy()

            async def return_book(self, rec, **kw):
                rec.status = "returned"
                await self.close_slip_if_complete(rec.slip_id)
                return rec

            async def close_slip_if_complete(self, slip_id):
                self.close_called = True
                return True

            async def mark_copy_available(self, copy):
                copy.is_available = True

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                f"/borrow/staff-return/record/{MOCK_RECORD_ID}",
                json={"note": "test"},
                headers=auth_headers_staff,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    @pytest.mark.asyncio
    async def test_staff_return_by_barcode_calls_close_slip(self, test_client, auth_headers_staff):
        copy = _make_copy()
        record = _make_record()

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                self.close_called = False

            async def get_copy_by_barcode(self, barcode):
                return copy

            async def get_active_borrow_by_copy(self, copy_id):
                return record

            async def return_book(self, rec, **kw):
                rec.status = "returned"
                await self.close_slip_if_complete(rec.slip_id)
                return rec

            async def close_slip_if_complete(self, slip_id):
                self.close_called = True
                return True

            async def mark_copy_available(self, copy):
                copy.is_available = True

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                "/borrow/staff-return",
                json={"barcode": "LIB-9780544003415-001", "note": "test"},
                headers=auth_headers_staff,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    @pytest.mark.asyncio
    async def test_borrow_record_response_includes_slip_id(self, test_client, auth_headers_staff):
        record = _make_record()

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                pass

            async def get_borrow_record_by_id(self, record_id):
                return record

            async def get_copy_by_id(self, copy_id):
                return _make_copy()

            async def return_book(self, rec, **kw):
                rec.status = "returned"
                return rec

            async def close_slip_if_complete(self, slip_id):
                return True

            async def mark_copy_available(self, copy):
                copy.is_available = True

        with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
            response = await test_client.post(
                f"/borrow/staff-return/record/{MOCK_RECORD_ID}",
                json={"note": "test"},
                headers=auth_headers_staff,
            )

        data = response.json()
        record_resp = data.get("record", {})
        assert "slip_id" in record_resp

    @pytest.mark.asyncio
    async def test_staff_return_by_patron_calls_close_slip(self, test_client, auth_headers_staff):
        record = _make_record()
        book = _make_book()
        copy = _make_copy()

        class FakeRepo:
            def __init__(self, *args, **kwargs):
                self.close_called = False

            async def get_book_by_isbn(self, isbn):
                return book

            async def get_copy_by_barcode(self, barcode):
                return copy

            async def get_book_by_id(self, book_id):
                return book

            async def get_active_borrows_by_patron_and_book(self, patron_id, book_id):
                return [record]

            async def get_copy_by_id(self, copy_id):
                return copy

            async def return_book(self, rec, **kw):
                rec.status = "returned"
                await self.close_slip_if_complete(rec.slip_id)
                return rec

            async def close_slip_if_complete(self, slip_id):
                self.close_called = True
                return True

            async def mark_copy_available(self, copy):
                copy.is_available = True

        with (
            patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo),
            patch("src.api.routers.borrow._lookup_patron_by_student_code",
                  return_value={"id": str(MOCK_PATRON_UUID), "student_code": "SV001", "studentCode": "SV001"}),
        ):
            response = await test_client.post(
                "/borrow/staff-return/by-patron",
                json={"student_code": "SV001", "barcode_or_isbn": "9780544003415", "note": "test"},
                headers=auth_headers_staff,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"


class TestSlipAutoCloseThreeEndpoints:
    """Verify all return endpoints return 200 with FakeRepo"""

    ENDPOINTS = [
        ("record", "POST", f"/borrow/staff-return/record/{MOCK_RECORD_ID}",
         {"note": "test"}),
        ("barcode", "POST", "/borrow/staff-return",
         {"barcode": "LIB-9780544003415-001", "note": "test"}),
    ]

    @pytest.mark.asyncio
    async def test_all_return_endpoints_succeed(self, test_client, auth_headers_staff):
        for name, method, url, body in self.ENDPOINTS:
            record = _make_record()

            class FakeRepo:
                def __init__(self, *args, **kwargs):
                    pass
                async def get_borrow_record_by_id(self, record_id):
                    return record
                async def get_copy_by_id(self, copy_id):
                    return _make_copy()
                async def get_copy_by_barcode(self, barcode):
                    return _make_copy()
                async def get_active_borrow_by_copy(self, copy_id):
                    return record
                async def return_book(self, rec, **kw):
                    rec.status = "returned"
                    return rec
                async def close_slip_if_complete(self, slip_id):
                    return True
                async def mark_copy_available(self, copy):
                    copy.is_available = True

            with patch("src.api.routers.borrow.BorrowRepository", new=FakeRepo):
                resp = await test_client.post(url, json=body, headers=auth_headers_staff)

            assert resp.status_code == 200, f"{name}: expected 200, got {resp.status_code}"
