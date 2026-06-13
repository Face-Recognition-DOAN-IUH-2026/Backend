from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.infra.models import BookModel, BorrowRecordModel
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
            is_available=True,
        )
        self.db.add(book)
        await self.db.commit()
        await self.db.refresh(book)
        return book

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
        shelf_location: str | None = None,
    ) -> BorrowRecordModel:
        due_at = datetime.utcnow() + timedelta(days=settings.max_borrow_days)
        record = BorrowRecordModel(
            patron_id=patron_id,
            book_id=book_id,
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

    async def mark_book_unavailable(self, book: BookModel):
        book.is_available = False
        await self.db.commit()

    async def mark_book_available(self, book: BookModel):
        book.is_available = True
        await self.db.commit()

    async def get_all_books(self, skip: int = 0, limit: int = 50) -> list[BookModel]:
        result = await self.db.execute(
            select(BookModel).offset(skip).limit(limit).order_by(BookModel.created_at.desc())
        )
        return list(result.scalars().all())

    async def count_available(self) -> int:
        result = await self.db.execute(
            select(BookModel).where(BookModel.is_available == True)
        )
        return len(list(result.scalars().all()))