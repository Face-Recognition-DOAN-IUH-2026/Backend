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
    role: str


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


async def _get_db():
    async with async_session_factory() as session:
        yield session


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        role=current_user["role"],
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
        users=[UserResponse(id=str(u.id), email=u.email, role=u.role) for u in users],
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