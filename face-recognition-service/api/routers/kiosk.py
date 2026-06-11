from __future__ import annotations

import uuid as _uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from celery import Celery as _Celery

from api.dependencies import get_db_session
from core.schemas import KioskEnrollRequest, KioskEnterRequest, KioskResult, PatronPublic
from infra.config import settings
from infra.models import PatronModel
from infra.patron_repository import PatronRepository
from infra.sse_manager import sse_manager
from worker.celery_app import celery_app as _celery_app
from worker.tasks import _upload_temp_frame
from infra.minio_client import MinioStorage as _MinioStorage
from infra.milvus_client import MilvusClient as _MilvusClient

def _get_milvus_client() -> _MilvusClient:
    return _MilvusClient(
        host=settings.milvus_host,
        port=settings.milvus_port,
        collection_name=settings.milvus_collection,
        dim=512,
    )

router = APIRouter(prefix="/kiosk", tags=["kiosk"])
celery_app = _celery_app


async def _patron_to_public(patron: PatronModel, repo: PatronRepository) -> PatronPublic:
    face = await repo.get_active_face(patron.id)
    return PatronPublic(
        id=str(patron.id),
        full_name=patron.full_name,
        student_code=patron.student_code,
        class_name=patron.class_name,
        identity_number=patron.identity_number,
        email=patron.email,
        phone=patron.phone,
        card_number=patron.card_number,
        issue_date=patron.issue_date,
        membership_expiry=patron.membership_expiry,
        status=patron.status,
        created_at=patron.created_at,
        updated_at=patron.updated_at,
        has_face=face is not None,
    )


@router.post("/lookup")
async def kiosk_lookup(
    student_code: Optional[str] = None,
    card_number: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    patron = None
    if student_code:
        patron = await repo.get_by_student_code(student_code)
    elif card_number:
        patron = await repo.get_by_card_number(card_number)
    if not patron:
        return {"exists": False, "patron": None, "has_face": False, "is_expired": False}
    is_expired = patron.membership_expiry and patron.membership_expiry < date.today()
    return {
        "exists": True,
        "patron": (await _patron_to_public(patron, repo)).model_dump(),
        "has_face": await repo.get_active_face(patron.id) is not None,
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

    card_number = f"THV-{student_code}"
    if await repo.get_by_card_number(card_number):
        raise HTTPException(409, "Student code already exists")

    raw = await image.read()
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))

    patron = await repo.create_patron(
        full_name=full_name,
        student_code=student_code,
        class_name=class_name,
        card_number=card_number,
        membership_expiry=date.fromisoformat(membership_expiry),
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
    )
    await db.commit()

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron.id), "object_key": object_key, "angle": angle},
    )

    return KioskResult(
        success=True,
        message="Patron created. Face enrollment in progress.",
        patron=await _patron_to_public(patron, repo),
        job_id=task.id,
    )


@router.post("/enter")
async def kiosk_enter(
    image: UploadFile,
    student_code: str = Form(...),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)

    patron = await repo.get_by_student_code(student_code)
    if not patron:
        raise HTTPException(404, "Patron not found")

    if patron.membership_expiry and patron.membership_expiry < date.today():
        return KioskResult(success=False, message="Membership has expired")

    face = await repo.get_active_face(patron.id)
    if not face:
        return KioskResult(success=False, message="Patron has no enrolled face")

    raw = await image.read()
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))

    task = celery_app.send_task(
        "verify_face",
        kwargs={"patron_id": str(patron.id), "object_key": object_key},
    )

    return KioskResult(
        success=True,
        message="Face verification in progress",
        patron=await _patron_to_public(patron, repo),
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

    card_number = f"THV-{student_code}"
    if await repo.get_by_card_number(card_number):
        raise HTTPException(409, "Student code already exists")

    # Read all 4 images
    raws = {
        "frontal": await image_frontal.read(),
        "right": await image_right.read(),
        "left": await image_left.read(),
        "down": await image_down.read(),
    }

    # Upload all 4 to temp storage
    keys = {}
    for angle, raw in raws.items():
        keys[angle] = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))

    # Create patron in DB (commit so Celery tasks can see it)
    patron = await repo.create_patron(
        full_name=full_name,
        student_code=student_code,
        class_name=class_name,
        card_number=card_number,
        membership_expiry=date.fromisoformat(membership_expiry),
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
    )
    await db.commit()

    # Enroll all 4 faces (sequential, wait per angle)
    errors = []
    for angle in ["frontal", "right", "left", "down"]:
        task = celery_app.send_task(
            "enroll_face",
            kwargs={"patron_id": str(patron.id), "object_key": keys[angle], "angle": angle},
        )
        try:
            result = await run_in_threadpool(task.get, timeout=60)
            if result.get("status") == "error":
                errors.append(f"{angle}: {result.get('error', 'Unknown error')}")
                break
        except Exception as exc:
            errors.append(f"{angle}: {str(exc)}")
            break

    if errors:
        # Rollback: clean up Milvus vectors already inserted
        try:
            _get_milvus_client().delete_by_user_id(user_id=str(patron.id))
        except Exception:
            pass
        # Clean up MinIO patron images (best-effort)
        try:
            sto = _MinioStorage()
            for angle in ["frontal", "right", "left", "down"]:
                sto.delete_image(f"patrons/{patron.id}_{angle}.jpg")
        except Exception:
            pass
        # Delete patron from PostgreSQL
        await repo.delete_patron(patron.id)
        await db.commit()
        raise HTTPException(400, f"Đăng ký thất bại. Lỗi các góc: {'; '.join(errors)}")

    return KioskResult(
        success=True,
        message="Đã tạo độc giả với đầy đủ 4 góc khuôn mặt.",
        patron=await _patron_to_public(patron, repo),
    )


@router.post("/enroll-face/{patron_id}")
async def kiosk_enroll_face(
    patron_id: _uuid.UUID,
    image: UploadFile,
    angle: str = Form("frontal"),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    patron = await repo.get_by_id(patron_id)
    if not patron:
        raise HTTPException(404, "Patron not found")

    raw = await image.read()
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron_id), "object_key": object_key, "angle": angle},
    )

    result = await run_in_threadpool(task.get, timeout=60)
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        raise HTTPException(400, error_msg)

    return {"success": True, "message": f"Face enrolled at angle '{angle}'"}
