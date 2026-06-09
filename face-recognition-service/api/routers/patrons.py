from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from celery import Celery

from api.dependencies import get_current_user, get_db_session
from core.schemas import PatronCreate, PatronPublic, PatronUpdate
from infra.config import settings
from infra.models import PatronModel
from infra.patron_repository import PatronRepository

celery_app = Celery(
    "tasks",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

router = APIRouter(prefix="/patrons", tags=["patrons"])


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


@router.get("/search")
async def search_patrons(
    q: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    patrons = await repo.search(query=q, status=status, skip=skip, limit=limit)
    return [await _patron_to_public(p, repo) for p in patrons]


@router.get("/lookup")
async def lookup_patron(
    student_code: Optional[str] = Query(None),
    card_number: Optional[str] = Query(None),
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
    from datetime import date
    is_expired = patron.membership_expiry and patron.membership_expiry < date.today()
    return {
        "exists": True,
        "patron": (await _patron_to_public(patron, repo)).model_dump(),
        "has_face": await repo.get_active_face(patron.id) is not None,
        "is_expired": bool(is_expired),
    }


@router.get("/{patron_id}")
async def get_patron(
    patron_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    patron = await repo.get_by_id(patron_id)
    if not patron:
        raise HTTPException(404, "Patron not found")
    return await _patron_to_public(patron, repo)


@router.post("")
async def create_patron(
    body: PatronCreate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    if await repo.get_by_student_code(body.student_code):
        raise HTTPException(409, "Student code already exists")
    if await repo.get_by_card_number(body.card_number):
        raise HTTPException(409, "Card number already exists")
    patron = await repo.create_patron(
        full_name=body.full_name,
        student_code=body.student_code,
        card_number=body.card_number,
        membership_expiry=body.membership_expiry,
        identity_number=body.identity_number,
        email=body.email,
        phone=body.phone,
        issue_date=body.issue_date,
    )
    await db.commit()
    return await _patron_to_public(patron, repo)


@router.put("/{patron_id}")
async def update_patron(
    patron_id: uuid.UUID,
    body: PatronUpdate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    patron = await repo.update_patron(
        patron_id,
        full_name=body.full_name,
        identity_number=body.identity_number,
        email=body.email,
        phone=body.phone,
        membership_expiry=body.membership_expiry,
        status=body.status,
    )
    if not patron:
        raise HTTPException(404, "Patron not found")
    await db.commit()
    return await _patron_to_public(patron, repo)


@router.delete("/{patron_id}")
async def delete_patron(
    patron_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    if not await repo.delete_patron(patron_id):
        raise HTTPException(404, "Patron not found")
    await db.commit()
    return {"ok": True}


@router.post("/{patron_id}/enroll-face")
async def enroll_patron_face(
    patron_id: uuid.UUID,
    image: UploadFile,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    import base64 as _b64

    repo = PatronRepository(db)
    patron = await repo.get_by_id(patron_id)
    if not patron:
        raise HTTPException(404, "Patron not found")

    raw = await image.read()
    img_b64 = _b64.b64encode(raw).decode("utf-8")

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron_id), "image_bytes": img_b64},
    )

    return {"success": True, "job_id": task.id, "message": "Face enrollment in progress"}
