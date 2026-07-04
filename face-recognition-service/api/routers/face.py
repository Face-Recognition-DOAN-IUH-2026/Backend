from __future__ import annotations

import asyncio
import base64
import uuid as _uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from api.dependencies import get_current_user, require_role
from core.schemas import (
    EnrollmentResult,
    IdentificationResult,
    LivenessResult,
    ProcessRequest,
    ProcessResult,
    VerificationResult,
)
from infra.cooldown import CooldownService
from infra.redis_cache import redis_client
from worker.tasks import (
    _upload_temp_frame,
    delete_user_task,
    enroll_task,
    identify_task,
    liveness_task,
    process_image_task,
    verify_task,
    batch_enroll_task,
)

router = APIRouter(prefix="/face", tags=["face"])
cooldown = CooldownService()


async def _store_temp_frame(raw: bytes) -> str:
    """Upload to MinIO and also store in Redis for fast worker access."""
    object_key = await run_in_threadpool(_upload_temp_frame, raw, str(_uuid.uuid4()))
    redis_client.setex(f"temp_frame:{object_key}", 120, raw)
    return object_key


class ProcessSyncRequest(BaseModel):
    """Request body for synchronous face processing (kiosk flow)."""
    image: str = Field(..., description="Base64-encoded image data")
    camera_id: str = Field(default="unknown", min_length=1)
    process_type: str = Field(default="face_recognition", pattern="^(face_recognition|liveness_check|verify|identify)$")
    consent_given: bool = True
    target_user_id: str | None = None
    connection_id: str | None = Field(default=None, description="SSE connection ID for result push")


class ProcessSyncResult(BaseModel):
    """Synchronous processing result."""
    status: str
    process_type: str
    result: dict
    processing_time_ms: float


@router.post("/enroll-batch", response_model=EnrollmentResult, status_code=status.HTTP_202_ACCEPTED)
async def enroll_batch(
    frontal: UploadFile = File(...),
    right: UploadFile = File(...),
    left: UploadFile = File(...),
    down: UploadFile = File(...),
    consent_given: bool = Form(True),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    raw_frontal = await frontal.read()
    raw_right = await right.read()
    raw_left = await left.read()
    raw_down = await down.read()
    try:
        keys = await asyncio.gather(
            _store_temp_frame(raw_frontal),
            _store_temp_frame(raw_right),
            _store_temp_frame(raw_left),
            _store_temp_frame(raw_down),
        )
    except Exception as exc:
        print(f"ERROR: enroll-batch _store_temp_frame failed: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to store temp frames: {exc}")
    task = batch_enroll_task.delay(user_id=current_user["id"], object_keys=keys)
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
    object_key = await _store_temp_frame(raw)
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
    object_key = await _store_temp_frame(raw)
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
    object_key = await _store_temp_frame(raw)
    task = liveness_task.delay(object_key=object_key)
    return LivenessResult(job_id=task.id)


@router.post("/process", response_model=ProcessResult, status_code=status.HTTP_202_ACCEPTED)
async def process_image(
    file: UploadFile = File(...),
    camera_id: str = Form("unknown"),
    process_type: str = Form("face_recognition"),
    consent_given: bool = Form(True),
    target_user_id: str | None = Form(None),
    current_user: dict = Depends(get_current_user),
):
    if not consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if process_type not in ("face_recognition", "liveness_check", "verify", "identify"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid process_type: {process_type}",
        )
    if process_type == "verify" and not target_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_user_id is required for verify process_type",
        )
    if not await cooldown.acquire(f"process:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large (max 5MB)",
        )
    object_key = await _store_temp_frame(raw)
    task = process_image_task.delay(
        object_key=object_key,
        camera_id=camera_id,
        process_type=process_type,
        user_id=current_user.get("id"),
        target_user_id=target_user_id,
    )
    return ProcessResult(task_id=task.id)


