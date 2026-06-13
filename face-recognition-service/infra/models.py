from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from infra.database import Base


class PatronModel(Base):
    __tablename__ = "patrons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name = Column(String(255), nullable=False)
    student_code = Column(String(50), unique=True, nullable=False, index=True)
    class_name = Column(String(100), nullable=True)
    identity_number = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    card_number = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    issue_date = Column(Date, nullable=True)
    membership_expiry = Column(Date, nullable=False)
    status = Column(String(20), default="active", nullable=False)
    current_status = Column(String(10), default="outside", nullable=False)
    last_entry_at = Column(DateTime, nullable=True)
    last_entry_camera = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PatronFaceModel(Base):
    __tablename__ = "patron_faces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patron_id = Column(UUID(as_uuid=True), ForeignKey("patrons.id"), nullable=False)
    angle = Column(String(20), default="frontal", nullable=False)
    milvus_id = Column(String(100), nullable=True)
    image_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AccessLogModel(Base):
    __tablename__ = "access_logs"
    __table_args__ = (
        Index('idx_patron_access_time', 'patron_id', 'access_time'),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patron_id = Column(UUID(as_uuid=True), ForeignKey("patrons.id"), nullable=True)
    access_type = Column(String(10), nullable=False)
    verify_method = Column(String(20), nullable=False)
    confidence = Column(Float, nullable=True)
    camera_id = Column(String(50), nullable=False)
    image_url = Column(Text, nullable=True)
    access_time = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), nullable=False)
