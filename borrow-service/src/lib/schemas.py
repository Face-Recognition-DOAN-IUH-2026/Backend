from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BorrowRequest(BaseModel):
    barcode: str
    isbn: str | None = None


class StaffReturnRequest(BaseModel):
    barcode: str


class BookCopyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    book_id: UUID
    barcode: str
    is_available: bool
    shelf_location: str | None = None


class BookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    isbn: str
    title: str
    author: str | None = None
    cover_url: str | None = None
    shelf_location: str | None = None
    copies: list[BookCopyResponse] = []


class BorrowRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patron_id: UUID
    book_id: UUID
    copy_id: UUID | None = None
    borrow_at: datetime
    due_at: datetime
    return_at: datetime | None = None
    shelf_location: str | None = None
    status: str


class BorrowResponse(BaseModel):
    status: str
    message: str
    record: BorrowRecordResponse | None = None
    book: BookResponse | None = None


class ReturnResponse(BaseModel):
    status: str
    message: str
    record: BorrowRecordResponse | None = None


class PatronStatusResponse(BaseModel):
    patron_id: str
    current_status: str
    is_valid: bool


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


class HealthResponse(BaseModel):
    status: str
    service: str
    db_ok: bool