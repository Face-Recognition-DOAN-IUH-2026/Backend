from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from src.infra.database import Base


class BookModel(Base):
    __tablename__ = "books"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    isbn = Column(String(20), unique=True, nullable=False, index=True)
    title = Column(String(500), nullable=False)
    author = Column(String(255), nullable=True)
    cover_url = Column(Text, nullable=True)
    is_available = Column(Boolean, default=True, nullable=False)
    shelf_location = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    copies = relationship("BookCopyModel", back_populates="book", lazy="selectin")


class BookCopyModel(Base):
    __tablename__ = "book_copies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False, index=True)
    barcode = Column(String(50), unique=True, nullable=False, index=True)
    is_available = Column(Boolean, default=True, nullable=False)
    shelf_location = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    book = relationship("BookModel", back_populates="copies", lazy="selectin")


class BorrowRecordModel(Base):
    __tablename__ = "borrow_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patron_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    book_id = Column(UUID(as_uuid=True), ForeignKey("books.id"), nullable=False)
    copy_id = Column(UUID(as_uuid=True), ForeignKey("book_copies.id"), nullable=True)
    borrow_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    return_at = Column(DateTime, nullable=True)
    due_at = Column(DateTime, nullable=False)
    shelf_location = Column(String(100), nullable=True)
    status = Column(String(20), default="borrowed", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    book = relationship("BookModel", lazy="selectin")
    copy = relationship("BookCopyModel", lazy="selectin")