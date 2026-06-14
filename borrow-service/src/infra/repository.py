from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import case, select, and_, or_, func
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

    async def get_books_with_stats(self, skip: int = 0, limit: int = 20, search: str | None = None) -> tuple[list[BookModel], int, dict[uuid.UUID, tuple[int, int]]]:
        base_query = select(BookModel)
        count_query = select(func.count(BookModel.id))
        if search:
            pattern = f"%{search}%"
            base_query = base_query.where(
                BookModel.isbn.ilike(pattern)
                | BookModel.title.ilike(pattern)
                | BookModel.author.ilike(pattern)
            )
            count_query = count_query.where(
                BookModel.isbn.ilike(pattern)
                | BookModel.title.ilike(pattern)
                | BookModel.author.ilike(pattern)
            )
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        result = await self.db.execute(
            base_query.offset(skip).limit(limit).order_by(BookModel.created_at.desc())
        )
        books = list(result.scalars().all())

        if not books:
            return books, total, {}

        book_ids = [b.id for b in books]
        stats_query = select(
            BookCopyModel.book_id,
            func.count(BookCopyModel.id),
            func.sum(case((BookCopyModel.is_available == True, 1), else_=0)),
        ).where(BookCopyModel.book_id.in_(book_ids)).group_by(BookCopyModel.book_id)
        stats_result = await self.db.execute(stats_query)
        stats_map: dict[uuid.UUID, tuple[int, int]] = {}
        for row in stats_result:
            stats_map[row[0]] = (row[1], row[2] or 0)
        return books, total, stats_map

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

    async def count_total_copies(self, book_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.count(BookCopyModel.id)).where(
                BookCopyModel.book_id == book_id,
            )
        )
        return result.scalar() or 0

    async def search_books(self, query: str, skip: int = 0, limit: int = 20) -> list[BookModel]:
        pattern = f"%{query}%"
        result = await self.db.execute(
            select(BookModel).where(
                or_(
                    BookModel.isbn.ilike(pattern),
                    BookModel.title.ilike(pattern),
                    BookModel.author.ilike(pattern),
                )
            ).offset(skip).limit(limit).order_by(BookModel.created_at.desc())
        )
        return list(result.scalars().all())

    async def count_books(self) -> int:
        result = await self.db.execute(select(func.count(BookModel.id)))
        return result.scalar() or 0

    async def upsert_book(self, isbn: str, title: str, author: str | None = None, cover_url: str | None = None, shelf_location: str | None = None) -> tuple[BookModel, bool]:
        existing = await self.get_book_by_isbn(isbn)
        if existing:
            if title and title != existing.title:
                existing.title = title
            if author is not None and author != existing.author:
                existing.author = author
            if cover_url is not None and cover_url != existing.cover_url:
                existing.cover_url = cover_url
            await self.db.commit()
            await self.db.refresh(existing)
            return existing, False
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
        return book, True

    async def get_books_by_isbns(self, isbns: list[str]) -> dict[str, BookModel]:
        if not isbns:
            return {}
        result = await self.db.execute(
            select(BookModel).where(BookModel.isbn.in_(isbns))
        )
        books = result.scalars().all()
        return {b.isbn: b for b in books}

    async def update_book_metadata(self, book_id: uuid.UUID, title: str | None, author: str | None, cover_url: str | None):
        result = await self.db.execute(
            select(BookModel).where(BookModel.id == book_id)
        )
        book = result.scalar_one_or_none()
        if not book:
            return
        if title and title != book.title:
            book.title = title
        if author is not None and author != book.author:
            book.author = author
        if cover_url is not None and cover_url != book.cover_url:
            book.cover_url = cover_url
        await self.db.commit()

    async def get_barcode_offsets_by_books(self, isbns: list[str]) -> dict[str, int]:
        if not isbns:
            return {}
        result = await self.db.execute(
            select(BookModel.isbn, func.max(BookCopyModel.barcode))
            .join(BookCopyModel, BookCopyModel.book_id == BookModel.id)
            .where(
                and_(
                    BookModel.isbn.in_(isbns),
                    BookCopyModel.barcode.like("LIB-%"),
                )
            )
            .group_by(BookModel.isbn)
        )
        rows = result.all()
        offsets: dict[str, int] = {}
        for isbn, max_barcode in rows:
            if max_barcode:
                parts = max_barcode.rsplit("-", 1)
                if len(parts) == 2 and parts[1].isdigit():
                    offsets[isbn] = int(parts[1])
        return offsets

    async def create_copies_batch_with_skip(self, book_id: uuid.UUID, barcodes: list[str], shelf_location: str | None = None) -> list[BookCopyModel]:
        inserted = []
        for bc in barcodes:
            existing = await self.get_copy_by_barcode(bc)
            if existing:
                continue
            copy = BookCopyModel(
                book_id=book_id,
                barcode=bc,
                is_available=True,
                shelf_location=shelf_location,
            )
            self.db.add(copy)
            inserted.append(copy)
        if inserted:
            await self.db.flush()
            for c in inserted:
                await self.db.refresh(c)
        return inserted

    async def create_copies_batch(self, book_id: uuid.UUID, barcodes: list[str], shelf_location: str | None = None) -> list[BookCopyModel]:
        copies = [
            BookCopyModel(
                book_id=book_id,
                barcode=bc,
                is_available=True,
                shelf_location=shelf_location,
            )
            for bc in barcodes
        ]
        self.db.add_all(copies)
        await self.db.commit()
        for c in copies:
            await self.db.refresh(c)
        return copies

    async def get_available_copies_by_barcode_desc(self, book_id: uuid.UUID) -> list[BookCopyModel]:
        result = await self.db.execute(
            select(BookCopyModel).where(
                and_(
                    BookCopyModel.book_id == book_id,
                    BookCopyModel.is_available == True,
                )
            ).order_by(BookCopyModel.barcode.desc())
        )
        return list(result.scalars().all())

    async def delete_copies(self, copies: list[BookCopyModel]):
        for c in copies:
            await self.db.delete(c)
        await self.db.commit()

    async def get_max_barcode_number_for_book(self, book_id: uuid.UUID) -> int:
        result = await self.db.execute(
            select(func.max(BookCopyModel.barcode)).where(
                and_(
                    BookCopyModel.book_id == book_id,
                    BookCopyModel.barcode.like("LIB-%"),
                )
            )
        )
        max_bc = result.scalar()
        if max_bc:
            parts = max_bc.rsplit("-", 1)
            if len(parts) == 2 and parts[1].isdigit():
                return int(parts[1])
        return 0