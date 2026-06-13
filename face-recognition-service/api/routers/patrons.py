from __future__ import annotations

import uuid
from typing import Optional, Annotated

import httpx
from fastapi import APIRouter, Body, Depends, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user, get_db_session, require_role
from core.schemas import PatronCreate, PatronPublic, PatronUpdate, PatronRegisterRequest, PatronLoginRequest, PatronAuthResponse
from infra.config import settings
from infra.patron_repository import PatronRepository
from worker.tasks import _upload_temp_frame, enroll_face

router = APIRouter(prefix="/patrons", tags=["patrons"])

USER_SERVICE = settings.user_service_url
INTERNAL_KEY = settings.internal_api_key


def _camel_to_snake(name: str) -> str:
    import re
    s1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _convert_keys(obj: dict) -> dict:
    return {_camel_to_snake(k): v for k, v in obj.items()}


async def _proxy_to_user_service(method: str, path: str, body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = {}
        if INTERNAL_KEY:
            headers["X-Internal-Api-Key"] = INTERNAL_KEY
        resp = await client.request(method, f"{USER_SERVICE}{path}", json=body, headers=headers)
        if resp.status_code >= 400:
            detail = resp.json().get("error", "Patron operation failed")
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


async def _patron_to_public(user_data: dict, db: AsyncSession) -> PatronPublic:
    repo = PatronRepository(db)
    user_id = uuid.UUID(user_data["id"])
    face = await repo.get_active_face(user_id)
    return PatronPublic(
        id=user_data["id"],
        full_name=user_data.get("fullName") or user_data.get("full_name", ""),
        student_code=user_data.get("studentCode") or user_data.get("student_code", ""),
        class_name=user_data.get("className") or user_data.get("class_name"),
        identity_number=user_data.get("identityNumber") or user_data.get("identity_number"),
        email=user_data.get("email"),
        phone=user_data.get("phone"),
        card_number=user_data.get("cardNumber") or user_data.get("card_number", ""),
        issue_date=user_data.get("issueDate") or user_data.get("issue_date"),
        membership_expiry=user_data.get("membershipExpiry") or user_data.get("membership_expiry", ""),
        status=user_data.get("status", "active"),
        current_status=user_data.get("currentStatus") or user_data.get("current_status", "outside"),
        created_at=user_data.get("createdAt") or user_data.get("created_at"),
        updated_at=user_data.get("updatedAt") or user_data.get("updated_at"),
        has_face=face is not None,
    )


@router.post("/register", response_model=PatronAuthResponse)
async def register_patron(
    body: PatronRegisterRequest,
):
    result = await _proxy_to_user_service("POST", "/patrons/register", body.model_dump())
    user_data = result.get("patron", result.get("user", {}))
    return PatronAuthResponse(
        access_token=result["access_token"],
        token_type="bearer",
        patron=PatronPublic(**_convert_keys(user_data)),
    )


@router.post("/login", response_model=PatronAuthResponse)
async def login_patron(
    body: PatronLoginRequest,
):
    result = await _proxy_to_user_service("POST", "/patrons/login", body.model_dump())
    user_data = result.get("patron", result.get("user", {}))
    return PatronAuthResponse(
        access_token=result["access_token"],
        token_type="bearer",
        patron=PatronPublic(**_convert_keys(user_data)),
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
    result = await _proxy_to_user_service(
        "GET", f"/patrons/search?q={q or ''}&status={status or ''}&skip={skip}&limit={limit}"
    )
    items = result.get("items", result if isinstance(result, list) else [])
    augmented = []
    for item in items:
        augmented.append(await _patron_to_public(item, db))
    return augmented


@router.get("/lookup")
async def lookup_patron(
    student_code: Optional[str] = Query(None),
    card_number: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    params = {}
    if student_code:
        params["student_code"] = student_code
    elif card_number:
        params["card_number"] = card_number
    else:
        return {"exists": False, "patron": None, "has_face": False, "is_expired": False}

    result = await _proxy_to_user_service("GET", f"/patrons/lookup?{'&'.join(f'{k}={v}' for k, v in params.items())}")
    if result.get("exists"):
        result["patron"] = (await _patron_to_public(result["patron"], db)).model_dump()
        user_id = uuid.UUID(result["patron"]["id"])
        result["has_face"] = await repo.get_active_face(user_id) is not None
    return result


@router.get("/{patron_id}")
async def get_patron(
    patron_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    result = await _proxy_to_user_service("GET", f"/patrons/{patron_id}")
    return await _patron_to_public(result, db)


@router.post("")
async def create_patron(
    body: PatronCreate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    result = await _proxy_to_user_service("POST", "/patrons", body.model_dump())
    return await _patron_to_public(result, db)


@router.put("/{patron_id}")
async def update_patron(
    patron_id: uuid.UUID,
    body: PatronUpdate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    result = await _proxy_to_user_service(
        "PUT", f"/patrons/{patron_id}", body.model_dump(mode='json', exclude_none=True)
    )
    return await _patron_to_public(result, db)


@router.delete("/{patron_id}")
async def delete_patron(
    patron_id: uuid.UUID,
    _=Depends(get_current_user),
):
    return await _proxy_to_user_service("DELETE", f"/patrons/{patron_id}")


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
    user = await repo.get_by_id(patron_id)
    if not user:
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

    from celery import Celery
    celery_app = Celery(
        "tasks",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
    )
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
