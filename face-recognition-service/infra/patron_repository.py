from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from infra.models import AccessLogModel, PatronFaceModel, PatronModel


class PatronRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_patron(
        self,
        full_name: str,
        student_code: str,
        card_number: str,
        membership_expiry: date,
        identity_number: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        issue_date: Optional[date] = None,
    ) -> PatronModel:
        patron = PatronModel(
            id=uuid.uuid4(),
            full_name=full_name,
            student_code=student_code,
            card_number=card_number,
            membership_expiry=membership_expiry,
            identity_number=identity_number,
            email=email,
            phone=phone,
            issue_date=issue_date or date.today(),
            status="active",
        )
        self.db.add(patron)
        await self.db.flush()
        return patron

    async def get_by_id(self, patron_id: uuid.UUID) -> Optional[PatronModel]:
        result = await self.db.execute(select(PatronModel).where(PatronModel.id == patron_id))
        return result.scalar_one_or_none()

    async def get_by_student_code(self, code: str) -> Optional[PatronModel]:
        result = await self.db.execute(select(PatronModel).where(PatronModel.student_code == code))
        return result.scalar_one_or_none()

    async def get_by_card_number(self, card: str) -> Optional[PatronModel]:
        result = await self.db.execute(select(PatronModel).where(PatronModel.card_number == card))
        return result.scalar_one_or_none()

    async def search(
        self,
        query: Optional[str] = None,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 20,
    ) -> List[PatronModel]:
        q = select(PatronModel)
        if query:
            pattern = f"%{query}%"
            q = q.where(
                PatronModel.full_name.ilike(pattern)
                | PatronModel.student_code.ilike(pattern)
                | PatronModel.card_number.ilike(pattern)
                | PatronModel.identity_number.ilike(pattern)
            )
        if status:
            q = q.where(PatronModel.status == status)
        q = q.order_by(PatronModel.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def count_active(self) -> int:
        result = await self.db.execute(
            select(func.count(PatronModel.id)).where(PatronModel.status == "active")
        )
        return result.scalar() or 0

    async def update_patron(self, patron_id: uuid.UUID, **kwargs) -> Optional[PatronModel]:
        patron = await self.get_by_id(patron_id)
        if not patron:
            return None
        for key, value in kwargs.items():
            if hasattr(patron, key) and value is not None:
                setattr(patron, key, value)
        patron.updated_at = datetime.utcnow()
        await self.db.flush()
        return patron

    async def delete_patron(self, patron_id: uuid.UUID) -> bool:
        patron = await self.get_by_id(patron_id)
        if not patron:
            return False
        await self.db.delete(patron)
        await self.db.flush()
        return True

    async def get_active_face(self, patron_id: uuid.UUID) -> Optional[PatronFaceModel]:
        result = await self.db.execute(
            select(PatronFaceModel).where(
                PatronFaceModel.patron_id == patron_id,
                PatronFaceModel.is_active == True,
            )
        )
        return result.scalar_one_or_none()

    async def upsert_face(
        self,
        patron_id: uuid.UUID,
        milvus_id: Optional[str] = None,
        image_url: Optional[str] = None,
    ) -> PatronFaceModel:
        existing = await self.get_active_face(patron_id)
        if existing:
            existing.milvus_id = milvus_id or existing.milvus_id
            existing.image_url = image_url or existing.image_url
            existing.updated_at = datetime.utcnow()
            return existing
        face = PatronFaceModel(
            id=uuid.uuid4(),
            patron_id=patron_id,
            milvus_id=milvus_id,
            image_url=image_url,
            is_active=True,
        )
        self.db.add(face)
        await self.db.flush()
        return face

    async def create_access_log(
        self,
        access_type: str,
        verify_method: str,
        camera_id: str,
        status: str,
        patron_id: Optional[uuid.UUID] = None,
        confidence: Optional[float] = None,
        image_url: Optional[str] = None,
    ) -> AccessLogModel:
        log = AccessLogModel(
            id=uuid.uuid4(),
            patron_id=patron_id,
            access_type=access_type,
            verify_method=verify_method,
            camera_id=camera_id,
            status=status,
            confidence=confidence,
            image_url=image_url,
        )
        self.db.add(log)
        await self.db.flush()
        return log

    async def get_access_logs(
        self,
        patron_id: Optional[uuid.UUID] = None,
        camera_id: Optional[str] = None,
        status: Optional[str] = None,
        access_type: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[AccessLogModel], int]:
        q = select(AccessLogModel)
        count_q = select(func.count(AccessLogModel.id))

        if patron_id:
            q = q.where(AccessLogModel.patron_id == patron_id)
            count_q = count_q.where(AccessLogModel.patron_id == patron_id)
        if camera_id:
            q = q.where(AccessLogModel.camera_id == camera_id)
            count_q = count_q.where(AccessLogModel.camera_id == camera_id)
        if status:
            q = q.where(AccessLogModel.status == status)
            count_q = count_q.where(AccessLogModel.status == status)
        if access_type:
            q = q.where(AccessLogModel.access_type == access_type)
            count_q = count_q.where(AccessLogModel.access_type == access_type)
        if date_from:
            q = q.where(AccessLogModel.access_time >= date_from)
            count_q = count_q.where(AccessLogModel.access_time >= date_from)
        if date_to:
            q = q.where(AccessLogModel.access_time <= date_to)
            count_q = count_q.where(AccessLogModel.access_time <= date_to)
        if search:
            pattern = f"%{search}%"
            sub = select(PatronModel.id).where(
                (PatronModel.full_name.ilike(pattern)) | (PatronModel.student_code.ilike(pattern))
            ).subquery()
            q = q.where(AccessLogModel.patron_id.in_(select(sub.c.id)))
            count_q = count_q.where(AccessLogModel.patron_id.in_(select(sub.c.id)))

        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        q = q.order_by(AccessLogModel.access_time.desc()).offset(skip).limit(limit)
        result = await self.db.execute(q)
        return list(result.scalars().all()), total

    async def get_latest_entry(self, patron_id: uuid.UUID) -> Optional[AccessLogModel]:
        result = await self.db.execute(
            select(AccessLogModel)
            .where(
                AccessLogModel.patron_id == patron_id,
                AccessLogModel.access_type == "entry",
                AccessLogModel.status == "success",
            )
            .order_by(AccessLogModel.access_time.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def is_patron_inside(self, patron_id: uuid.UUID) -> bool:
        latest = await self.get_latest_entry(patron_id)
        if not latest:
            return False
        result = await self.db.execute(
            select(AccessLogModel)
            .where(
                AccessLogModel.patron_id == patron_id,
                AccessLogModel.access_type == "exit",
                AccessLogModel.access_time > latest.access_time,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is None

    async def get_active_patrons(self) -> List[PatronModel]:
        sub = (
            select(
                AccessLogModel.patron_id,
                func.max(AccessLogModel.access_time).label("last_time"),
            )
            .where(AccessLogModel.status == "success")
            .group_by(AccessLogModel.patron_id)
            .subquery()
        )
        # patrons whose latest log is an entry (no later exit)
        active_ids_q = (
            select(sub.c.patron_id)
            .outerjoin(
                AccessLogModel,
                (AccessLogModel.patron_id == sub.c.patron_id)
                & (AccessLogModel.access_type == "exit")
                & (AccessLogModel.access_time > sub.c.last_time),
            )
            .where(AccessLogModel.id.is_(None))
        )
        result = await self.db.execute(active_ids_q)
        ids = [row[0] for row in result if row[0]]
        if not ids:
            return []
        patrons_q = select(PatronModel).where(PatronModel.id.in_(ids))
        result = await self.db.execute(patrons_q)
        return list(result.scalars().all())
