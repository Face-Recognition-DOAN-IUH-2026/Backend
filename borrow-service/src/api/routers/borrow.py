from __future__ import annotations

import asyncio
import io
import logging
import os
import uuid
from datetime import datetime
import httpx
from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from openpyxl import load_workbook
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import get_current_user
from src.infra.database import get_db_session
from src.infra.models import BookModel, BookCopyModel, BorrowSlipModel
from src.infra.repository import BorrowRepository
from src.lib.http_client import (
    access_service_circuit,
    get_http_client,
    openlibrary_circuit,
    user_service_circuit,
)
from src.lib.schemas import (
    BorrowRequest,
    BorrowResponse,
    BorrowRecordResponse,
    BorrowSlipResponse,
    BorrowSlipItem,
    CreateBorrowSlipRequest,
    CreateBorrowSlipResponse,
    BookResponse,
    BookWithStatsResponse,
    BooksListResponse,
    BookImportPreviewResponse,
    BookImportPreviewRow,
    BookImportResponse,
    BookImportResultRow,
    StaffReturnRequest,
    StaffReturnByPatronRequest,
    StaffReturnRecordRequest,
    StaffPatronActiveBorrowsResponse,
    StaffActiveBorrowerSummary,
    StaffActiveBorrowersResponse,
    StaffPatronSummary,
    ReturnResponse,
    ErrorResponse,
    UpdateBookQuantityRequest,
    BulkDeleteRequest,
    BulkDeleteResponse,
)
from src.config import settings

logger = logging.getLogger("borrow-service.api")

router = APIRouter(prefix="/borrow", tags=["borrow"])


def _require_role(current_user: dict, allowed_roles: set[str], detail: str) -> None:
    role = current_user.get("role", "")
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


async def _check_patron_inside(user_id: str) -> bool:
    can_req = await access_service_circuit.can_request()
    if not can_req:
        logger.warning("access-service circuit OPEN, cannot verify inside status for user=%s", user_id)
        return False
    try:
        client = get_http_client()
        resp = await client.get(
            f"{settings.access_service_url}/internal/access/patrons/{user_id}/status",
            timeout=5.0,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
        inside = data.get("currentStatus") == "inside" or data.get("current_status") == "inside"
        await access_service_circuit.record_success()
        return inside
    except httpx.TimeoutException:
        logger.warning("access-service timeout checking patron=%s", user_id)
        await access_service_circuit.record_failure()
        return False
    except Exception as e:
        logger.error("access-service error checking patron=%s: %s", user_id, e)
        await access_service_circuit.record_failure()
        return False


def _current_user_uuid(current_user: dict) -> uuid.UUID | None:
    try:
        return uuid.UUID(current_user["id"])
    except (KeyError, TypeError, ValueError):
        return None


def _patron_field(patron: dict, snake_name: str, camel_name: str):
    return patron.get(snake_name) or patron.get(camel_name)


async def _lookup_patron_by_student_code(student_code: str) -> dict:
    normalized = student_code.strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="student_code is required")

    can_req = await user_service_circuit.can_request()
    if not can_req:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="user-service is temporarily unavailable")

    try:
        client = get_http_client()
        resp = await client.get(
            f"{settings.user_service_url}/patrons/lookup",
            params={"student_code": normalized},
            timeout=5.0,
        )
        if resp.status_code >= 500:
            await user_service_circuit.record_failure()
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cannot lookup patron right now")
        if resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay doc gia")

        data = resp.json()
        await user_service_circuit.record_success()
        if not data.get("exists") or not data.get("patron"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay doc gia voi MSSV nay")
        return data["patron"]
    except HTTPException:
        raise
    except httpx.TimeoutException:
        await user_service_circuit.record_failure()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Timeout khi tra cuu doc gia")
    except Exception as e:
        logger.error("user-service error looking up student_code=%s: %s", normalized, e)
        await user_service_circuit.record_failure()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Khong the tra cuu doc gia")


async def _lookup_patron_by_id(patron_id: uuid.UUID) -> dict | None:
    can_req = await user_service_circuit.can_request()
    if not can_req:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="user-service is temporarily unavailable")

    try:
        client = get_http_client()
        resp = await client.get(
            f"{settings.user_service_url}/users/{patron_id}",
            timeout=5.0,
        )
        if resp.status_code >= 500:
            await user_service_circuit.record_failure()
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Cannot lookup patron right now")
        if resp.status_code != 200:
            return None

        await user_service_circuit.record_success()
        return resp.json()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        await user_service_circuit.record_failure()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Timeout khi tra cuu doc gia")
    except Exception as e:
        logger.error("user-service error looking up patron_id=%s: %s", patron_id, e)
        await user_service_circuit.record_failure()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Khong the tra cuu doc gia")


def _check_patron_status(patron_or_summary: StaffPatronSummary | dict) -> None:
    """Raise 403 if patron card is blocked / expired / expelled."""
    if isinstance(patron_or_summary, dict):
        status = _patron_field(patron_or_summary, "current_status", "currentStatus")
    else:
        status = patron_or_summary.current_status
    if status in ("blocked", "expelled", "expired"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The doc gia da bi khoa/het han. Vui long lien he thu vien.",
        )


