from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user, get_db_session
from core.schemas import AccessLogPublic, ActivePatron, StatsResponse
from infra.patron_repository import PatronRepository
from infra.sse_manager import sse_manager


router = APIRouter(prefix="/access", tags=["access"])


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


@router.get("/recent")
async def get_recent_logs(db: AsyncSession = Depends(get_db_session)):
    repo = PatronRepository(db)
    logs, _ = await repo.get_access_logs(limit=20)

    patron_ids = [log.patron_id for log in logs if log.patron_id]
    unique_ids = list({str(pid) for pid in patron_ids})
    patron_map: dict[str, Any] = {}

    if unique_ids:
        from infra.models import PatronModel

        patrons = await db.execute(
            select(PatronModel).where(
                PatronModel.id.in_([uuid.UUID(pid) for pid in unique_ids])
            )
        )
        patron_map = {str(p.id): p for p in patrons.scalars().all()}

    items = []
    for log in logs:
        p = patron_map.get(str(log.patron_id)) if log.patron_id else None
        items.append(
            AccessLogPublic(
                id=str(log.id),
                patron_id=str(log.patron_id) if log.patron_id else None,
                patron_name=p.full_name if p else None,
                student_code=p.student_code if p else None,
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
        patron_id=patron_id,

        camera_id=camera_id,
        status=status,
        access_type=access_type,
        date_from=date_from,
        date_to=date_to,
        search=search,
        skip=skip,
        limit=limit,
    )
    items = []
    for log in logs:
        patron_name = None
        student_code = None
        if log.patron_id:
            p = await repo.get_by_id(log.patron_id)
            if p:
                patron_name = p.full_name
                student_code = p.student_code
        items.append(
            AccessLogPublic(
                id=str(log.id),
                patron_id=str(log.patron_id) if log.patron_id else None,
                patron_name=patron_name,
                student_code=student_code,
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
    patrons = await repo.get_active_patrons()
    result = []
    for p in patrons:
        latest = await repo.get_latest_entry(p.id)
        face = await repo.get_active_face(p.id)
        result.append(
            ActivePatron(
                id=str(p.id),
                full_name=p.full_name,
                student_code=p.student_code,
                entered_at=latest.access_time if latest else datetime.utcnow(),
                camera_id=latest.camera_id if latest else "",
                image_url=face.image_url if face else None,
                confidence=latest.confidence if latest else None,
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
    today = date.today()
    logs_today, _ = await repo.get_access_logs(skip=0, limit=10000)
    entries = sum(1 for l in logs_today if l.access_type == "entry" and l.access_time.date() == today)
    exits = sum(1 for l in logs_today if l.access_type == "exit" and l.access_time.date() == today)
    return StatsResponse(
        total_patrons=await repo.count_active(),
        active_patrons=len(await repo.get_active_patrons()),
        today_entries=entries,
        today_exits=exits,
    )
