from __future__ import annotations

import uuid as _uuid
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from celery import Celery as _Celery

from api.dependencies import get_db_session
from core.schemas import KioskEnrollRequest, KioskEnterRequest, KioskResult, PatronPublic
from infra.config import settings
from infra.models import UserModel
from infra.patron_repository import PatronRepository
from infra.sse_manager import sse_manager
from worker.celery_app import celery_app as _celery_app
from worker.tasks import _upload_temp_frame, batch_enroll_task
from infra.minio_client import MinioStorage as _MinioStorage
from infra.milvus_client import MilvusClient as _MilvusClient
from infra.redis_cache import redis_client as _redis_client

USER_SERVICE = settings.user_service_url
INTERNAL_KEY = settings.internal_api_key


def _get_milvus_client() -> _MilvusClient:
    return _MilvusClient(
        host=settings.milvus_host,
        port=settings.milvus_port,
        collection_name=settings.milvus_collection,
        dim=512,
    )

router = APIRouter(prefix="/kiosk", tags=["kiosk"])
celery_app = _celery_app


async def _store_temp_frame(raw: bytes) -> str:
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))
    _redis_client.setex(f"temp_frame:{object_key}", 120, raw)
    return object_key


async def _patron_to_public(user: UserModel, repo: PatronRepository) -> PatronPublic:
    face = await repo.get_active_face(user.id)
    return PatronPublic(
        id=str(user.id),
        full_name=user.full_name or "",
        student_code=user.student_code or "",
        class_name=user.class_name,
        identity_number=user.identity_number,
        email=user.email,
        phone=user.phone,
        card_number=user.card_number or "",
        issue_date=user.issue_date,
        membership_expiry=user.membership_expiry or date(2099, 12, 31),
        status=user.status or "active",
        current_status=user.current_status,
        created_at=user.created_at,
        updated_at=user.updated_at,
        has_face=face is not None,
    )


async def _proxy_create_user(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = {}
        if INTERNAL_KEY:
            headers["X-Internal-Api-Key"] = INTERNAL_KEY
        resp = await client.post(f"{USER_SERVICE}/patrons", json=body, headers=headers)
        if resp.status_code >= 400:
            detail = resp.json().get("error", "Failed to create patron")
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


async def _proxy_delete_user(user_id: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = {}
        if INTERNAL_KEY:
            headers["X-Internal-Api-Key"] = INTERNAL_KEY
        await client.delete(f"{USER_SERVICE}/patrons/{user_id}", headers=headers)


@router.post("/lookup")
async def kiosk_lookup(
    student_code: Optional[str] = None,
    card_number: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    user = None
    if student_code:
        user = await repo.get_by_student_code(student_code)
    elif card_number:
        user = await repo.get_by_card_number(card_number)
    if not user:
        return {"exists": False, "patron": None, "has_face": False, "is_expired": False}
    is_expired = user.membership_expiry and user.membership_expiry < date.today()
    return {
        "exists": True,
        "patron": (await _patron_to_public(user, repo)).model_dump(),
        "has_face": await repo.get_active_face(user.id) is not None,
        "is_expired": bool(is_expired),
    }


@router.post("/enroll")
async def kiosk_enroll(
    image: UploadFile,
    full_name: str = Form(...),
    student_code: str = Form(...),
    class_name: Optional[str] = Form(None),
    membership_expiry: str = Form(...),
    issue_date: Optional[str] = Form(None),
    angle: str = Form("frontal"),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)

    if await repo.get_by_student_code(student_code):
        raise HTTPException(409, "Student code already exists")

    raw = await image.read()
    object_key = await _store_temp_frame(raw)

    user_data = await _proxy_create_user({
        "full_name": full_name,
        "student_code": student_code,
        "class_name": class_name,
        "membership_expiry": membership_expiry,
        "issue_date": issue_date or str(date.today()),
    })

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": user_data["id"], "object_key": object_key, "angle": angle},
    )

    user = await repo.get_by_id(_uuid.UUID(user_data["id"]))
    return KioskResult(
        success=True,
        message="Patron created. Face enrollment in progress.",
        patron=await _patron_to_public(user, repo) if user else PatronPublic(**user_data),
        job_id=task.id,
    )


@router.post("/enter")
async def kiosk_enter(
    image: UploadFile,
    student_code: str = Form(...),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)

    user = await repo.get_by_student_code(student_code)
    if not user:
        raise HTTPException(404, "Patron not found")

    if user.membership_expiry and user.membership_expiry < date.today():
        return KioskResult(success=False, message="Membership has expired")

    face = await repo.get_active_face(user.id)
    if not face:
        return KioskResult(success=False, message="Patron has no enrolled face")

    raw = await image.read()
    object_key = await _store_temp_frame(raw)

    task = celery_app.send_task(
        "verify_face",
        kwargs={"patron_id": str(user.id), "object_key": object_key},
    )

    return KioskResult(
        success=True,
        message="Face verification in progress",
        patron=await _patron_to_public(user, repo),
        job_id=task.id,
    )


@router.post("/batch-enroll")
async def kiosk_batch_enroll(
    image_frontal: UploadFile,
    image_right: UploadFile,
    image_left: UploadFile,
    image_down: UploadFile,
    full_name: str = Form(...),
    student_code: str = Form(...),
    class_name: Optional[str] = Form(None),
    membership_expiry: str = Form(...),
    issue_date: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)

    if await repo.get_by_student_code(student_code):
        raise HTTPException(409, "Student code already exists")

    raws = {
        "frontal": await image_frontal.read(),
        "right": await image_right.read(),
        "left": await image_left.read(),
        "down": await image_down.read(),
    }

    keys = {}
    for angle, raw in raws.items():
        keys[angle] = await _store_temp_frame(raw)

    user_data = await _proxy_create_user({
        "full_name": full_name,
        "student_code": student_code,
        "class_name": class_name,
        "membership_expiry": membership_expiry,
        "issue_date": issue_date or str(date.today()),
    })

    task = celery_app.send_task(
        "batch_enroll_task",
        kwargs={"user_id": user_data["id"], "object_keys": [keys["frontal"], keys["right"], keys["left"], keys["down"]]},
    )
    result = await run_in_threadpool(task.get, timeout=120)
    user = await repo.get_by_id(_uuid.UUID(user_data["id"]))
    patron = await _patron_to_public(user, repo) if user else PatronPublic(**user_data)
    if result.get("status") == "partial_failure":
        return KioskResult(
            success=False,
            status="partial_failure",
            message=result.get("message", "Mot so goc chup that bai. Vui long chup lai goc loi."),
            patron=patron,
            failed_angle=result.get("failed_angle"),
            saved_angles=result.get("saved_angles", []),
            results=result.get("results", []),
        )
    if result.get("status") == "error":
        raise HTTPException(400, result.get("error", "Dang ky khuon mat that bai"))

    return KioskResult(
        success=True,
        status="success",
        message="Da tao doc gia voi day du 4 goc khuon mat.",
        patron=patron,
        results=result.get("results", []),
    )


@router.post("/enroll-face/{patron_id}")
async def kiosk_enroll_face(
    patron_id: _uuid.UUID,
    image: UploadFile,
    angle: str = Form("frontal"),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    user = await repo.get_by_id(patron_id)
    if not user:
        raise HTTPException(404, "Patron not found")

    raw = await image.read()
    object_key = await _store_temp_frame(raw)

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron_id), "object_key": object_key, "angle": angle},
    )

    result = await run_in_threadpool(task.get, timeout=60)
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        raise HTTPException(400, error_msg)

    return {"success": True, "message": f"Face enrolled at angle '{angle}'"}
