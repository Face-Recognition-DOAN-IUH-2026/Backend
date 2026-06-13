from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Date, cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from infra.models import AccessLogModel, PatronFaceModel, UserModel


class PatronRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> Optional[UserModel]:
        result = await self.db.execute(select(UserModel).where(UserModel.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_student_code(self, code: str) -> Optional[UserModel]:
        result = await self.db.execute(select(UserModel).where(UserModel.student_code == code))
        return result.scalar_one_or_none()

    async def get_by_card_number(self, card: str) -> Optional[UserModel]:
        result = await self.db.execute(select(UserModel).where(UserModel.card_number == card))
        return result.scalar_one_or_none()

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

    async def get_user_current_status(self, user_id: uuid.UUID) -> Optional[str]:
        result = await self.db.execute(
            select(UserModel.current_status).where(UserModel.id == user_id)
        )
        return result.scalar_one_or_none()

    async def update_user_current_status(
        self,
        user_id: uuid.UUID,
        status: str,
        last_entry_at: Optional[datetime] = None,
        last_entry_camera: Optional[str] = None,
    ) -> None:
        await self.db.execute(
            update(UserModel)
            .where(UserModel.id == user_id)
            .values(
                current_status=status,
                last_entry_at=last_entry_at,
                last_entry_camera=last_entry_camera,
                updated_at=datetime.utcnow(),
            )
        )

    async def create_access_log(
        self,
        access_type: str,
        verify_method: str,
        camera_id: str,
        status: str,
        user_id: Optional[uuid.UUID] = None,
        confidence: Optional[float] = None,
        image_url: Optional[str] = None,
    ) -> AccessLogModel:
        log = AccessLogModel(
            id=uuid.uuid4(),
            patron_id=user_id,
            access_type=access_type,
            verify_method=verify_method,
            camera_id=camera_id,
            status=status,
            confidence=confidence,
            image_url=image_url,
        )
        self.db.add(log)
        if user_id and status == "success":
            new_status = "inside" if access_type == "entry" else "outside"
            await self.update_user_current_status(
                user_id,
                new_status,
                last_entry_at=datetime.utcnow() if access_type == "entry" else None,
                last_entry_camera=camera_id if access_type == "entry" else None,
            )
        await self.db.flush()
        return log

    async def get_access_logs(
        self,
        user_id: Optional[uuid.UUID] = None,
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

        if user_id:
            q = q.where(AccessLogModel.patron_id == user_id)
            count_q = count_q.where(AccessLogModel.patron_id == user_id)
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
            sub = select(UserModel.id).where(
                (UserModel.full_name.ilike(pattern)) | (UserModel.student_code.ilike(pattern))
            ).subquery()
            q = q.where(AccessLogModel.patron_id.in_(select(sub.c.id)))
            count_q = count_q.where(AccessLogModel.patron_id.in_(select(sub.c.id)))

        total_result = await self.db.execute(count_q)
        total = total_result.scalar() or 0

        q = q.order_by(AccessLogModel.access_time.desc()).offset(skip).limit(limit)
        result = await self.db.execute(q)
        return list(result.scalars().all()), total

    async def get_access_frequency(
        self,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> list[dict]:
        q = select(
            cast(AccessLogModel.access_time, Date).label("date"),
            AccessLogModel.access_type,
            func.count(AccessLogModel.id).label("count"),
        ).where(AccessLogModel.status == "success")

        if date_from:
            q = q.where(AccessLogModel.access_time >= date_from)
        if date_to:
            q = q.where(AccessLogModel.access_time <= date_to)

        q = q.group_by(cast(AccessLogModel.access_time, Date), AccessLogModel.access_type)
        q = q.order_by(cast(AccessLogModel.access_time, Date))

        result = await self.db.execute(q)
        rows = result.all()

        daily: dict[str, dict] = {}
        for row in rows:
            date_str = str(row.date)
            if date_str not in daily:
                daily[date_str] = {"date": date_str, "entry": 0, "exit": 0}
            daily[date_str][row.access_type] = row.count

        return sorted(daily.values(), key=lambda x: x["date"])

    async def get_latest_entry(self, user_id: uuid.UUID) -> Optional[AccessLogModel]:
        result = await self.db.execute(
            select(AccessLogModel)
            .where(
                AccessLogModel.patron_id == user_id,
                AccessLogModel.access_type == "entry",
                AccessLogModel.status == "success",
            )
            .order_by(AccessLogModel.access_time.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def is_user_inside(self, user_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            select(UserModel.current_status).where(UserModel.id == user_id)
        )
        return result.scalar_one_or_none() == "inside"

    async def get_active_users(self) -> List[UserModel]:
        result = await self.db.execute(
            select(UserModel).where(
                UserModel.current_status == "inside",
                UserModel.status == "active",
                UserModel.role == "patron",
            )
        )
        return list(result.scalars().all())

    async def count_active(self) -> int:
        result = await self.db.execute(
            select(func.count(UserModel.id)).where(
                UserModel.status == "active",
                UserModel.role == "patron",
            )
        )
        return result.scalar() or 0

    async def count_active_inside(self) -> int:
        result = await self.db.execute(
            select(func.count(UserModel.id)).where(
                UserModel.current_status == "inside",
                UserModel.status == "active",
                UserModel.role == "patron",
            )
        )
        return result.scalar() or 0

    async def count_today_access(self, access_type: str) -> int:
        result = await self.db.execute(
            select(func.count(AccessLogModel.id)).where(
                AccessLogModel.access_type == access_type,
                cast(AccessLogModel.access_time, Date) == func.current_date(),
                AccessLogModel.status == "success",
            )
        )
        return result.scalar() or 0
