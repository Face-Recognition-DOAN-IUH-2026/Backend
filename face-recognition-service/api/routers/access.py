from __future__ import annotations

from fastapi import APIRouter, HTTPException


router = APIRouter(prefix="/access", tags=["access-deprecated"])


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def deprecated_access_router(path: str):
    raise HTTPException(
        status_code=410,
        detail="Access APIs moved to access-service. Use the API gateway /api/access routes.",
    )
