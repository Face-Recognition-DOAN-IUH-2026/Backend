from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
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


@router.get("/recent")
async def get_recent_logs(db: AsyncSession = Depends(get_db_session)):
    repo = PatronRepository(db)
    logs, _ = await repo.get_access_logs(limit=20)
    items = []
    for log in logs:
        patron_name = None
        student_code = None
        if log.patron_id:
            p = await repo.get_by_id(log.patron_id)
            if p:
                patron_name = p.full_name
                student_code = p.student_code
        items.append(AccessLogPublic(
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
        ))
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


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db_session),
    _=Depends(get_current_user),
):
    repo = PatronRepository(db)
    today = date.today()
    logs_today = await repo.get_access_logs(skip=0, limit=10000)
    entries = sum(1 for l in logs_today if l.access_type == "entry" and l.access_time.date() == today)
    exits = sum(1 for l in logs_today if l.access_type == "exit" and l.access_time.date() == today)
    return StatsResponse(
        total_patrons=await repo.count_active(),
        active_patrons=len(await repo.get_active_patrons()),
        today_entries=entries,
        today_exits=exits,
    )