@router.post("/process-sync", response_model=ProcessSyncResult, status_code=status.HTTP_200_OK)
async def process_image_sync(
    request: ProcessSyncRequest,
    current_user: dict = Depends(get_current_user),
):
    """Synchronous face processing for kiosk flow.
    
    Processes image in-memory without MinIO storage.
    Target latency: <100ms for kiosk operations.
    """
    import time
    start_time = time.monotonic()
    
    if not request.consent_given:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Consent not given"
        )
    if request.process_type not in ("face_recognition", "liveness_check", "verify", "identify"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid process_type: {request.process_type}",
        )
    if request.process_type == "verify" and not request.target_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_user_id is required for verify process_type",
        )
    if not await cooldown.acquire(f"process-sync:{current_user['id']}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Cooldown active"
        )
    
    # Decode base64 image
    try:
        raw = base64.b64decode(request.image)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 image data",
        )
    
    if len(raw) > 1 * 1024 * 1024:  # 1MB limit for sync processing
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large for sync processing (max 1MB)",
        )
    
    # Validate image format
    import struct
    def validate_image_format(data: bytes) -> str:
        if data[:3] == b'\xff\xd8\xff':
            return 'JPEG'
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return 'PNG'
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'WebP'
        raise ValueError("Unsupported image format. Allowed: JPEG, PNG, WebP")
    
    try:
        image_format = validate_image_format(raw)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    
    # Validate image dimensions
    import cv2
    import numpy as np
    
    def validate_image_dimensions(data: bytes) -> tuple[int, int]:
        arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if arr is None:
            raise ValueError("Could not decode image")
        h, w = arr.shape[:2]
        if w > 1280 or h > 1280:
            raise ValueError(f"Image dimensions too large: {w}x{h} (max 1280x1280)")
        return w, h
    
    try:
        width, height = validate_image_dimensions(raw)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    
    # Store in Redis with5s TTL for audit trail (no MinIO)
    frame_id = str(_uuid.uuid4())
    object_key = f"temp_frames/{frame_id}.jpg"
    redis_client.setex(f"temp_frame:{object_key}", 5, raw)
    
    # Process synchronously using existing pipeline
    try:
        from worker.tasks_pipeline import (
            safe_read_image_from_bytes,
            resize_if_necessary,
            extract_embedding_placeholder,
            run_liveness_analysis,
        )
        from worker.tasks import _get_milvus, _get_user_info
        from infra.config import settings
        
        # Decode and resize image
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(
            img,
            max_w=settings.max_image_width,
            max_h=settings.max_image_height,
            max_pixels=settings.max_image_pixels,
        )
        
        result = {}
        
        if request.process_type == "face_recognition":
            # Combined identify + liveness pipeline
            embedding = extract_embedding_placeholder(img)
            milvus = _get_milvus()
            matches = milvus.search(embedding=embedding, top_k=5)
            
            # Enrich matches with user info
            enriched_matches = []
            for match in matches:
                user_info = _get_user_info(match["user_id"])
                if user_info:
                    enriched_matches.append({
                        "user_id": match["user_id"],
                        "score": match["score"],
                        "full_name": user_info.get("full_name"),
                        "student_code": user_info.get("student_code"),
                    })
                else:
                    enriched_matches.append({
                        "user_id": match["user_id"],
                        "score": match["score"],
                    })
            
            liveness = run_liveness_analysis(img)
            
            result = {
                "matches": enriched_matches,
                "liveness_score": liveness.get("liveness_score"),
                "is_live": liveness.get("is_live"),
                "breakdown": liveness.get("breakdown"),
            }
            
        elif request.process_type == "verify":
            embedding = extract_embedding_placeholder(img)
            milvus = _get_milvus()
            enrolled_embedding = milvus.get_embedding_by_user_id(request.target_user_id)
            
            if enrolled_embedding:
                import numpy as np
                score = float(np.dot(embedding, enrolled_embedding))
                verified = score >= settings.face_match_threshold
                result = {"verified": verified, "score": score}
            else:
                result = {"verified": False, "score": 0.0, "error": "No enrolled face found"}
                
        elif request.process_type == "identify":
            embedding = extract_embedding_placeholder(img)
            milvus = _get_milvus()
            matches = milvus.search(embedding=embedding, top_k=5)
            
            enriched_matches = []
            for match in matches:
                user_info = _get_user_info(match["user_id"])
                if user_info:
                    enriched_matches.append({
                        "user_id": match["user_id"],
                        "score": match["score"],
                        "full_name": user_info.get("full_name"),
                        "student_code": user_info.get("student_code"),
                    })
                else:
                    enriched_matches.append({
                        "user_id": match["user_id"],
                        "score": match["score"],
                    })
            result = {"matches": enriched_matches}
            
        elif request.process_type == "liveness_check":
            liveness = run_liveness_analysis(img)
            result = {
                "liveness_score": liveness.get("liveness_score"),
                "is_live": liveness.get("is_live"),
                "breakdown": liveness.get("breakdown"),
            }
        
        processing_time_ms = (time.monotonic() - start_time) * 1000
        
        # Broadcast via SSE to access-service
        try:
            import httpx
            from infra.config import settings
            
            broadcast_payload = {
                "image": request.image[:100] + "...",
                "camera_id": request.camera_id,
                "process_type": request.process_type,
                "result": result,
                "connection_id": request.connection_id,
            }
            
            async with httpx.AsyncClient(timeout=1.0) as client:
                await client.post(
                    f"{settings.access_service_url}/internal/access/face-results-sync",
                    json=broadcast_payload,
                )
        except Exception as broadcast_exc:
            # Log but don't fail the request
            print(f"WARNING: SSE broadcast failed: {broadcast_exc}")
        
        return ProcessSyncResult(
            status="success",
            process_type=request.process_type,
            result=result,
            processing_time_ms=round(processing_time_ms, 2),
        )
        
    except Exception as exc:
        processing_time_ms = (time.monotonic() - start_time) * 1000
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Processing failed: {exc}",
        )


@router.delete("/{user_id}", status_code=status.HTTP_202_ACCEPTED)
async def delete_face(
    user_id: str,
    current_user: dict = Depends(require_role("admin")),
):
    task = delete_user_task.delay(user_id=user_id)
    return {"job_id": task.id}
