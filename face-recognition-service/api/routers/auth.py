from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from worker.tasks import _sync_face_login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/face-login")
async def face_login(file: UploadFile = File(...)):
    raw = await file.read()
    result = await run_in_threadpool(_sync_face_login, raw)
    if result.get("status") != "success":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.get("error", "Face login failed"))
    return {
        "access_token": result["access_token"],
        "refresh_token": result.get("refresh_token"),
        "token_type": result.get("token_type", "bearer"),
    }
