from __future__ import annotations

import asyncio
import base64
import uuid as _uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from api.dependencies import get_current_user, require_role
from core.schemas import (
    EnrollmentResult,
    IdentificationResult,
    LivenessResult,
    VerificationResult,
)
from infra.cooldown import CooldownService
from infra.redis_cache import redis_client
from worker.tasks import (
    _upload_temp_frame,
    delete_user_task,
    enroll_task,
    identify_task,
    liveness_task,
    verify_task,
    batch_enroll_task,
)

router = APIRouter(prefix="/face", tags=["face"])
cooldown = CooldownService()


async def _store_temp_frame(raw: bytes) -> str:
    """Upload to MinIO and also store in Redis for fast worker access."""
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))
    redis_client.setex(f"temp_frame:{object_key}", 120, raw)
    return object_key


@router.post("/enroll", response_model=EnrollmentResult, status_code=status.HTTP_410_GONE)
async def enroll(
    file: UploadFile = File(...),
    consent_given: bool = Form(True),
    angle: str = Form("frontal"),
    current_user: dict = Depends(get_current_user),
):
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Single-image enrollment is no longer supported. Use /face/enroll-batch with 4 angles."
    )


@router.post("/enroll-batch", response_model=EnrollmentResult, status_code=status.HTTP_202_ACCEPTED)
async def enroll_batch(
    frontal: UploadFile = File(...),
    right: UploadFile = File(...),
    left: UploadFile = File(...),
    down: UploadFile = File(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    raw_frontal = await frontal.read()
    raw_right = await right.read()
    raw_left = await left.read()
    raw_down = await down.read()
    try:
        keys = await asyncio.gather(
            _store_temp_frame(raw_frontal),
            _store_temp_frame(raw_right),
            _store_temp_frame(raw_left),
            _store_temp_frame(raw_down),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to store temp frames: {exc}")
    task = batch_enroll_task.delay(user_id=current_user["id"], object_keys=keys)
    return EnrollmentResult(job_id=task.id)


@router.post("/verify", response_model=VerificationResult, status_code=status.HTTP_202_ACCEPTED)
async def verify(
    file: UploadFile = File(...),
    target_user_id: str = Form(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if not await cooldown.acquire(f"verify:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    raw = await file.read()
    object_key = await _store_temp_frame(raw)
    task = verify_task.delay(user_id=target_user_id, object_key=object_key)
    return VerificationResult(job_id=task.id)


@router.post("/identify", response_model=IdentificationResult, status_code=status.HTTP_202_ACCEPTED)
async def identify(
    file: UploadFile = File(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if not await cooldown.acquire(f"identify:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    raw = await file.read()
    object_key = await _store_temp_frame(raw)
    task = identify_task.delay(object_key=object_key)
    return IdentificationResult(job_id=task.id)


@router.post("/liveness", response_model=LivenessResult, status_code=status.HTTP_202_ACCEPTED)
async def liveness(
    file: UploadFile = File(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if not await cooldown.acquire(f"liveness:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    raw = await file.read()
    object_key = await _store_temp_frame(raw)
    task = liveness_task.delay(object_key=object_key)
    return LivenessResult(job_id=task.id)


@router.delete("/{user_id}", status_code=status.HTTP_202_ACCEPTED)
async def delete_face(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    task = delete_user_task.delay(user_id=user_id)
    return {"job_id": task.id}
