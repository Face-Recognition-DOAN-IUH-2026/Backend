from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID

from infra.database import Base


class PatronFaceModel(Base):
    __tablename__ = "patron_faces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patron_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    angle = Column(String(20), default="frontal", nullable=False)
    milvus_id = Column(String(100), nullable=True)
    image_url = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
