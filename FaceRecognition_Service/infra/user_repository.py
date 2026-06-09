from __future__ import annotations

import uuid

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from infra.models import UserModel

pwd_context = CryptContext(schemes=["bcrypt"])


class PostgresUserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_user(self, email: str, password_hash: str, role: str) -> str:
        user = UserModel(
            id=uuid.uuid4(),
            email=email,
            password_hash=password_hash,
            role=role,
        )
        self.session.add(user)
        await self.session.commit()
        return str(user.id)

    async def get_user_by_email(self, email: str) -> UserModel | None:
        result = await self.session.execute(
            select(UserModel).where(UserModel.email == email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: str) -> UserModel | None:
        result = await self.session.execute(
            select(UserModel).where(UserModel.id == uuid.UUID(user_id))
        )
        return result.scalar_one_or_none()

    async def delete_user(self, user_id: str) -> None:
        result = await self.session.execute(
            select(UserModel).where(UserModel.id == uuid.UUID(user_id))
        )
        user = result.scalar_one_or_none()
        if user:
            await self.session.delete(user)
            await self.session.commit()
