from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Annotated

import bcrypt
from fastapi import APIRouter, Body, Depends, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession
from celery import Celery

from api.dependencies import get_current_user, get_db_session, require_role
from core.schemas import PatronCreate, PatronPublic, PatronUpdate, PatronRegisterRequest, PatronLoginRequest, PatronAuthResponse
from infra.config import settings
from infra.models import PatronModel
from infra.patron_repository import PatronRepository
from worker.tasks import _upload_temp_frame, full_delete_patron_task, enroll_face

celery_app = Celery(
    "tasks",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

router = APIRouter(prefix="/patrons", tags=["patrons"])


@router.post("/register", response_model=PatronAuthResponse)
async def register_patron(
    body: PatronRegisterRequest,
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    if await repo.get_by_student_code(body.student_code):
        raise HTTPException(409, "Mã sinh viên đã được đăng ký")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    card_number = f"THV-{body.student_code}"
    patron = await repo.create_patron(
        full_name=body.full_name,
        student_code=body.student_code,
        class_name=body.class_name,
        card_number=card_number,
        membership_expiry=date(2099, 12, 31),
        issue_date=date.today(),
    )

    await repo.update_patron(patron.id, password_hash=password_hash)
    await db.commit()
    await db.refresh(patron)

    token = jwt.encode(
        {
            "sub": str(patron.id),
            "student_code": patron.student_code,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24),
            "iat": datetime.now(timezone.utc),
            "typ": "access",
        },
        settings.jwt_access_secret,
        algorithm="HS256",
    )

    return PatronAuthResponse(
        access_token=token,
        token_type="bearer",
        patron=await _patron_to_public(patron, repo),
    )


@router.post("/login", response_model=PatronAuthResponse)
async def login_patron(
    body: PatronLoginRequest,
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    patron = await repo.get_by_student_code(body.student_code)
    if not patron:
        raise HTTPException(401, "Mã sinh viên hoặc mật khẩu không đúng")

    if not patron.password_hash:
        raise HTTPException(401, "Tài khoản chưa được đăng ký, vui lòng đăng ký trước")

    if not bcrypt.checkpw(body.password.encode(), patron.password_hash.encode()):
        raise HTTPException(401, "Mã sinh viên hoặc mật khẩu không đúng")

    is_expired = patron.membership_expiry and patron.membership_expiry < date.today()
    if is_expired:
        raise HTTPException(403, "Thẻ thư viện đã hết hạn, vui lòng gia hạn")

    token = jwt.encode(
        {
            "sub": str(patron.id),
            "student_code": patron.student_code,
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24),
            "iat": datetime.now(timezone.utc),
            "typ": "access",
        },
        settings.jwt_access_secret,
        algorithm="HS256",
    )

    return PatronAuthResponse(
        access_token=token,
        token_type="bearer",
        patron=await _patron_to_public(patron, repo),
    )


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
        current_status=patron.current_status,
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
    card_number = f"THV-{body.student_code}"
    if await repo.get_by_card_number(card_number):
        raise HTTPException(409, "Student code already exists")
    patron = await repo.create_patron(
        full_name=body.full_name,
        student_code=body.student_code,
        class_name=body.class_name,
        card_number=card_number,
        membership_expiry=body.membership_expiry,
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


@router.delete("/{patron_id}", status_code=202)
async def delete_patron(
    patron_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(require_role("admin")),
):
    repo = PatronRepository(db)
    patron = await repo.get_by_id(patron_id)
    if not patron:
        raise HTTPException(404, "Patron not found")
    task = full_delete_patron_task.delay(str(patron_id))
    return {"job_id": task.id, "patron_id": str(patron_id)}


@router.post("/{patron_id}/enroll-face")
async def enroll_patron_face(
    patron_id: uuid.UUID,
    image: UploadFile = None,
    angle: str = Form("frontal"),
    image_data: str = Form(None),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
    body_image: Annotated[str | None, Body()] = None,
):
    repo = PatronRepository(db)
    patron = await repo.get_by_id(patron_id)
    if not patron:
        raise HTTPException(404, "Patron not found")

    raw = None
    if image:
        raw = await image.read()
    elif image_data:
        import base64
        raw = base64.b64decode(image_data)
    elif body_image:
        import base64
        raw = base64.b64decode(body_image)
    else:
        raise HTTPException(400, "Missing image")

    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(uuid.uuid4()))

    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron_id), "object_key": object_key, "angle": angle},
    )

    result = await run_in_threadpool(task.get, timeout=60)
    if result.get("status") == "error":
        error_msg = result.get("error", "Unknown error")
        error_detail = {
            "LIVENESS_FAILED": "Ảnh không phải khuôn mặt thật, vui lòng chụp ảnh trực tiếp",
            "NO_FACE_DETECTED": "Không tìm thấy khuôn mặt trong ảnh, vui lòng thử lại",
            "MULTIPLE_FACES": "Có nhiều hơn 1 khuôn mặt trong ảnh, vui lòng chụp lại",
            "LOW_QUALITY": "Ảnh quá mờ hoặc thiếu sáng, vui lòng chụp ảnh trực tiếp với điều kiện ánh sáng tốt hơn",
            "FACE_DETECTION_FAILED": "Không thể trích xuất khuôn mặt, vui lòng thử lại",
        }.get(error_msg, error_msg)
        raise HTTPException(400, error_detail)

    return {"success": True, "message": "Face enrolled successfully", "patron_id": str(patron_id)}
