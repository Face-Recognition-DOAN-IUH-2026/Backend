from __future__ import annotations

import asyncio
import json
import uuid
from typing import Optional, Annotated

import httpx
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user, get_db_session, require_internal_key_or_staff, require_role
from core.schemas import PatronCreate, PatronPublic, PatronUpdate, PatronLoginRequest, PatronAuthResponse
from core.service_token import get_auth_headers
from core.uploads import validate_image_upload
from infra.config import settings
from infra.milvus_client import get_milvus_client
from infra.patron_repository import PatronRepository
from pydantic import BaseModel
from worker.tasks import _upload_temp_frame, batch_enroll_task


class BatchEnrollmentStatusRequest(BaseModel):
    user_ids: list[str]


router = APIRouter(prefix="/patrons", tags=["patrons"])

USER_SERVICE = settings.user_service_url


def _internal_headers() -> dict[str, str]:
    return get_auth_headers(
        service_name="face-recognition-service",
        scopes=["patrons:read"],
        secret=settings.service_jwt_secret,
    )


def _camel_to_snake(name: str) -> str:
    import re
    s1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _convert_keys(obj: dict) -> dict:
    return {_camel_to_snake(k): v for k, v in obj.items()}


def _snake_to_camel(name: str) -> str:
    import re
    return re.sub(r'_([a-z])', lambda m: m.group(1).upper(), name)


def _to_camel_case(obj: dict) -> dict:
    return {_snake_to_camel(k): v for k, v in obj.items()}


def _required_date(value: object, fallback: str = "2099-12-31") -> object:
    return value or fallback


