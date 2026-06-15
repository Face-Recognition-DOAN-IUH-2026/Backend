from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from infra.config import settings

from worker.tasks import _sync_face_login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/face-login")
async def face_login(response: Response, file: UploadFile = File(...)):
    raw = await file.read()
    result = await run_in_threadpool(_sync_face_login, raw)
    if result.get("status") != "success":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.get("error", "Face login failed"))
    secure_cookie = settings.env.lower() == "prod"
    response.set_cookie(
        "access_token",
        result["access_token"],
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        path="/",
        max_age=15 * 60,
    )
    if result.get("refresh_token"):
        response.set_cookie(
            "refresh_token",
            result["refresh_token"],
            httponly=True,
            secure=secure_cookie,
            samesite="lax",
            path="/auth",
            max_age=30 * 24 * 60 * 60,
        )
    return {
        "access_token": result["access_token"],
        "refresh_token": result.get("refresh_token"),
        "token_type": result.get("token_type", "bearer"),
    }
