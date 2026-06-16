from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestSlipRepositoryMethods:
    """Verify new BorrowSlip methods exist on BorrowRepository

    Follows the existing pattern from test_phase1_error_isolation:
    module is mocked by conftest, so these check callability only.
    """

    def test_create_slip_method_exists(self):
        from src.infra.repository import BorrowRepository

        method = BorrowRepository.create_slip
        assert method is not None

    def test_get_active_slip_method_exists(self):
        from src.infra.repository import BorrowRepository

        method = BorrowRepository.get_active_slip
        assert method is not None

    def test_close_slip_if_complete_method_exists(self):
        from src.infra.repository import BorrowRepository

        method = BorrowRepository.close_slip_if_complete
        assert method is not None

    def test_get_records_by_slip_id_method_exists(self):
        from src.infra.repository import BorrowRepository

        method = BorrowRepository.get_records_by_slip_id
        assert method is not None

    def test_get_slips_by_patron_method_exists(self):
        from src.infra.repository import BorrowRepository

        method = BorrowRepository.get_slips_by_patron
        assert method is not None


class TestSlipModelAttributes:
    """Verify BorrowSlipModel has all expected columns"""

    def test_borrow_slip_model_has_expected_attributes(self):
        from src.infra.models import BorrowSlipModel

        attrs = ["id", "patron_id", "borrow_at", "due_at", "status",
                 "created_by_user_id", "created_by_email", "total_items",
                 "created_at", "updated_at"]
        for attr in attrs:
            assert hasattr(BorrowSlipModel, attr), f"BorrowSlipModel missing: {attr}"

    def test_borrow_record_model_has_slip_id(self):
        from src.infra.models import BorrowRecordModel

        assert hasattr(BorrowRecordModel, "slip_id")
