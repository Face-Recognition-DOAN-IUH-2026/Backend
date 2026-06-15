from __future__ import annotations

import uuid as _uuid
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db_session
from core.schemas import KioskResult, PatronPublic
from infra.config import settings
from infra.milvus_client import MilvusClient as _MilvusClient
from infra.minio_client import MinioStorage as _MinioStorage
from infra.patron_repository import PatronRepository
from infra.redis_cache import redis_client as _redis_client
from worker.celery_app import celery_app as _celery_app
from worker.tasks import _upload_temp_frame

USER_SERVICE = settings.user_service_url
INTERNAL_KEY = settings.internal_api_key

router = APIRouter(prefix="/kiosk", tags=["kiosk"])
celery_app = _celery_app


def _internal_headers() -> dict:
    headers = {}
    if INTERNAL_KEY:
        headers["X-Internal-Api-Key"] = INTERNAL_KEY
    return headers


def _get_milvus_client() -> _MilvusClient:
    return _MilvusClient(
        host=settings.milvus_host,
        port=settings.milvus_port,
        collection_name=settings.milvus_collection,
        dim=512,
    )


async def _store_temp_frame(raw: bytes) -> str:
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))
    _redis_client.setex(f"temp_frame:{object_key}", 120, raw)
    return object_key


async def _proxy_lookup_user(student_code: Optional[str] = None, card_number: Optional[str] = None) -> dict | None:
    params = {}
    if student_code:
        params["student_code"] = student_code
    if card_number:
        params["card_number"] = card_number
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{USER_SERVICE}/internal/patrons/lookup", params=params, headers=_internal_headers())
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail="Failed to lookup patron")
        data = resp.json()
        return data.get("patron") if data.get("exists") else None


async def _proxy_get_user(user_id: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{USER_SERVICE}/internal/patrons/{user_id}", headers=_internal_headers())
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail="Patron not found")
        return resp.json()


async def _proxy_create_user(body: dict) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(f"{USER_SERVICE}/internal/patrons", json=body, headers=_internal_headers())
        if resp.status_code >= 400:
            detail = resp.json().get("error", "Failed to create patron")
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return resp.json()


async def _proxy_delete_user(user_id: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.delete(f"{USER_SERVICE}/internal/patrons/{user_id}", headers=_internal_headers())


async def _patron_to_public(user: dict, repo: PatronRepository) -> PatronPublic:
    user_id = _uuid.UUID(str(user["id"]))
    face = await repo.get_active_face(user_id)
    return PatronPublic(
        id=str(user_id),
        full_name=user.get("fullName") or user.get("full_name") or "",
        student_code=user.get("studentCode") or user.get("student_code") or "",
        class_name=user.get("className") or user.get("class_name"),
        identity_number=user.get("identityNumber") or user.get("identity_number"),
        email=user.get("email"),
        phone=user.get("phone"),
        card_number=user.get("cardNumber") or user.get("card_number") or "",
        issue_date=user.get("issueDate") or user.get("issue_date"),
        membership_expiry=user.get("membershipExpiry") or user.get("membership_expiry") or date(2099, 12, 31),
        status=user.get("status") or "active",
        current_status=user.get("currentStatus") or user.get("current_status") or "outside",
        created_at=user.get("createdAt") or user.get("created_at"),
        updated_at=user.get("updatedAt") or user.get("updated_at"),
        has_face=face is not None,
    )


def _is_expired(user: dict) -> bool:
    expiry_raw = user.get("membershipExpiry") or user.get("membership_expiry")
    return bool(expiry_raw and str(expiry_raw)[:10] < str(date.today()))


@router.post("/lookup")
async def kiosk_lookup(
    student_code: Optional[str] = None,
    card_number: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    user = await _proxy_lookup_user(student_code=student_code, card_number=card_number)
    if not user:
        return {"exists": False, "patron": None, "has_face": False, "is_expired": False}
    user_id = _uuid.UUID(str(user["id"]))
    return {
        "exists": True,
        "patron": (await _patron_to_public(user, repo)).model_dump(),
        "has_face": await repo.get_active_face(user_id) is not None,
        "is_expired": _is_expired(user),
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
    if await _proxy_lookup_user(student_code=student_code):
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
    user = await _proxy_get_user(user_data["id"])
    return KioskResult(
        success=True,
        message="Patron created. Face enrollment in progress.",
        patron=await _patron_to_public(user, repo),
        job_id=task.id,
    )


@router.post("/enter")
async def kiosk_enter(
    image: UploadFile,
    student_code: str = Form(...),
    db: AsyncSession = Depends(get_db_session),
):
    repo = PatronRepository(db)
    user = await _proxy_lookup_user(student_code=student_code)
    if not user:
        raise HTTPException(404, "Patron not found")
    if _is_expired(user):
        return KioskResult(success=False, message="Membership has expired")

    user_id = _uuid.UUID(str(user["id"]))
    face = await repo.get_active_face(user_id)
    if not face:
        return KioskResult(success=False, message="Patron has no enrolled face")

    raw = await image.read()
    object_key = await _store_temp_frame(raw)
    task = celery_app.send_task(
        "verify_face",
        kwargs={"patron_id": str(user_id), "object_key": object_key},
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
    if await _proxy_lookup_user(student_code=student_code):
        raise HTTPException(409, "Student code already exists")

    raws = {
        "frontal": await image_frontal.read(),
        "right": await image_right.read(),
        "left": await image_left.read(),
        "down": await image_down.read(),
    }
    keys = {angle: await _store_temp_frame(raw) for angle, raw in raws.items()}
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
    if result.get("status") == "error":
        error_msgs = [f"{r['angle']}: {r.get('error', 'Unknown error')}" for r in result.get("results", []) if r.get("status") == "error"]
        try:
            _get_milvus_client().delete_by_user_id(user_id=user_data["id"])
        except Exception:
            pass
        try:
            sto = _MinioStorage()
            for angle in ["frontal", "right", "left", "down"]:
                sto.delete_image(f"enrollments/{user_data['id']}_{angle}.jpg")
        except Exception:
            pass
        await _proxy_delete_user(user_data["id"])
        raise HTTPException(400, f"Dang ky that bai. Loi cac goc: {', '.join(error_msgs)}")

    user = await _proxy_get_user(user_data["id"])
    return KioskResult(
        success=True,
        message="Da tao doc gia voi day du 4 goc khuon mat.",
        patron=await _patron_to_public(user, repo),
    )


@router.post("/enroll-face/{patron_id}")
async def kiosk_enroll_face(
    patron_id: _uuid.UUID,
    image: UploadFile,
    angle: str = Form("frontal"),
):
    await _proxy_get_user(str(patron_id))
    raw = await image.read()
    object_key = await _store_temp_frame(raw)
    task = celery_app.send_task(
        "enroll_face",
        kwargs={"patron_id": str(patron_id), "object_key": object_key, "angle": angle},
    )
    result = await run_in_threadpool(task.get, timeout=60)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("error", "Unknown error"))
    return {"success": True, "message": f"Face enrolled at angle '{angle}'"}
