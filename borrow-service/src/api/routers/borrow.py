from __future__ import annotations

import os
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import get_current_user
from src.infra.database import get_db_session
from src.infra.models import BookModel
from src.infra.repository import BorrowRepository
from src.lib.schemas import (
    BorrowRequest,
    BorrowResponse,
    BorrowRecordResponse,
    BookResponse,
    ReturnRequest,
    ReturnResponse,
    PatronStatusResponse,
    ErrorResponse,
)
from src.config import settings

FACE_RECOGNITION_API = os.getenv("FACE_RECOGNITION_API", "http://face-recognition-api:8000")

router = APIRouter(prefix="/borrow", tags=["borrow"])


async def _check_patron_inside(patron_id: str, authorization: str | None) -> bool:
    if not authorization or not authorization.startswith("Bearer "):
        return False
    token = authorization[7:]
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{FACE_RECOGNITION_API}/patrons/{patron_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                return False
            data = resp.json()
            current_status = data.get("current_status")
            return current_status == "inside"
    except Exception:
        return False


async def _get_or_create_book(db: AsyncSession, repo: BorrowRepository, isbn: str) -> BookModel:
    book = await repo.get_book_by_isbn(isbn)
    if book:
        return book
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"https://openlibrary.org/api/books",
                params={
                    "bibkeys": f"ISBN:{isbn}",
                    "format": "json",
                    "jscmd": "data",
                },
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
                return book
        except Exception:
            pass
    book = await repo.create_book(isbn, f"ISBN {isbn}")
    return book


@router.post(
    "/",
    response_model=BorrowResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        403: {"model": ErrorResponse, "description": "Patron not inside library"},
        404: {"model": ErrorResponse, "description": "Book not found"},
        409: {"model": ErrorResponse, "description": "Book already borrowed"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def borrow_book(
    body: BorrowRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    patron_id = current_user["id"]
    isbn = body.isbn.strip()
    patron_uuid = uuid.UUID(patron_id)

    authorization = request.headers.get("authorization")
    is_inside = await _check_patron_inside(patron_id, authorization)
    if not is_inside:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn phải có mặt trong thư viện để mượn sách. Vui lòng quét thẻ tại cửa vào.",
        )

    repo = BorrowRepository(db)
    book = await _get_or_create_book(db, repo, isbn)
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sách")

    if not book.is_available:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Sách này hiện đang được mượn bởi người khác",
        )

    existing = await repo.get_active_borrow(patron_uuid, book.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bạn đã mượn sách này và chưa trả",
        )

    await repo.mark_book_unavailable(book)
    record = await repo.create_borrow_record(patron_uuid, book.id, shelf_location=book.shelf_location)

    return BorrowResponse(
        status="success",
        message=f"Mượn sách thành công. Vui lòng trả trước ngày {record.due_at.strftime('%d/%m/%Y')}.",
        record=BorrowRecordResponse.model_validate(record),
        book=BookResponse.model_validate(book),
    )


@router.post(
    "/return",
    response_model=ReturnResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Bad request"},
        404: {"model": ErrorResponse, "description": "No active borrow record found"},
        401: {"model": ErrorResponse, "description": "Unauthorized"},
    },
)
async def return_book(
    body: ReturnRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
):
    patron_id = current_user["id"]
    isbn = body.isbn.strip()
    patron_uuid = uuid.UUID(patron_id)

    repo = BorrowRepository(db)
    book = await repo.get_book_by_isbn(isbn)
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sách trong hệ thống")

    record = await repo.get_active_borrow(patron_uuid, book.id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bạn không có bản ghi mượn sách nào đang hoạt động cho cuốn sách này",
        )

    await repo.return_book(record)
    await repo.mark_book_available(book)

    return ReturnResponse(
        status="success",
        message="Trả sách thành công. Cảm ơn bạn đã sử dụng thư viện!",
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