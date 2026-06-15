from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user, get_db_session
from core.schemas import AccessLogPublic, ActivePatron, StatsResponse
from infra.models import UserModel
from infra.patron_repository import PatronRepository
from infra.sse_manager import sse_manager


router = APIRouter(prefix="/access", tags=["access"])

ACTIVE_CAMERA_IDS = ["entry_gate", "exit_gate", "kiosk"]


@router.get("/events")
async def sse_events():
    return StreamingResponse(
        sse_manager.event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/test-broadcast")
async def test_broadcast(
    status: str = "granted",
    full_name: str = "Test User",
    camera_id: str = "entry_gate",
):
    test_event = {
        "status": status,
        "camera_id": camera_id,
        "patron_id": "test-id",
        "full_name": full_name,
        "student_code": "TEST123",
        "score": 0.95,
        "access_type": "entry",
    }
    await sse_manager.broadcast("camera_event", test_event)
    return {"ok": True, "event": test_event}


async def _resolve_user_map(db: AsyncSession, logs: list) -> dict[str, Any]:
    user_ids = [log.patron_id for log in logs if log.patron_id]
    unique_ids = list({str(pid) for pid in user_ids})
    if not unique_ids:
        return {}
    result = await db.execute(
        select(UserModel).where(
            UserModel.id.in_([uuid.UUID(pid) for pid in unique_ids])
        )
    )
    return {str(u.id): u for u in result.scalars().all()}


@router.get("/recent")
async def get_recent_logs(db: AsyncSession = Depends(get_db_session)):
    repo = PatronRepository(db)
    logs, _ = await repo.get_access_logs(limit=20)
    user_map = await _resolve_user_map(db, logs)

    items = []
    for log in logs:
        u = user_map.get(str(log.patron_id)) if log.patron_id else None
        items.append(
            AccessLogPublic(
                id=str(log.id),
                patron_id=str(log.patron_id) if log.patron_id else None,
                patron_name=u.full_name if u else None,
                student_code=u.student_code if u else None,
                access_type=log.access_type,
                verify_method=log.verify_method,
                confidence=log.confidence,
                camera_id=log.camera_id,
                access_time=log.access_time,
                status=log.status,
            )
        )

    return {"items": items}


@router.get("/logs")
async def get_logs(
    patron_id: Optional[uuid.UUID] = Query(None),
    camera_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    access_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    logs, total = await repo.get_access_logs(
        user_id=patron_id,
        camera_id=camera_id,
        status=status,
        access_type=access_type,
        date_from=date_from,
        date_to=date_to,
        search=search,
        skip=skip,
        limit=limit,
    )
    user_map = await _resolve_user_map(db, logs)
    items = []
    for log in logs:
        u = user_map.get(str(log.patron_id)) if log.patron_id else None
        items.append(
            AccessLogPublic(
                id=str(log.id),
                patron_id=str(log.patron_id) if log.patron_id else None,
                patron_name=u.full_name if u else None,
                student_code=u.student_code if u else None,
                access_type=log.access_type,
                verify_method=log.verify_method,
                confidence=log.confidence,
                camera_id=log.camera_id,
                access_time=log.access_time,
                status=log.status,
            )
        )
    return {"items": items, "total": total}


@router.get("/active")
async def get_active(
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    users = await repo.get_active_users(camera_ids=ACTIVE_CAMERA_IDS)
    face_map = {}
    if users:
        pids = [u.id for u in users]
        from infra.models import PatronFaceModel
        faces = await db.execute(
            select(PatronFaceModel).where(
                PatronFaceModel.patron_id.in_(pids),
                PatronFaceModel.is_active == True,
            )
        )
        face_map = {str(f.patron_id): f for f in faces.scalars().all()}

    result = []
    for u in users:
        face = face_map.get(str(u.id))
        result.append(
            ActivePatron(
                id=str(u.id),
                full_name=u.full_name or "",
                student_code=u.student_code or "",
                entered_at=u.last_entry_at or datetime.utcnow(),
                camera_id=u.last_entry_camera or "",
                image_url=face.image_url if face else None,
                confidence=None,
            )
        )
    return {"items": result, "total": len(result)}


@router.get("/frequency")
async def get_frequency(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    daily = await repo.get_access_frequency(date_from=date_from, date_to=date_to)
    return {"daily": daily}


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    return StatsResponse(
        total_patrons=await repo.count_active(),
        active_patrons=await repo.count_active_inside(camera_ids=ACTIVE_CAMERA_IDS),
        today_entries=await repo.count_today_access("entry"),
        today_exits=await repo.count_today_access("exit"),
    )
