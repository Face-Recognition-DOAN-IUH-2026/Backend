from __future__ import annotations

import uuid
from datetime import datetime

import pytest


class TestBorrowSlipSchemas:
    """Schema validation for BorrowSlip request/response models"""

    def test_borrow_slip_item_accepts_barcode_only(self):
        from src.lib.schemas import BorrowSlipItem

        item = BorrowSlipItem(barcode="9780544003415")
        assert item.barcode == "9780544003415"
        assert item.isbn is None

    def test_borrow_slip_item_accepts_barcode_and_isbn(self):
        from src.lib.schemas import BorrowSlipItem

        item = BorrowSlipItem(barcode="LIB-001", isbn="9780544003415")
        assert item.barcode == "LIB-001"
        assert item.isbn == "9780544003415"

    def test_create_borrow_slip_request_valid(self):
        from src.lib.schemas import CreateBorrowSlipRequest, BorrowSlipItem

        req = CreateBorrowSlipRequest(
            patron_id=str(uuid.uuid4()),
            items=[BorrowSlipItem(barcode="9780544003415")],
        )
        assert len(req.items) == 1
        assert req.patron_id is not None

    def test_create_borrow_slip_response_success(self):
        from src.lib.schemas import CreateBorrowSlipResponse

        resp = CreateBorrowSlipResponse(status="success", message="OK")
        assert resp.status == "success"
        assert resp.slip is None

    def test_borrow_slip_response_has_all_fields(self):
        from src.lib.schemas import BorrowSlipResponse

        slip = BorrowSlipResponse(
            id=uuid.uuid4(),
            patron_id=uuid.uuid4(),
            borrow_at=datetime.utcnow(),
            due_at=datetime.utcnow(),
            status="active",
            total_items=2,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            records=[],
        )
        assert slip.id is not None
        assert slip.status == "active"
        assert slip.total_items == 2
        assert slip.records == []


class TestBorrowRecordSchemaSlipField:
    """BorrowRecordResponse now includes slip_id"""

    def test_borrow_record_response_has_slip_id(self):
        from src.lib.schemas import BorrowRecordResponse

        assert "slip_id" in BorrowRecordResponse.model_fields

    def test_borrow_record_response_has_note(self):
        from src.lib.schemas import BorrowRecordResponse

        assert "note" in BorrowRecordResponse.model_fields

    def test_borrow_record_response_slip_id_optional(self):
        from src.lib.schemas import BorrowRecordResponse

        field = BorrowRecordResponse.model_fields["slip_id"]
        assert field.is_required() is False