def _build_patron_summary(patron: dict) -> StaffPatronSummary:
    patron_id = _patron_field(patron, "id", "id")
    student_code = _patron_field(patron, "student_code", "studentCode")
    if not patron_id or not student_code:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Du lieu doc gia khong hop le")
    try:
        parsed_id = uuid.UUID(patron_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="ID doc gia khong hop le")
    return StaffPatronSummary(
        id=parsed_id,
        full_name=_patron_field(patron, "full_name", "fullName"),
        student_code=student_code,
        email=_patron_field(patron, "email", "email"),
        card_number=_patron_field(patron, "card_number", "cardNumber"),
        current_status=_patron_field(patron, "current_status", "currentStatus"),
    )


async def _get_or_create_book_and_copy(repo: BorrowRepository, barcode: str, isbn: str | None = None) -> tuple[BookModel, BookCopyModel]:
    barcode = barcode.replace("-", "").replace(" ", "").strip()
    copy = await repo.get_copy_by_barcode(barcode)
    if copy:
        book = await repo.get_book_by_id(copy.book_id)
        return book, copy

    book = None
    if isbn:
        book = await repo.get_book_by_isbn(isbn)

    if not book:
        # Only fetch metadata for display, do NOT auto-create book
        meta = await _fetch_google_books(isbn)

    if not book:
        book = await repo.create_book(isbn or barcode, f"Barcode {barcode}")

    copy = await repo.create_copy(book.id, barcode, shelf_location=book.shelf_location)
    return book, copy


@router.post(
    "/",
    response_model=BorrowResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Patron not inside library"},
        404: {"model": ErrorResponse, "description": "Book not found"},
        409: {"model": ErrorResponse, "description": "Conflict (already borrowed / quota full / overdue)"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def borrow_book(
    body: BorrowRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"patron"},
        "Chi doc gia moi co the tu muon sach tren ung dung",
    )
    user_id = current_user["id"]
    barcode = body.barcode.strip()
    patron_uuid = uuid.UUID(user_id)

    is_inside = await _check_patron_inside(user_id)
    if not is_inside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ban phai co mat trong thu vien de muon sach. Vui long quet the tai cua vao.",
        )

    repo = BorrowRepository(db)

    if body.isbn or (barcode.isdigit() and len(barcode) in (10, 13)):
        lookup_isbn = body.isbn or barcode
        book = await repo.get_book_by_isbn(lookup_isbn)
        if not book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Sach voi ISBN {lookup_isbn} chua co trong thu vien",
            )
        copy = await repo.get_available_copy(book.id)
        if not copy:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sach nay hien da het ban co the muon",
            )
    else:
        copy = await repo.get_copy_by_barcode(barcode)
        if not copy:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Khong tim thay ban sao nao voi ma vach {barcode}",
            )
        book = await repo.get_book_by_id(copy.book_id)
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay sach")
        if not copy.is_available:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ban sao nay hien dang duoc muon",
            )
    existing = await repo.get_active_borrow(patron_uuid, book.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sách này bạn đang mượn",
        )

    overdue = await repo.get_overdue_borrows(patron_uuid)
    if overdue:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bạn có sách quá hạn. Vui lòng trả sách trước khi mượn thêm.",
        )

    active_count = await repo.get_active_borrow_count(patron_uuid)
    if active_count >= settings.max_borrow_books:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Đã quá giới hạn mượn sách (tối đa {settings.max_borrow_books} cuốn)",
        )

    await repo.mark_copy_unavailable(copy)
    record = await repo.create_borrow_record(
        patron_uuid, book.id, copy_id=copy.id, shelf_location=copy.shelf_location or book.shelf_location
    )

    return BorrowResponse(
        status="success",
        message=f"Mượn sách thành công. Vui lòng trả trước ngày {record.due_at.strftime('%d/%m/%Y')}.",
        record=BorrowRecordResponse.model_validate(record),
        book=BookResponse.model_validate(book),
    )


