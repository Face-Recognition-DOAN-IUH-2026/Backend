from __future__ import annotations

import base64
import uuid as _uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from api.dependencies import get_current_user, require_role
from core.schemas import (
    EnrollmentResult,
    IdentificationResult,
    LivenessResult,
    VerificationResult,
)
from infra.cooldown import CooldownService
from worker.tasks import (
    _upload_temp_frame,
    delete_user_task,
    enroll_task,
    identify_task,
    liveness_task,
    verify_task,
)

router = APIRouter(prefix="/face", tags=["face"])
cooldown = CooldownService()


@router.post("/enroll", response_model=EnrollmentResult, status_code=status.HTTP_202_ACCEPTED)
async def enroll(
    file: UploadFile = File(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if not await cooldown.acquire(f"enroll:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    raw = await file.read()
    object_key = _upload_temp_frame(raw, str(_uuid.uuid4()))
    task = enroll_task.delay(user_id=current_user["id"], object_key=object_key)
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
    object_key = _upload_temp_frame(raw, str(_uuid.uuid4()))
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
    object_key = _upload_temp_frame(raw, str(_uuid.uuid4()))
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
    object_key = _upload_temp_frame(raw, str(_uuid.uuid4()))
    task = liveness_task.delay(object_key=object_key)
    return LivenessResult(job_id=task.id)


@router.delete("/{user_id}", status_code=status.HTTP_202_ACCEPTED)
async def delete_face(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    task = delete_user_task.delay(user_id=user_id)
    return {"job_id": task.id}
