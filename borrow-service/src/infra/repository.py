from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.infra.models import BookModel, BookCopyModel, BorrowRecordModel
from src.config import settings


class BorrowRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_book_by_isbn(self, isbn: str) -> Optional[BookModel]:
        result = await self.db.execute(
            select(BookModel).where(BookModel.isbn == isbn)
        )
        return result.scalar_one_or_none()

    async def get_book_by_id(self, book_id: uuid.UUID) -> Optional[BookModel]:
        result = await self.db.execute(
            select(BookModel).where(BookModel.id == book_id)
        )
        return result.scalar_one_or_none()

    async def create_book(self, isbn: str, title: str, author: str | None = None, cover_url: str | None = None, shelf_location: str | None = None) -> BookModel:
        book = BookModel(
            isbn=isbn,
            title=title,
            author=author,
            cover_url=cover_url,
            shelf_location=shelf_location,
        )
        self.db.add(book)
        await self.db.commit()
        await self.db.refresh(book)
        return book

    async def get_copy_by_barcode(self, barcode: str) -> Optional[BookCopyModel]:
        result = await self.db.execute(
            select(BookCopyModel).where(BookCopyModel.barcode == barcode)
        )
        return result.scalar_one_or_none()

    async def create_copy(self, book_id: uuid.UUID, barcode: str, shelf_location: str | None = None) -> BookCopyModel:
        copy = BookCopyModel(
            book_id=book_id,
            barcode=barcode,
            is_available=True,
            shelf_location=shelf_location,
        )
        self.db.add(copy)
        await self.db.commit()
        await self.db.refresh(copy)
        return copy

    async def get_all_copies(self, book_id: uuid.UUID) -> list[BookCopyModel]:
        result = await self.db.execute(
            select(BookCopyModel).where(BookCopyModel.book_id == book_id)
        )
        return list(result.scalars().all())

    async def get_available_copy(self, book_id: uuid.UUID) -> Optional[BookCopyModel]:
        result = await self.db.execute(
            select(BookCopyModel).where(
                and_(
                    BookCopyModel.book_id == book_id,
                    BookCopyModel.is_available == True,
                )
            ).limit(1)
        )
        return result.scalar_one_or_none()

    async def mark_copy_unavailable(self, copy: BookCopyModel):
        copy.is_available = False
        await self.db.commit()

    async def mark_copy_available(self, copy: BookCopyModel):
        copy.is_available = True
        await self.db.commit()

    async def get_active_borrow(self, patron_id: uuid.UUID, book_id: uuid.UUID) -> Optional[BorrowRecordModel]:
        result = await self.db.execute(
            select(BorrowRecordModel).where(
                and_(
                    BorrowRecordModel.patron_id == patron_id,
                    BorrowRecordModel.book_id == book_id,
                    BorrowRecordModel.status == "borrowed",
                    BorrowRecordModel.return_at.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_active_borrow_by_copy(self, copy_id: uuid.UUID) -> Optional[BorrowRecordModel]:
        result = await self.db.execute(
            select(BorrowRecordModel).where(
                and_(
                    BorrowRecordModel.copy_id == copy_id,
                    BorrowRecordModel.status == "borrowed",
                    BorrowRecordModel.return_at.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_active_borrow_count(self, patron_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count(BorrowRecordModel.id)).where(
                and_(
                    BorrowRecordModel.patron_id == patron_id,
                    BorrowRecordModel.status == "borrowed",
                    BorrowRecordModel.return_at.is_(None),
                )
            )
        )
        return result.scalar() or 0

    async def get_overdue_borrows(self, patron_id: uuid.UUID) -> list[BorrowRecordModel]:
        now = datetime.utcnow()
        result = await self.db.execute(
            select(BorrowRecordModel).where(
                and_(
                    BorrowRecordModel.patron_id == patron_id,
                    BorrowRecordModel.status == "borrowed",
                    BorrowRecordModel.return_at.is_(None),
                    BorrowRecordModel.due_at < now,
                )
            )
        )
        return list(result.scalars().all())

    async def get_borrows_by_patron(self, patron_id: uuid.UUID, status: str | None = None) -> list[BorrowRecordModel]:
        query = select(BorrowRecordModel).where(BorrowRecordModel.patron_id == patron_id)
        if status:
            query = query.where(BorrowRecordModel.status == status)
        query = query.order_by(BorrowRecordModel.borrow_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_borrow_record(
        self,
        patron_id: uuid.UUID,
        book_id: uuid.UUID,
        copy_id: uuid.UUID | None = None,
        shelf_location: str | None = None,
    ) -> BorrowRecordModel:
        due_at = datetime.utcnow() + timedelta(days=settings.max_borrow_days)
        record = BorrowRecordModel(
            patron_id=patron_id,
            book_id=book_id,
            copy_id=copy_id,
            borrow_at=datetime.utcnow(),
            due_at=due_at,
            shelf_location=shelf_location,
            status="borrowed",
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def return_book(self, record: BorrowRecordModel) -> BorrowRecordModel:
        record.return_at = datetime.utcnow()
        record.status = "returned"
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def get_all_books(self, skip: int = 0, limit: int = 50) -> list[BookModel]:
        result = await self.db.execute(
            select(BookModel).offset(skip).limit(limit).order_by(BookModel.created_at.desc())
        )
        return list(result.scalars().all())

    async def count_available_copies(self, book_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count(BookCopyModel.id)).where(
                and_(
                    BookCopyModel.book_id == book_id,
                    BookCopyModel.is_available == True,
                )
            )
        )
        return result.scalar() or 0