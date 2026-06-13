from __future__ import annotations

import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import get_current_user
from src.infra.database import get_db_session
from src.infra.models import BookModel, BookCopyModel
from src.infra.repository import BorrowRepository
from src.lib.schemas import (
    BorrowRequest,
    BorrowResponse,
    BorrowRecordResponse,
    BookResponse,
    StaffReturnRequest,
    ReturnResponse,
    ErrorResponse,
)
from src.config import settings

router = APIRouter(prefix="/borrow", tags=["borrow"])


async def _check_patron_inside(user_id: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            headers = {}
            if settings.internal_api_key:
                headers["X-Internal-Api-Key"] = settings.internal_api_key
            resp = await client.get(
                f"{settings.user_service_url}/users/{user_id}",
                headers=headers,
            )
            if resp.status_code != 200:
                return False
            data = resp.json()
            return data.get("currentStatus") == "inside" or data.get("current_status") == "inside"
    except Exception:
        return False


async def _get_or_create_book_and_copy(repo: BorrowRepository, barcode: str, isbn: str | None = None) -> tuple[BookModel, BookCopyModel]:
    copy = await repo.get_copy_by_barcode(barcode)
    if copy:
        book = await repo.get_book_by_id(copy.book_id)
        return book, copy

    book = None
    if isbn:
        book = await repo.get_book_by_isbn(isbn)

    if not book:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(
                    f"https://openlibrary.org/api/books",
                    params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    book_data = data.get(f"ISBN:{isbn}", {})
                    title = book_data.get("title", f"ISBN {isbn}")
                    authors = book_data.get("authors", [])
                    author = authors[0]["name"] if authors else None
                    cover = None
                    if book_data.get("cover"):
                        cover = book_data.get("cover", {}).get("medium") or book_data.get("cover", {}).get("small")
                    book = await repo.create_book(isbn, title, author=author, cover_url=cover)
            except Exception:
                pass

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
    user_id = current_user["id"]
    barcode = body.barcode.strip()
    patron_uuid = uuid.UUID(user_id)

    is_inside = await _check_patron_inside(user_id)
    if not is_inside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn phải có mặt trong thư viện để mượn sách. Vui lòng quét thẻ tại cửa vào.",
        )

    repo = BorrowRepository(db)

    copy = await repo.get_copy_by_barcode(barcode)

    if copy:
        book = await repo.get_book_by_id(copy.book_id)
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sách")
        if not copy.is_available:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bản sao này hiện đang được mượn",
            )
    elif body.isbn or (barcode.isdigit() and len(barcode) in (10, 13)):
        lookup_isbn = body.isbn or barcode
        book = await repo.get_book_by_isbn(lookup_isbn)
        if not book:
            book, copy = await _get_or_create_book_and_copy(repo, barcode, isbn=lookup_isbn)
        else:
            copy = await repo.get_available_copy(book.id)
            if not copy:
                copy = await repo.create_copy(book.id, barcode, shelf_location=book.shelf_location)
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy bản sao nào với mã vạch {barcode}",
        )

    existing = await repo.get_active_borrow(patron_uuid, book.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bạn đã mượn sách này và chưa trả",
        )

    overdue = await repo.get_overdue_borrows(patron_uuid)
    if overdue:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bạn có sách quá hạn chưa trả. Vui lòng trả sách trước khi mượn thêm.",
        )

    active_count = await repo.get_active_borrow_count(patron_uuid)
    if active_count >= settings.max_borrow_books:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bạn đã mượn tối đa {settings.max_borrow_books} cuốn. Vui lòng trả sách trước khi mượn thêm.",
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
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    copy = await repo.get_copy_by_barcode(barcode.strip())
    if not copy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Không tìm thấy bản sao với mã vạch {barcode}")
    record = await repo.get_active_borrow_by_copy(copy.id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bản sao này hiện không được mượn")
    return BorrowRecordResponse.model_validate(record)


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
    role = current_user.get("role", "")
    if role != "staff":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ nhân viên thư viện mới có thể trả sách",
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

    await repo.return_book(record)
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
    "/books",
    response_model=list[BookResponse],
    responses={401: {"model": ErrorResponse}},
)
async def list_books(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    books = await repo.get_all_books(skip=skip, limit=limit)
    return [BookResponse.model_validate(b) for b in books]


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
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(
                    "https://openlibrary.org/api/books",
                    params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    book_data = data.get(f"ISBN:{isbn}", {})
                    title = book_data.get("title", f"ISBN {isbn}")
                    authors = book_data.get("authors", [])
                    author = authors[0]["name"] if authors else None
                    cover = book_data.get("cover", {}).get("medium") if book_data.get("cover") else None
                    book = await repo.create_book(isbn, title, author=author, cover_url=cover)
                    return BookResponse.model_validate(book)
            except Exception:
                pass
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sách")
    return BookResponse.model_validate(book)


@router.post(
    "/book",
    response_model=BookResponse,
    responses={400: {"model": ErrorResponse}},
)
async def add_book(
    isbn: str,
    title: str,
    author: str | None = None,
    shelf_location: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    _: dict = Depends(get_current_user),
):
    repo = BorrowRepository(db)
    existing = await repo.get_book_by_isbn(isbn)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sách đã tồn tại trong hệ thống")
    book = await repo.create_book(isbn, title, author=author, shelf_location=shelf_location)
    return BookResponse.model_validate(book)