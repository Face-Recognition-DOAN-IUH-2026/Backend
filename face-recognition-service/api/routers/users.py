from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.dependencies import get_current_user
from core.service_token import get_auth_headers
from infra.config import settings
from infra.http_client import get_http_client

router = APIRouter(prefix="/users", tags=["users"])

USER_SERVICE_URL = settings.user_service_url or "http://user-service:3001"


def _internal_headers() -> dict[str, str]:
    return get_auth_headers(
        service_name="face-recognition-service",
        scopes=["users:read"],
        secret=settings.service_jwt_secret,
    )


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    role: str
    has_face: bool = False
    student_code: str | None = None
    avatar_url: str | None = None
    status: str | None = None


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int


from infra.milvus_client import get_milvus_client


async def _check_has_face(user_id: str) -> bool:
    """Check if a specific user has enrolled face vectors using targeted O(1) point query."""
    if not user_id:
        return False
    try:
        mc = get_milvus_client()
        rows = mc.client.query(
            mc.collection_name,
            filter=f'user_id == "{user_id}"',
            output_fields=["user_id"],
            limit=1,
        )
        return len(rows) > 0
    except Exception:
        return False


async def _get_face_user_ids_batch(user_ids: list[str]) -> set[str]:
    """Check face enrollment for a specific subset of user IDs."""
    if not user_ids:
        return set()
    try:
        import json
        mc = get_milvus_client()
        rows = mc.client.query(
            mc.collection_name,
            filter=f'user_id in {json.dumps(user_ids)}',
            output_fields=["user_id"],
            limit=len(user_ids) * 4,
        )
        return {r["user_id"] for r in rows}
    except Exception:
        return set()


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
        avatar_url=current_user.get("avatar_url"),
        status=current_user.get("status"),
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

    client = get_http_client()
    resp = await client.get(f"{USER_SERVICE_URL}/internal/users", headers=_internal_headers())
    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch users from user-service",
        )
    users_data = resp.json()

    user_ids = [str(u["id"]) for u in users_data if "id" in u]
    face_user_ids = await _get_face_user_ids_batch(user_ids)

    return UserListResponse(
        users=[
            UserResponse(
                id=str(u["id"]),
                email=u["email"],
                full_name=u.get("full_name") or u.get("fullName"),
                role=u["role"],
                has_face=str(u["id"]) in face_user_ids,
                avatar_url=u.get("avatar_url") or u.get("avatarUrl"),
                status=u.get("status"),
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

    client = get_http_client()
    resp = await client.delete(f"{USER_SERVICE_URL}/internal/users/{user_id}", headers=_internal_headers())
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
