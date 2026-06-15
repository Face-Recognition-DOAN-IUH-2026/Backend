from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infra.models import PatronFaceModel


class PatronRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_active_face(self, user_id: uuid.UUID) -> Optional[PatronFaceModel]:
        result = await self.db.execute(
            select(PatronFaceModel).where(
                PatronFaceModel.patron_id == user_id,
                PatronFaceModel.is_active == True,
            )
            .order_by(PatronFaceModel.created_at.asc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_active_faces(self, user_id: uuid.UUID) -> list[PatronFaceModel]:
        result = await self.db.execute(
            select(PatronFaceModel).where(
                PatronFaceModel.patron_id == user_id,
                PatronFaceModel.is_active == True,
            )
            .order_by(PatronFaceModel.created_at.asc())
        )
        return list(result.scalars().all())

    async def get_face_by_angle(self, user_id: uuid.UUID, angle: str) -> Optional[PatronFaceModel]:
        result = await self.db.execute(
            select(PatronFaceModel).where(
                PatronFaceModel.patron_id == user_id,
                PatronFaceModel.angle == angle,
                PatronFaceModel.is_active == True,
            )
        )
        return result.scalar_one_or_none()

    async def add_face(
        self,
        user_id: uuid.UUID,
        angle: str = "frontal",
        milvus_id: Optional[str] = None,
        image_url: Optional[str] = None,
    ) -> PatronFaceModel:
        face = PatronFaceModel(
            id=uuid.uuid4(),
            patron_id=user_id,
            angle=angle,
            milvus_id=milvus_id,
            image_url=image_url,
            is_active=True,
        )
        self.db.add(face)
        await self.db.flush()
        return face