@router.get(
    "/barcode/{barcode}",
    response_model=BorrowRecordResponse,
    responses={404: {"model": ErrorResponse}},
)
async def lookup_by_barcode(
    barcode: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chỉ quản trị viên hoặc nhân viên thư viện mới có thể tra cứu trả sách",
    )
    repo = BorrowRepository(db)
    copy = await repo.get_copy_by_barcode(barcode.strip())
    if not copy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy bản sao với mã vạch {barcode}")
    record = await repo.get_active_borrow_by_copy(copy.id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bản sao này hiện không được mượn")
    return BorrowRecordResponse.model_validate(record)


@router.get(
    "/staff/active-borrowers",
    response_model=StaffActiveBorrowersResponse,
    responses={
        403: {"model": ErrorResponse, "description": "Staff role required"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_get_active_borrowers(
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the xem danh sach doc gia dang muon",
    )

    repo = BorrowRepository(db)
    records = await repo.get_all_active_borrows()
    grouped: dict[uuid.UUID, list] = {}
    for record in records:
        grouped.setdefault(record.patron_id, []).append(record)

    now = datetime.utcnow()
    items: list[StaffActiveBorrowerSummary] = []
    for patron_id, patron_records in grouped.items():
        patron = await _lookup_patron_by_id(patron_id)
        if patron:
            patron_summary = _build_patron_summary(patron)
        else:
            patron_summary = StaffPatronSummary(
                id=patron_id,
                full_name=None,
                student_code=str(patron_id),
                email=None,
                card_number=None,
                current_status=None,
            )
        items.append(
            StaffActiveBorrowerSummary(
                patron=patron_summary,
                total_borrowed=len(patron_records),
                overdue_count=sum(1 for record in patron_records if record.due_at < now),
                latest_borrow_at=max(record.borrow_at for record in patron_records),
                nearest_due_at=min(record.due_at for record in patron_records),
            )
        )

    items.sort(key=lambda item: (-item.overdue_count, item.nearest_due_at, item.patron.student_code))
    return StaffActiveBorrowersResponse(items=items, total=len(items))


@router.get(
    "/staff/patrons/{student_code}/active",
    response_model=StaffPatronActiveBorrowsResponse,
    responses={
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "Patron not found"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_get_patron_active_borrows(
    student_code: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu sach dang muon",
    )

    patron = await _lookup_patron_by_student_code(student_code)
    _check_patron_status(patron)
    patron_summary = _build_patron_summary(patron)
    repo = BorrowRepository(db)
    records = await repo.get_active_borrows_by_patron(patron_summary.id)

    now = datetime.utcnow()
    return StaffPatronActiveBorrowsResponse(
        patron=patron_summary,
        records=[BorrowRecordResponse.model_validate(record) for record in records],
        total=len(records),
        overdue_count=sum(1 for record in records if record.due_at < now),
    )


@router.get(
    "/staff/patrons/{student_code}/history",
    response_model=list[BorrowRecordResponse],
    responses={
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "Patron not found"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_get_patron_borrow_history_by_student_code(
    student_code: str,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach",
    )

    patron = await _lookup_patron_by_student_code(student_code)
    patron_summary = _build_patron_summary(patron)
    repo = BorrowRepository(db)
    records = await repo.get_borrows_by_patron(patron_summary.id, status=status_filter)
    return [BorrowRecordResponse.model_validate(record) for record in records]


@router.get(
    "/staff/patrons/id/{patron_id}/history",
    response_model=list[BorrowRecordResponse],
    responses={
        403: {"model": ErrorResponse, "description": "Staff role required"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_get_patron_borrow_history_by_id(
    patron_id: uuid.UUID,
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tra cuu lich su muon sach",
    )

    repo = BorrowRepository(db)
    records = await repo.get_borrows_by_patron(patron_id, status=status_filter)
    return [BorrowRecordResponse.model_validate(record) for record in records]


@router.post(
    "/staff/slip/create",
    response_model=CreateBorrowSlipResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "Book or copy not found"},
        409: {"model": ErrorResponse, "description": "Conflict (already borrowed / quota full)"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_create_borrow_slip(
    body: CreateBorrowSlipRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tao phieu muon",
    )

    repo = BorrowRepository(db)
    patron_uuid = body.patron_id

    try:
        patron = await _lookup_patron_by_id(patron_uuid)
        if patron:
            _check_patron_status(patron)
    except Exception:
        logger.warning("Khong the xac thuc trang thai doc gia %s: tiep tuc cho muon", patron_uuid)

    book_ids: list[uuid.UUID] = []
    copy_ids: list[uuid.UUID | None] = []
    shelf_locations: list[str | None] = []
    used_copy_ids: set[uuid.UUID] = set()

    for item in body.items:
        barcode = item.barcode.strip()
        isbn = item.isbn.strip() if item.isbn else None
        copy: BookCopyModel | None = None
        book: BookModel | None = None

        if isbn or (barcode.isdigit() and len(barcode) in (10, 13)):
            lookup_isbn = isbn or barcode
            book = await repo.get_book_by_isbn(lookup_isbn)
            if not book:
                existing_copy = await repo.get_copy_by_barcode(barcode)
                if existing_copy:
                    book = await repo.get_book_by_id(existing_copy.book_id)
                    copy = existing_copy
                    if not copy.is_available:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"Ban sao {barcode} dang duoc muon",
                        )
            if not book:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Sach voi ISBN {lookup_isbn} chua co trong thu vien",
                )
            copy = await repo.get_available_copy(book.id)
            if not copy:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Sach {book.title} da het ban co the muon",
                )
        else:
            copy = await repo.get_copy_by_barcode(barcode)
            if not copy:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Khong tim thay ban sao voi ma vach {barcode}",
                )
            book = await repo.get_book_by_id(copy.book_id)
            if not book:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay sach")
            if not copy.is_available:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Ban sao {barcode} dang duoc muon",
                )

        if not book or not copy:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay sach")

        if copy.id in used_copy_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ma vach {barcode} da duoc quet trong phieu muon nay",
            )
        used_copy_ids.add(copy.id)

        existing = await repo.get_active_borrow(patron_uuid, book.id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f'Sach "{book.title}" da duoc doc gia nay muon',
            )

        book_ids.append(book.id)
        copy_ids.append(copy.id)
        shelf_locations.append(copy.shelf_location or book.shelf_location)

    overdue = await repo.get_overdue_borrows(patron_uuid)
    if overdue:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Doc gia co sach qua han. Vui long tra sach truoc khi muon them.",
        )

    if len(book_ids) > settings.max_borrow_books_per_slip:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Moi phieu muon toi da {settings.max_borrow_books_per_slip} cuon",
        )

    active_count = await repo.get_active_borrow_count(patron_uuid)
    if active_count + len(book_ids) > settings.max_borrow_books:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Qua gioi han muon sach (toi da {settings.max_borrow_books} cuon)",
        )

    for cid in copy_ids:
        if cid:
            c = await repo.get_copy_by_id(cid)
            if c:
                await repo.mark_copy_unavailable(c)

    slip, records = await repo.create_slip(
        patron_uuid, book_ids, copy_ids, shelf_locations,
        created_by_user_id=_current_user_uuid(current_user),
        created_by_email=current_user.get("email"),
    )

    return CreateBorrowSlipResponse(
        status="success",
        message=f"Tao phieu muon thanh cong voi {len(records)} cuon. Han tra: {slip.due_at.strftime('%d/%m/%Y')}.",
        slip=BorrowSlipResponse(
            id=slip.id,
            patron_id=slip.patron_id,
            borrow_at=slip.borrow_at,
            due_at=slip.due_at,
            status=slip.status,
            created_by_user_id=slip.created_by_user_id,
            created_by_email=slip.created_by_email,
            total_items=slip.total_items,
            created_at=slip.created_at,
            updated_at=slip.updated_at,
            records=[BorrowRecordResponse.model_validate(r) for r in records],
        ),
    )


@router.post(
    "/staff-return/by-patron",
    response_model=ReturnResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "No matching active borrow record found"},
        409: {"model": ErrorResponse, "description": "Ambiguous matching borrow records"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_return_book_by_patron(
    body: StaffReturnByPatronRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tra sach",
    )

    scanned_code = body.barcode_or_isbn.strip()
    if not scanned_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="barcode_or_isbn is required")

    patron = await _lookup_patron_by_student_code(body.student_code)
    patron_summary = _build_patron_summary(patron)
    repo = BorrowRepository(db)

    book = await repo.get_book_by_isbn(scanned_code)
    if not book:
        legacy_copy = await repo.get_copy_by_barcode(scanned_code)
        if legacy_copy:
            book = await repo.get_book_by_id(legacy_copy.book_id)

    if not book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Khong tim thay sach voi ma vua quet",
        )

    records = await repo.get_active_borrows_by_patron_and_book(patron_summary.id, book.id)
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Doc gia nay khong muon sach co ma nay",
        )
    if len(records) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Co nhieu ban ghi muon trung sach. Vui long chon ban ghi thu cong hoac dung barcode ban sao.",
        )

    record = records[0]
    copy = await repo.get_copy_by_barcode(scanned_code)
    if not copy and record.copy_id:
        copy = await repo.get_copy_by_id(record.copy_id)

    await repo.return_book(
        record,
        returned_by_user_id=_current_user_uuid(current_user),
        returned_by_email=current_user.get("email"),
        return_method="staff_mobile",
        note=body.note,
    )
    if copy:
        await repo.mark_copy_available(copy)

    return ReturnResponse(
        status="success",
        message="Tra sach thanh cong",
        record=BorrowRecordResponse.model_validate(record),
    )


