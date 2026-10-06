from __future__ import annotations

import logging
import os
import uuid as _uuid
from datetime import date
from typing import Optional

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db_session
from core.schemas import KioskResult, PatronPublic
from core.service_token import get_auth_headers
from infra.config import settings
from infra.milvus_client import MilvusClient as _MilvusClient
from infra.minio_client import MinioStorage as _MinioStorage
from infra.patron_repository import PatronRepository
from infra.redis_cache import redis_client as _redis_client
from worker.anti_spoofing import (
    decide_active_verdict,
    is_active_liveness_enabled,
    verify_challenge_motion,
)
from worker.celery_app import celery_app as _celery_app
from worker.face_model import check_liveness, get_model
from worker.tasks import _upload_temp_frame

USER_SERVICE = settings.user_service_url


def _internal_headers() -> dict[str, str]:
    return get_auth_headers(
        service_name="face-recognition-service",
        scopes=["patrons:read"],
        secret=settings.service_jwt_secret,
    )

router = APIRouter(prefix="/kiosk", tags=["kiosk"])
celery_app = _celery_app
logger = logging.getLogger(__name__)


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


MAX_CHALLENGE_FRAME_BYTES = 5 * 1024 * 1024


def _validate_challenge_frame(raw: bytes) -> None:
    if not raw or len(raw) > MAX_CHALLENGE_FRAME_BYTES:
        raise ValueError("Invalid frame size")
    if not (raw[:3] == b"\xff\xd8\xff" or raw[:8] == b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid image data")


def _analyze_frame_liveness(raw: bytes) -> float:
    """Score one challenge frame. Undecodable frames fail closed at 0.0."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image data")
    try:
        return float(check_liveness(img).get("liveness_score", 0.0) or 0.0)
    except Exception:
        return 0.0


def _extract_frame_kps(raw: bytes) -> list | None:
    """insightface 5-point kps for one frame, or None (fail-closed: no motion proof)."""
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    try:
        face = get_model().detect_face_once(img).get("face")
        kps = getattr(face, "kps", None)
        return np.asarray(kps, dtype=np.float64).tolist() if kps is not None else None
    except Exception:
        return None


async def _record_challenge_spoof(student_code: str | None, patron_id: str | None) -> None:
    """Fire-and-forget audit of a challenge-caught spoof.

    Never fails the verdict response: recording is best-effort, the worker
    passive path remains the backstop.
    """
    try:
        payload: dict = {
            "camera_id": "kiosk",
            "status": "spoof",
            "patron_id": patron_id,
            "student_code": student_code,
            "source": "face-recognition-service",
        }
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{settings.access_service_url}/internal/access/recognition-events",
                json=payload,
                headers=_internal_headers(),
            )
    except Exception as exc:
        logger.warning("Challenge spoof audit failed (best-effort): %s", exc)


@router.post("/liveness-active")
async def kiosk_liveness_active(
    frames: list[UploadFile] = File(...),
    student_code: Optional[str] = Form(None),
    patron_id: Optional[str] = Form(None),
):
    """Synchronous active-liveness challenge for the kiosk path.

    Accepts the configured number of frames, scores each with the same
    analyzer as the worker, and bands the average into live/inconclusive/spoof.
    """
    if not is_active_liveness_enabled(settings.enable_active_liveness):
        raise HTTPException(status_code=400, detail="Active liveness challenge is disabled")
    expected = settings.active_liveness_frames
    if len(frames) != expected:
        raise HTTPException(status_code=422, detail=f"Expected {expected} frames, got {len(frames)}")
    raws: list[bytes] = []
    for frame in frames:
        raw = await frame.read()
        try:
            _validate_challenge_frame(raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        raws.append(raw)
    scores: list[float] = []
    kps_list: list = []
    for raw in raws:
        try:
            score = await run_in_threadpool(_analyze_frame_liveness, raw)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        scores.append(max(0.0, min(1.0, score)))
        kps_list.append(await run_in_threadpool(_extract_frame_kps, raw))
    avg_score = sum(scores) / len(scores)
    motion = verify_challenge_motion(kps_list)
    verdict = decide_active_verdict(avg_score, motion["has_motion"])
    if verdict == "spoof":
        await _record_challenge_spoof(student_code, patron_id)
    return {
        "is_live": verdict == "live",
        "liveness_score": avg_score,
        "verdict": verdict,
        "frames_evaluated": len(scores),
        "detail": (
            f"{len(scores)} frames averaged {avg_score:.3f}, "
            f"motion displacement {motion['displacement']:.3f}"
        ),
        "motion_displacement": motion["displacement"],
        "student_code": student_code,
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
        raise HTTPException(400, f"Đăng ký thất bại. Lỗi các góc: {', '.join(error_msgs)}")

    user = await _proxy_get_user(user_data["id"])
    return KioskResult(
        success=True,
        message="Đã tạo độc giả với đầy đủ 4 góc khuôn mặt.",
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
