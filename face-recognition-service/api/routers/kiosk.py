from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from celery import Celery

from api.dependencies import get_db_session
from core.schemas import KioskEnrollRequest, KioskEnterRequest, KioskResult, PatronPublic
from infra.config import settings
from infra.models import PatronModel
from infra.patron_repository import PatronRepository
from infra.sse_manager import sse_manager

router = APIRouter(prefix="/kiosk", tags=["kiosk"])

celery_app = Celery(
    "tasks",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


async def _patron_to_public(patron: PatronModel, repo: PatronRepository) -> PatronPublic:
    face = await repo.get_active_face(patron.id)
    return PatronPublic(
        id=str(patron.id),
        full_name=patron.full_name,
        student_code=patron.student_code,
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
    card_number: str = Form(...),
    membership_expiry: str = Form(...),
    identity_number: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    issue_date: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)

    if await repo.get_by_student_code(student_code):
        raise HTTPException(409, "Student code already exists")
    if await repo.get_by_card_number(card_number):
        raise HTTPException(409, "Card number already exists")

    import base64 as _b64
    raw = await image.read()
    img_b64 = _b64.b64encode(raw).decode("utf-8")

    patron = await repo.create_patron(
        full_name=full_name,
        student_code=student_code,
        card_number=card_number,
        membership_expiry=date.fromisoformat(membership_expiry),
        identity_number=identity_number,
        email=email,
        phone=phone,
        issue_date=date.fromisoformat(issue_date) if issue_date else None,
    )
    await db.commit()

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron.id), "image_bytes": img_b64},
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
    if not face or not face.milvus_id:
        return KioskResult(success=False, message="Patron has no enrolled face")

    import base64 as _b64
    raw = await image.read()
    img_b64 = _b64.b64encode(raw).decode("utf-8")

    task = celery_app.send_task(
        "verify_face",
        kwargs={"patron_id": str(patron.id), "image_bytes": img_b64},
    )

    return KioskResult(
        success=True,
        message="Face verification in progress",
        patron=await _patron_to_public(patron, repo),
        job_id=task.id,
    )