@router.post(
    "/staff-return/record/{record_id}",
    response_model=ReturnResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "Borrow record not found"},
        409: {"model": ErrorResponse, "description": "Borrow record is not active"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_return_book_by_record(
    record_id: uuid.UUID,
    body: StaffReturnRecordRequest = Body(...),
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chi quan tri vien hoac nhan vien thu vien moi co the tra sach",
    )

    repo = BorrowRepository(db)
    record = await repo.get_borrow_record_by_id(record_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay phieu muon")
    if record.status != "borrowed" or record.return_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phieu muon nay da duoc tra hoac khong con hieu luc")

    copy = await repo.get_copy_by_id(record.copy_id) if record.copy_id else None
    await repo.return_book(
        record,
        returned_by_user_id=_current_user_uuid(current_user),
        returned_by_email=current_user.get("email"),
        return_method="staff_web",
        note=body.note,
    )
    if copy:
        await repo.mark_copy_available(copy)

    return ReturnResponse(
        status="success",
        message="Tra sach thanh cong",
        record=BorrowRecordResponse.model_validate(record),
    )


@router.post(
    "/staff-return",
    response_model=ReturnResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Staff role required"},
        404: {"model": ErrorResponse, "description": "No active borrow record found"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def staff_return_book(
    body: StaffReturnRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    _require_role(
        current_user,
        {"admin", "staff"},
        "Chỉ quản trị viên hoặc nhân viên thư viện mới có thể trả sách",
    )

    barcode = body.barcode.strip()
    repo = BorrowRepository(db)

    copy = await repo.get_copy_by_barcode(barcode)
    if not copy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy bản sao nào với mã vạch {barcode}",
        )

    record = await repo.get_active_borrow_by_copy(copy.id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không có bản ghi mượn đang hoạt động cho bản sao này",
        )

    await repo.return_book(
        record,
        returned_by_user_id=_current_user_uuid(current_user),
        returned_by_email=current_user.get("email"),
        return_method="staff_web",
        note=body.note,
    )
    await repo.mark_copy_available(copy)

    return ReturnResponse(
        status="success",
        message="Trả sách thành công",
        record=BorrowRecordResponse.model_validate(record),
    )


@router.get(
    "/history",
    response_model=list[BorrowRecordResponse],
    responses={401: {"model": ErrorResponse}},
)
async def get_borrow_history(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    patron_id = current_user["id"]
    patron_uuid = uuid.UUID(patron_id)
    repo = BorrowRepository(db)
    records = await repo.get_borrows_by_patron(patron_uuid, status=status_filter)
    return [BorrowRecordResponse.model_validate(r) for r in records]


@router.get(
    "/book/{isbn}",
    response_model=BookResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_book(
    isbn: str,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    book = await repo.get_book_by_isbn(isbn.strip())
    if not book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sach voi ISBN {isbn} chua co trong thu vien",
        )
    return BookResponse.model_validate(book)


@router.get(
    "/books",
    response_model=BooksListResponse,
    responses={401: {"model": ErrorResponse}},
)
async def list_books(
    skip: int = 0,
    limit: int = 20,
    search: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    books, total, stats_map = await repo.get_books_with_stats(skip=skip, limit=limit, search=search)

    items = []
    for b in books:
        total_copies, available_copies = stats_map.get(b.id, (0, 0))
        items.append(
            BookWithStatsResponse(
                id=b.id,
                isbn=b.isbn,
                title=b.title,
                author=b.author,
                cover_url=b.cover_url,
                shelf_location=b.shelf_location,
                total_copies=total_copies,
                available_copies=available_copies,
                created_at=b.created_at,
            )
        )
    return BooksListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get(
    "/books/search",
    response_model=list[BookWithStatsResponse],
    responses={401: {"model": ErrorResponse}},
)
async def search_books(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    books, _total, stats_map = await repo.get_books_with_stats(skip=0, limit=20, search=q)
    items = []
    for b in books:
        total_copies, available_copies = stats_map.get(b.id, (0, 0))
        items.append(
            BookWithStatsResponse(
                id=b.id,
                isbn=b.isbn,
                title=b.title,
                author=b.author,
                cover_url=b.cover_url,
                shelf_location=b.shelf_location,
                total_copies=total_copies,
                available_copies=available_copies,
                created_at=b.created_at,
            )
        )
    return items


async def _fetch_google_books(isbn: str) -> dict | None:
    """Fetch book metadata from Google Books API."""
    from lib.http_client import google_books_circuit

    can_req = await google_books_circuit.can_request()
    if not can_req:
        logger.warning("Google Books circuit OPEN, skipping fetch for ISBN=%s", isbn)
        return None
    try:
        client = get_http_client()
        api_key = os.environ.get("GOOGLE_BOOKS_API_KEY", "")
        if not api_key:
            logger.warning("Google Books API key not configured")
            return None
        # Use Google Books API v1
        url = "https://www.googleapis.com/books/v1/volumes"
        params = {"q": f"isbn:{isbn}", "maxResults": 1, "key": api_key}
        resp = await client.get(url, params=params, timeout=10.0)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            if items:
                await google_books_circuit.record_success()
                info = items[0].get("volumeInfo", {})
                authors = info.get("authors", [])
                author = ", ".join(authors) if authors else None
                categories = info.get("categories", [])
                cats = ", ".join(categories) if categories else None
                thumbnail = info.get("imageLinks", {}).get("thumbnail") or info.get("imageLinks", {}).get("smallThumbnail")
                return {
                    "title": info.get("title", f"ISBN {isbn}"),
                    "subtitle": info.get("subtitle"),
                    "author": author,
                    "publisher": info.get("publisher"),
                    "published_date": info.get("publishedDate"),
                    "description": info.get("description"),
                    "page_count": info.get("pageCount"),
                    "categories": cats,
                    "language": info.get("language"),
                    "cover_url": thumbnail,
                }
        await google_books_circuit.record_success()
    except httpx.TimeoutException:
        logger.warning("Google Books timeout for ISBN=%s", isbn)
        await google_books_circuit.record_failure()
    except httpx.HTTPError as e:
        logger.warning("Google Books HTTP error for ISBN=%s: %s", isbn, e)
        await google_books_circuit.record_failure()
    except Exception as e:
        logger.error("Google Books unexpected error for ISBN=%s: %s", isbn, e)
        await google_books_circuit.record_failure()
    return None


@router.get(
    "/books/template",
    responses={401: {"model": ErrorResponse}},
)
async def download_template(
    _: dict = Depends(get_current_user),
):
    import io
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Books Import"
    ws.append(["ISBN", "Quantity"])
    ws.append(["9780544003415", 2])
    ws.append(["9780439708180", 3])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=book_import_template.xlsx"},
    )


@router.get(
    "/books/export",
    responses={401: {"model": ErrorResponse}},
)
async def export_books(
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    import io
    from openpyxl import Workbook

    repo = BorrowRepository(db)
    books = await repo.get_all_books(skip=0, limit=10000)

    wb = Workbook()
    ws = wb.active
    ws.title = "Books"
    ws.append(["ISBN", "Title", "Author", "Total Copies", "Available Copies", "Shelf Location", "Created At"])

    for b in books:
        total = await repo.count_total_copies(b.id)
        avail = await repo.count_available_copies(b.id)
        ws.append([
            b.isbn,
            b.title,
            b.author or "",
            total,
            avail,
            b.shelf_location or "",
            b.created_at.strftime("%Y-%m-%d %H:%M:%S") if b.created_at else "",
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=books_export.xlsx"},
    )


@router.post(
    "/books/import/preview",
    response_model=BookImportPreviewResponse,
    responses={401: {"model": ErrorResponse}},
)
async def preview_import(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chỉ hỗ trợ file Excel (.xlsx, .xls)")

    try:
        contents = await file.read()
        wb = load_workbook(io.BytesIO(contents), read_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không thể đọc file Excel")

    if len(rows) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File Excel trống hoặc không có dữ liệu")

    headers = [str(h).strip().upper() for h in rows[0]]
    isbn_idx = next((i for i, h in enumerate(headers) if "ISBN" in h), None)
    qty_idx = next((i for i, h in enumerate(headers) if "QUANTITY" in h or "SỐ LƯỢNG" in h or "QTY" in h), None)

    if isbn_idx is None or qty_idx is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File phải có cột 'ISBN' và 'Quantity'")

    repo = BorrowRepository(db)
    excel_rows = []
    for i, row in enumerate(rows[1:][:100], start=2):
        isbn_val = str(row[isbn_idx]).strip() if isbn_idx < len(row) else ""
        qty_val = row[qty_idx] if qty_idx < len(row) else None
        if not isbn_val or isbn_val == "None":
            continue
        try:
            quantity = max(1, int(float(qty_val)) if qty_val and str(qty_val) != "None" else 1)
        except (ValueError, TypeError):
            quantity = 1
        excel_rows.append({"isbn": isbn_val, "quantity": quantity, "line": i})

    if not excel_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không có dữ liệu hợp lệ")

    isbn_list = [r["isbn"] for r in excel_rows]
    existing_books = await repo.get_books_by_isbns(isbn_list)
    isbns_needed = [r["isbn"] for r in excel_rows if r["isbn"] not in existing_books]

    metadata_map: dict[str, dict | None] = {}
    if isbns_needed:
        async def fetch_one(client: httpx.AsyncClient, isbn: str) -> tuple[str, dict | None]:
            return isbn, await _fetch_google_books(isbn)
        async with httpx.AsyncClient(timeout=30.0) as client:
            tasks = [fetch_one(client, isbn) for isbn in isbns_needed]
            fetched = await asyncio.gather(*tasks, return_exceptions=True)
            for item in fetched:
                if isinstance(item, Exception):
                    continue
                isbn, meta = item
                metadata_map[isbn] = meta

    barcode_offsets = await repo.get_barcode_offsets_by_books(list(existing_books.keys()))

    preview_rows: list[BookImportPreviewRow] = []
    valid_rows = 0
    invalid_rows = len(excel_rows) - sum(1 for r in excel_rows if r["isbn"])

    for row in excel_rows:
        isbn = row["isbn"]
        quantity = row["quantity"]
        book = existing_books.get(isbn)
        meta = metadata_map.get(isbn)

        offset = barcode_offsets.get(isbn, 0)
        barcodes = [f"LIB-{isbn}-{(offset + i + 1):03d}" for i in range(quantity)]

        if book:
            status_str = "exists"
        elif meta:
            status_str = "new"
        else:
            status_str = "warning"

        valid_rows += 1

        # Get metadata fields (prefer DB, fallback to API)
        title = book.title if book else (meta.get("title") if meta else f"ISBN: {isbn}")
        author = book.author if book else (meta.get("author") if meta else None)
        cover_url = book.cover_url if book else (meta.get("cover_url") if meta else None)
        subtitle = meta.get("subtitle") if meta else None
        publisher = meta.get("publisher") if meta else None
        published_date = meta.get("published_date") if meta else None
        description = meta.get("description") if meta else None
        page_count = meta.get("page_count") if meta else None
        categories = meta.get("categories") if meta else None

        preview_rows.append(BookImportPreviewRow(
            isbn=isbn,
            quantity=quantity,
            title=title,
            author=author,
            cover_url=cover_url,
            subtitle=subtitle,
            publisher=publisher,
            published_date=published_date,
            description=description,
            page_count=page_count,
            categories=categories,
            barcodes=barcodes,
            status=status_str,
            message="Không có metadata từ Google Books" if status_str == "warning" else None,
        ))

    return BookImportPreviewResponse(
        rows=preview_rows,
        total_rows=len(preview_rows),
        valid_rows=valid_rows,
        invalid_rows=invalid_rows,
    )


@router.post(
    "/books/import",
    response_model=BookImportResponse,
    responses={401: {"model": ErrorResponse}},
)
async def import_books(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chỉ hỗ trợ file Excel (.xlsx, .xls)")

    try:
        contents = await file.read()
        wb = load_workbook(io.BytesIO(contents), read_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không thể đọc file Excel")

    if len(rows) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File Excel trống hoặc không có dữ liệu")

    headers = [str(h).strip().upper() for h in rows[0]]
    isbn_idx = next((i for i, h in enumerate(headers) if "ISBN" in h), None)
    qty_idx = next((i for i, h in enumerate(headers) if "QUANTITY" in h or "SỐ LƯỢNG" in h or "QTY" in h), None)

    if isbn_idx is None or qty_idx is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File phải có cột 'ISBN' và 'Quantity'")

    repo = BorrowRepository(db)

    excel_rows = []
    for i, row in enumerate(rows[1:], start=2):
        isbn_val = str(row[isbn_idx]).strip() if isbn_idx < len(row) else ""
        qty_val = row[qty_idx] if qty_idx < len(row) else None
        if not isbn_val or isbn_val == "None":
            continue
        try:
            quantity = max(1, int(float(qty_val)) if qty_val and str(qty_val) != "None" else 1)
        except (ValueError, TypeError):
            quantity = 1
        excel_rows.append({"isbn": isbn_val, "quantity": quantity, "line": i})

    if not excel_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không có dữ liệu hợp lệ")

    isbn_list = [r["isbn"] for r in excel_rows]

    existing_books = await repo.get_books_by_isbns(isbn_list)

    isbns_needed = [r["isbn"] for r in excel_rows if r["isbn"] not in existing_books]

    metadata_map: dict[str, dict | None] = {}
    if isbns_needed:
        tasks = [_fetch_google_books(isbn) for isbn in isbns_needed]
        fetched = await asyncio.gather(*tasks, return_exceptions=True)
        for isbn, meta in zip(isbns_needed, fetched):
            if isinstance(meta, Exception):
                logger.warning("Google Books fetch failed for ISBN=%s: %s", isbn, meta)
                metadata_map[isbn] = None
            else:
                metadata_map[isbn] = meta

    barcode_offsets = await repo.get_barcode_offsets_by_books(list(existing_books.keys()))

    results: list[BookImportResultRow] = []
    imported = 0
    skipped = 0
    errors = 0

    new_books_map: dict[str, BookModel] = {}

    # Wrap import in a savepoint for atomic rollback on critical failure
    savepoint = await db.begin_nested()
    try:
        for row in excel_rows:
            isbn = row["isbn"]
            quantity = row["quantity"]
            line = row["line"]

            book = existing_books.get(isbn) or new_books_map.get(isbn)
            is_new_book = False
            no_metadata = False

            if not book:
                meta = metadata_map.get(isbn)
                if not meta:
                    no_metadata = True
                    try:
                        book, _ = await repo.upsert_book(
                            isbn=isbn,
                            title=f"ISBN: {isbn}",
                            author=None,
                            cover_url=None,
                        )
                        is_new_book = True
                        new_books_map[isbn] = book
                        barcode_offsets[isbn] = 0
                    except Exception as e:
                        errors += 1
                        results.append(BookImportResultRow(
                            isbn=isbn, title="", quantity=quantity, barcodes=[],
                            status="error", message=f"Dòng {line}: Lỗi tạo sách: {str(e)}"
                        ))
                        continue
                else:
                    try:
                        book, _ = await repo.upsert_book(
                            isbn=isbn,
                            title=meta.get("title", f"ISBN {isbn}"),
                            author=meta.get("author"),
                            cover_url=meta.get("cover_url"),
                        )
                        is_new_book = True
                        new_books_map[isbn] = book
                        barcode_offsets[isbn] = 0
                    except Exception as e:
                        errors += 1
                        results.append(BookImportResultRow(
                            isbn=isbn, title="", quantity=quantity, barcodes=[],
                            status="error", message=f"Lỗi tạo sách: {str(e)}"
                        ))
                        continue
            else:
                meta = metadata_map.get(isbn)
                if meta:
                    try:
                        await repo.update_book_metadata(book.id, meta.get("title"), meta.get("author"), meta.get("cover_url"))
                    except Exception:
                        pass

            offset = barcode_offsets.get(isbn, 0)
            barcodes = [f"LIB-{isbn}-{(offset + i + 1):03d}" for i in range(quantity)]
            barcode_offsets[isbn] = offset + quantity

            try:
                new_copies = await repo.create_copies_batch_with_skip(book.id, barcodes, shelf_location=book.shelf_location)
                actual_added = len(new_copies)
                skipped_barcodes = quantity - actual_added

                if is_new_book:
                    imported += 1
                    if no_metadata:
                        status_str = "warning"
                    else:
                        status_str = "imported"
                elif actual_added > 0:
                    imported += 1
                    status_str = "updated"
                else:
                    skipped += 1
                    status_str = "skipped"

                msg = f"Thêm {actual_added} bản sao"
                if skipped_barcodes > 0:
                    msg += f", {skipped_barcodes} trùng"
                if no_metadata:
                    msg += " (không có metadata từ OpenLibrary)"

                results.append(BookImportResultRow(
                    isbn=isbn,
                    title=book.title,
                    quantity=quantity,
                    barcodes=barcodes,
                    status=status_str,
                    message=msg,
                ))
            except Exception as e:
                errors += 1
                results.append(BookImportResultRow(
                    isbn=isbn, title=book.title, quantity=quantity, barcodes=barcodes,
                    status="error", message=f"Lỗi: {str(e)}"
                ))

    except Exception:
        await savepoint.rollback()
        logger.error("Import failed, all changes rolled back")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Import thất bại, toàn bộ thay đổi đã được rollback",
        )
    else:
        await savepoint.commit()

    return BookImportResponse(
        success=errors == 0,
        total_rows=len(excel_rows),
        imported=imported,
        skipped=skipped,
        errors=errors,
        results=results,
    )


@router.get(
    "/barcodes",
    response_model=list[dict],
    responses={401: {"model": ErrorResponse}},
)
async def list_barcodes(
    book_id: str | None = None,
    available_only: bool = False,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    query = select(BookCopyModel).join(BookModel).order_by(BookCopyModel.created_at.desc()).limit(200)
    if book_id:
        query = query.where(BookCopyModel.book_id == uuid.UUID(book_id))
    if available_only:
        query = query.where(BookCopyModel.is_available == True)
    result = await repo.db.execute(query)
    copies = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "book_id": str(c.book_id),
            "barcode": c.barcode,
            "is_available": c.is_available,
            "shelf_location": c.shelf_location,
        }
        for c in copies
    ]


@router.put(
    "/books/{book_id}/quantity",
    response_model=BookWithStatsResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Quantity too low"},
        404: {"model": ErrorResponse, "description": "Book not found"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def update_book_quantity(
    book_id: uuid.UUID,
    body: UpdateBookQuantityRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    book = await repo.get_book_by_id(book_id)
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sách")

    current_total = await repo.count_total_copies(book_id)
    current_available = await repo.count_available_copies(book_id)
    currently_borrowed = current_total - current_available
    new_qty = body.quantity

    if new_qty < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Số lượng phải lớn hơn 0")

    if new_qty < currently_borrowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chỉ có thể giảm xuống tối thiểu {currently_borrowed} bản ({currently_borrowed} bản đang được mượn)",
        )

    if new_qty > current_total:
        diff = new_qty - current_total
        offset = await repo.get_max_barcode_number_for_book(book.id)
        new_barcodes = [f"LIB-{book.isbn}-{(offset + i + 1):03d}" for i in range(diff)]
        await repo.create_copies_batch_with_skip(book.id, new_barcodes)

    elif new_qty < current_total:
        diff = current_total - new_qty
        available_copies = await repo.get_available_copies_by_barcode_desc(book.id)
        to_delete = available_copies[:diff]
        await repo.delete_copies(to_delete)

    total_copies = await repo.count_total_copies(book_id)
    available_copies = await repo.count_available_copies(book_id)

    return BookWithStatsResponse(
        id=book.id,
        isbn=book.isbn,
        title=book.title,
        author=book.author,
        cover_url=book.cover_url,
        shelf_location=book.shelf_location,
        total_copies=total_copies,
        available_copies=available_copies,
        created_at=book.created_at,
    )


@router.post(
    "/books/delete",
    response_model=BulkDeleteResponse,
    responses={401: {"model": ErrorResponse}},
)
async def delete_books(
    request: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    """Delete multiple books by IDs."""
    repo = BorrowRepository(db)
    deleted = 0
    errors: list[str] = []

    for book_id in request.book_ids:
        try:
            book = await repo.get_book_by_id(book_id)
            if not book:
                errors.append(f"Sách ID {book_id} không tồn tại")
                continue

            # Check if copies are borrowed - cannot delete if any are on loan
            if book.available_copies < book.total_copies:
                errors.append(f"Sách '{book.title}' đang được mượn, không thể xóa")
                continue

            # Delete book (cascades to copies)
            await repo.delete_book(book)
            deleted += 1
        except Exception as e:
            logger.error("Delete book failed for ID=%s: %s", book_id, e)
            errors.append(f"Sách ID {book_id}: {str(e)}")

    await db.commit()
    return BulkDeleteResponse(
        deleted=deleted,
        errors=errors,
        success=deleted > 0 and len(errors) == 0,
    )
