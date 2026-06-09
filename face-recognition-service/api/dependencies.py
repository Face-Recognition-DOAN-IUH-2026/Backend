from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import decode_token
from infra.config import settings
from infra.database import async_session_factory
from infra.user_repository import PostgresUserRepository

security = HTTPBearer()


async def get_db_session() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    token = credentials.credentials
    try:
        payload = decode_token(
            token=token,
            secret=settings.jwt_access_secret,
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            expected_type="access",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    repo = PostgresUserRepository(db)
    user_id = payload["sub"]
    user = await repo.get_user_by_id(user_id)
    if user is None:
        email = payload.get("email", "")
        user = await repo.get_user_by_email(email)
        if user is not None:
            user.id = uuid.UUID(user_id)
            await db.commit()
            await db.refresh(user)
        else:
            from infra.models import UserModel
            from passlib.context import CryptContext
            _pwd = CryptContext(schemes=["bcrypt"])
            user_model = UserModel(
                id=uuid.UUID(user_id),
                email=email,
                password_hash=_pwd.hash("auto_generated"),
                role=payload.get("roles", ["user"])[0],
            )
            db.add(user_model)
            await db.commit()
            await db.refresh(user_model)
            user = user_model
    return {"id": str(user.id), "email": user.email, "role": user.role}


def require_role(required_role: str):
    async def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return role_checker
