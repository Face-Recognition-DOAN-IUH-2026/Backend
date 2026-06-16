from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class BorrowRequest(BaseModel):
    barcode: str
    isbn: str | None = None


class StaffReturnRequest(BaseModel):
    barcode: str
    note: str | None = None


class StaffReturnByPatronRequest(BaseModel):
    student_code: str
    barcode_or_isbn: str
    note: str | None = None


class StaffReturnRecordRequest(BaseModel):
    note: str | None = None


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
    returned_by_user_id: UUID | None = None
    returned_by_email: str | None = None
    return_method: str | None = None
    note: str | None = None
    book: BookResponse | None = None


class StaffPatronSummary(BaseModel):
    id: UUID
    full_name: str | None = None
    student_code: str
    email: str | None = None
    card_number: str | None = None
    current_status: str | None = None


class StaffPatronActiveBorrowsResponse(BaseModel):
    patron: StaffPatronSummary
    records: list[BorrowRecordResponse]
    total: int
    overdue_count: int


class StaffActiveBorrowerSummary(BaseModel):
    patron: StaffPatronSummary
    total_borrowed: int
    overdue_count: int
    latest_borrow_at: datetime
    nearest_due_at: datetime


class StaffActiveBorrowersResponse(BaseModel):
    items: list[StaffActiveBorrowerSummary]
    total: int


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


class BookWithStatsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    isbn: str
    title: str
    author: str | None = None
    cover_url: str | None = None
    shelf_location: str | None = None
    total_copies: int = 0
    available_copies: int = 0
    created_at: datetime


class BooksListResponse(BaseModel):
    items: list[BookWithStatsResponse]
    total: int
    skip: int
    limit: int


class BookImportPreviewRow(BaseModel):
    isbn: str
    quantity: int
    title: str | None = None
    author: str | None = None
    cover_url: str | None = None
    barcodes: list[str] = []
    status: str = "pending"
    message: str | None = None


class BookImportPreviewResponse(BaseModel):
    rows: list[BookImportPreviewRow]
    total_rows: int
    valid_rows: int
    invalid_rows: int


class BookImportResultRow(BaseModel):
    isbn: str
    title: str
    quantity: int
    barcodes: list[str]
    status: str
    message: str | None = None


class BookImportResponse(BaseModel):
    success: bool
    total_rows: int
    imported: int
    skipped: int
    errors: int
    results: list[BookImportResultRow]


class UpdateBookQuantityRequest(BaseModel):
    quantity: int
