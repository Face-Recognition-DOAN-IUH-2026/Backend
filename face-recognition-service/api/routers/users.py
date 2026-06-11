from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user
from infra.database import async_session_factory
from infra.models import UserModel

router = APIRouter(prefix="/users", tags=["users"])


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    role: str
    has_face: bool = False


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


async def _get_db():
    async with async_session_factory() as session:
        yield session


async def _check_has_face(user_id: str) -> bool:
    try:
        from infra.milvus_client import MilvusClient
        from infra.config import settings
        mc = MilvusClient(
            host=settings.milvus_host,
            port=settings.milvus_port,
            collection_name=settings.milvus_collection,
            dim=512,
        )
        results = mc.search(embedding=[0.0] * 512, top_k=1)
        return any(r["user_id"] == user_id for r in results)
    except Exception:
        return False


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(_get_db),
):
    has_face = await _check_has_face(current_user["id"])
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        full_name=current_user.get("full_name"),
        role=current_user["role"],
        has_face=has_face,
    )


@router.get("", response_model=UserListResponse)
async def list_users(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(_get_db),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    result = await db.execute(select(UserModel))
    users = result.scalars().all()

    return UserListResponse(
        users=[UserResponse(id=str(u.id), email=u.email, full_name=u.full_name, role=u.role) for u in users],
        total=len(users),
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(_get_db),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    await db.delete(user)
    await db.commit()