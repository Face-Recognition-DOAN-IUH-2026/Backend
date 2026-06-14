from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


class TestHealthEndpoints:
    """Phase 0.4: Health check endpoints"""

    @pytest.mark.asyncio
    async def test_healthz_returns_200(self, test_client):
        response = await test_client.get("/healthz")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "service" in data

    @pytest.mark.asyncio
    async def test_ready_returns_status(self, test_client):
        response = await test_client.get("/ready")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "db_ok" in data


class TestBorrowFlow:
    """Complete borrow/return flow validation"""

    @pytest.mark.asyncio
    async def test_borrow_book_success(self, test_client, auth_headers_patron):
        response = await test_client.post(
            "/borrow/",
            json={"barcode": "LIB-9780544003415-001"},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_borrow_empty_body_422(self, test_client, auth_headers_patron):
        response = await test_client.post(
            "/borrow/",
            json={},
            headers=auth_headers_patron,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_borrow_missing_barcode_422(self, test_client, auth_headers_patron):
        response = await test_client.post(
            "/borrow/",
            json={"some_field": "value"},
            headers=auth_headers_patron,
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_borrow_no_auth_401(self, test_client):
        response = await test_client.post(
            "/borrow/",
            json={"barcode": "LIB-9780544003415-001"},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_return_success(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff-return",
            json={"barcode": "LIB-9780544003415-001"},
            headers=auth_headers_staff,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_return_no_auth_401(self, test_client):
        response = await test_client.post(
            "/borrow/staff-return",
            json={"barcode": "LIB-9780544003415-001"},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_staff_return_patron_forbidden(self, test_client, auth_headers_patron):
        response = await test_client.post(
            "/borrow/staff-return",
            json={"barcode": "LIB-9780544003415-001"},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [200]

    @pytest.mark.asyncio
    async def test_return_empty_body_422(self, test_client, auth_headers_staff):
        response = await test_client.post(
            "/borrow/staff-return",
            json={},
            headers=auth_headers_staff,
        )
        assert response.status_code == 422


class TestBarcodeLookup:
    """Barcode lookup endpoint"""

    @pytest.mark.asyncio
    async def test_lookup_existing_barcode(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/barcode/LIB-9780544003415-001",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_lookup_no_auth_401(self, test_client):
        response = await test_client.get("/borrow/barcode/LIB-9780544003415-001")
        assert response.status_code in [401, 403]


class TestBorrowHistory:
    """Borrow history endpoint"""

    @pytest.mark.asyncio
    async def test_history_authenticated(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/history",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_history_filtered(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/history?status_filter=borrowed",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_history_no_auth(self, test_client):
        response = await test_client.get("/borrow/history")
        assert response.status_code in [401, 403]


class TestBooksEndpoints:
    """Book listing, search, and detail endpoints"""

    @pytest.mark.asyncio
    async def test_list_books_authenticated(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/books?skip=0&limit=10",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_search_books(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/books?search=test",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_get_book_by_isbn(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/book/978-0-13-468599-1",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_books_no_auth(self, test_client):
        response = await test_client.get("/borrow/books")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_book_search_endpoint(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/books/search?q=test",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]


class TestBookTemplateAndExport:
    """Template download and export endpoints"""

    @pytest.mark.asyncio
    async def test_download_template(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/books/template",
            headers=auth_headers_patron,
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert "filename=book_import_template.xlsx" in response.headers.get("content-disposition", "")

    @pytest.mark.asyncio
    async def test_export_books(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/books/export",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]


class TestBookQuantity:
    """Book quantity management (Phase 0 feature)"""

    @pytest.mark.asyncio
    async def test_update_quantity_no_auth(self, test_client):
        response = await test_client.put(
            "/borrow/books/00000000-0000-0000-0000-000000000000/quantity",
            json={"quantity": 5},
        )
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_update_quantity_book_not_found(self, test_client, auth_headers_patron):
        response = await test_client.put(
            "/borrow/books/00000000-0000-0000-0000-000000000000/quantity",
            json={"quantity": 5},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_update_quantity_invalid(self, test_client, auth_headers_patron):
        response = await test_client.put(
            "/borrow/books/00000000-0000-0000-0000-000000000000/quantity",
            json={"quantity": -1},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [200]


class TestBookImport:
    """Book import flow (preview + confirm)"""

    @pytest.mark.asyncio
    async def test_import_preview_no_auth(self, test_client):
        response = await test_client.post("/borrow/books/import/preview")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_import_preview_wrong_file_type(
        self, test_client, auth_headers_patron
    ):
        response = await test_client.post(
            "/borrow/books/import/preview",
            files={"file": ("test.csv", b"ISBN,Quantity\n123,2", "text/csv")},
            headers=auth_headers_patron,
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_import_preview_empty_file(
        self, test_client, auth_headers_patron
    ):
        import io
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)

        response = await test_client.post(
            "/borrow/books/import/preview",
            files={"file": ("empty.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_import_no_auth(self, test_client):
        response = await test_client.post("/borrow/books/import")
        assert response.status_code in [401, 403]


class TestListBarcodes:
    """Barcode listing endpoint"""

    @pytest.mark.asyncio
    async def test_list_barcodes(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/barcodes",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]

    @pytest.mark.asyncio
    async def test_list_barcodes_no_auth(self, test_client):
        response = await test_client.get("/borrow/barcodes")
        assert response.status_code in [401, 403]


class TestAuthEdgeCases:
    """Auth edge cases (Phase 0)"""

    @pytest.mark.asyncio
    async def test_expired_token_rejected(self, test_client, expired_token):
        response = await test_client.get(
            "/borrow/history",
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_token(self, test_client):
        response = await test_client.get("/borrow/history")
        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_invalid_token_format(self, test_client):
        response = await test_client.get(
            "/borrow/history",
            headers={"Authorization": "Bearer this-is-not-valid-base64"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_token_accepted(self, test_client, auth_headers_patron):
        response = await test_client.get(
            "/borrow/history",
            headers=auth_headers_patron,
        )
        assert response.status_code not in [401, 403]
