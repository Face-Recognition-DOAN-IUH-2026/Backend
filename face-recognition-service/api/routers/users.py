from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.dependencies import get_current_user
from infra.config import settings

router = APIRouter(prefix="/users", tags=["users"])

USER_SERVICE_URL = settings.user_service_url or "http://user-service:3001"


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    role: str
    has_face: bool = False
    student_code: str | None = None


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


async def _get_milvus_client():
    from infra.milvus_client import MilvusClient
    return MilvusClient(
        host=settings.milvus_host,
        port=settings.milvus_port,
        collection_name=settings.milvus_collection,
        dim=512,
    )


async def _get_face_user_ids() -> set[str]:
    try:
        mc = await _get_milvus_client()
        all_rows = mc.client.query(mc.collection_name, filter='user_id != ""', output_fields=["user_id"], limit=10000)
        return {r["user_id"] for r in all_rows}
    except Exception:
        return set()


async def _check_has_face(user_id: str) -> bool:
    return user_id in await _get_face_user_ids()


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
):
    has_face = await _check_has_face(current_user["id"])
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        full_name=current_user.get("full_name"),
        role=current_user["role"],
        has_face=has_face,
        student_code=current_user.get("student_code"),
    )


@router.get("", response_model=UserListResponse)
async def list_users(
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    async with httpx.AsyncClient(base_url=USER_SERVICE_URL) as client:
        resp = await client.get("/users")
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to fetch users from user-service",
            )
        users_data = resp.json()

    face_user_ids = await _get_face_user_ids()

    return UserListResponse(
        users=[
            UserResponse(
                id=str(u["id"]),
                email=u["email"],
                full_name=u.get("full_name"),
                role=u["role"],
                has_face=str(u["id"]) in face_user_ids,
            )
            for u in users_data
        ],
        total=len(users_data),
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    async with httpx.AsyncClient(base_url=USER_SERVICE_URL) as client:
        resp = await client.delete(f"/users/{user_id}")
        if resp.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to delete user from user-service",
            )