async def _proxy_to_user_service(method: str, path: str, body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        headers = _internal_headers()
        resp = await client.request(method, f"{USER_SERVICE}{path}", json=body, headers=headers)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("error") or resp.json().get("detail") or "Patron operation failed"
            except Exception:
                detail = f"User service error (status {resp.status_code}): {resp.text[:200]}"
            raise HTTPException(status_code=resp.status_code, detail=detail)
        try:
            return resp.json()
        except Exception:
            raise HTTPException(status_code=502, detail="Invalid response from user service")


async def _get_user_summary(user_id: uuid.UUID) -> dict:
    return await _proxy_to_user_service("GET", f"/internal/users/{user_id}")


async def _patron_to_public(user_data: dict, db: AsyncSession) -> PatronPublic:
    repo = PatronRepository(db)
    if "id" not in user_data:
        raise HTTPException(status_code=502, detail="User service returned no ID")
    try:
        user_id = uuid.UUID(str(user_data["id"]))
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=502, detail=f"Invalid user ID format: {user_data.get('id')}")
    face = await repo.get_active_face(user_id)
    return PatronPublic(
        id=str(user_data["id"]),
        full_name=user_data.get("fullName") or user_data.get("full_name") or "",
        student_code=user_data.get("studentCode") or user_data.get("student_code") or "",
        class_name=user_data.get("className") or user_data.get("class_name"),
        identity_number=user_data.get("identityNumber") or user_data.get("identity_number"),
        email=user_data.get("email"),
        phone=user_data.get("phone"),
        card_number=user_data.get("cardNumber") or user_data.get("card_number") or "",
        issue_date=user_data.get("issueDate") or user_data.get("issue_date"),
        membership_expiry=_required_date(user_data.get("membershipExpiry") or user_data.get("membership_expiry")),
        status=user_data.get("status") or "active",
        current_status=user_data.get("currentStatus") or user_data.get("current_status") or "outside",
        created_at=user_data.get("createdAt") or user_data.get("created_at"),
        updated_at=user_data.get("updatedAt") or user_data.get("updated_at"),
        has_face=face is not None,
        course=user_data.get("course"),
        permanent_address=user_data.get("permanentAddress") or user_data.get("permanent_address"),
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
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    result = await _proxy_to_user_service(
        "GET", f"/internal/patrons/search?q={q or ''}&status={status or ''}&skip={skip}&limit={limit}"
    )
    items = result.get("items", result if isinstance(result, list) else [])
    augmented = []
    for item in items:
        augmented.append(await _patron_to_public(item, db))
    return {"items": augmented, "total": result.get("total", len(augmented))}


@router.get("/lookup")
async def lookup_patron(
    student_code: Optional[str] = Query(None),
    card_number: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    _auth: None = Depends(require_internal_key_or_staff),
):
    repo = PatronRepository(db)
    params = {}
    if student_code:
        params["student_code"] = student_code
    elif card_number:
        params["card_number"] = card_number
    else:
        return {"exists": False, "patron": None, "has_face": False, "is_expired": False}

    result = await _proxy_to_user_service("GET", f"/internal/patrons/lookup?{'&'.join(f'{k}={v}' for k, v in params.items())}")
    if result.get("exists"):
        result["patron"] = (await _patron_to_public(result["patron"], db)).model_dump()
        user_id = uuid.UUID(result["patron"]["id"])
        result["has_face"] = await repo.get_active_face(user_id) is not None
    return result


@router.post("/batch-enrollment-status")
@router.post("/internal/batch-status")
async def check_batch_enrollment_status(
    body: BatchEnrollmentStatusRequest,
):
    user_ids = body.user_ids
    statuses: dict[str, bool] = {uid: False for uid in user_ids}
    if not user_ids:
        return {"statuses": statuses}

    try:
        mc = get_milvus_client()
        rows = mc.client.query(
            mc.collection_name,
            filter=f'user_id in {json.dumps(user_ids)}',
            output_fields=["user_id"],
            limit=len(user_ids) * 4,
        )
        enrolled = {r["user_id"] for r in rows}
        for uid in user_ids:
            statuses[uid] = uid in enrolled
    except Exception:
        pass

    return {"statuses": statuses}


@router.get("/{patron_id}")
async def get_patron(
    patron_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    result = await _proxy_to_user_service("GET", f"/internal/patrons/{patron_id}")
    return await _patron_to_public(result, db)


@router.post("")
async def create_patron(
    body: PatronCreate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    body_dict = body.model_dump()
    body_dict["membership_expiry"] = str(body_dict["membership_expiry"])
    if body_dict.get("issue_date"):
        body_dict["issue_date"] = str(body_dict["issue_date"])
    result = await _proxy_to_user_service("POST", "/internal/patrons", body_dict)
    return await _patron_to_public(result, db)


@router.put("/{patron_id}")
async def update_patron(
    patron_id: uuid.UUID,
    body: PatronUpdate,
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    body_dict = body.model_dump(mode='json', exclude_none=True)
    if body_dict.get("membership_expiry"):
        body_dict["membership_expiry"] = str(body_dict["membership_expiry"])
    result = await _proxy_to_user_service(
        "PUT", f"/internal/patrons/{patron_id}", body_dict
    )
    return await _patron_to_public(result, db)


@router.delete("/{patron_id}")
async def delete_patron(
    patron_id: uuid.UUID,
    _=Depends(get_current_user),
):
    return await _proxy_to_user_service("DELETE", f"/internal/patrons/{patron_id}")


@router.post("/{patron_id}/enroll-batch")
async def enroll_patron_face_batch(
    patron_id: uuid.UUID,
    frontal: UploadFile = File(...),
    right: UploadFile = File(...),
    left: UploadFile = File(...),
    down: UploadFile = File(...),
    consent_given: bool = Form(False),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    await _get_user_summary(patron_id)

    if not consent_given:
        raise HTTPException(400, "Consent not given")

    raw_frontal = await frontal.read()
    raw_right = await right.read()
    raw_left = await left.read()
    raw_down = await down.read()
    for raw in (raw_frontal, raw_right, raw_left, raw_down):
        validate_image_upload(raw)

    try:
        keys = await asyncio.gather(
            run_in_threadpool(_upload_temp_frame, raw_frontal, str(uuid.uuid4())),
            run_in_threadpool(_upload_temp_frame, raw_right, str(uuid.uuid4())),
            run_in_threadpool(_upload_temp_frame, raw_left, str(uuid.uuid4())),
            run_in_threadpool(_upload_temp_frame, raw_down, str(uuid.uuid4())),
        )
    except Exception as exc:
        raise HTTPException(500, f"Failed to store temp frames: {exc}")

    task = batch_enroll_task.delay(str(patron_id), keys)
    return {"success": True, "message": "Face enrolled successfully (4 angles)", "patron_id": str(patron_id), "job_id": task.id}


@router.post("/{patron_id}/enroll-face", status_code=410)
async def enroll_patron_face_legacy(
    patron_id: uuid.UUID,
):
    raise HTTPException(
        status_code=410,
        detail="Single-image enrollment is deprecated. Use /enroll-batch with 4 angles (frontal, right, left, down).",
    )
