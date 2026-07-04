from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from api.dependencies import get_current_user
from core.schemas import CameraStatusResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/camera", tags=["camera"])


def _get_stream_service():
    from worker.stream_service import stream_service
    return stream_service


@router.get("/snapshot/{camera_id}")
async def camera_snapshot(camera_id: str, _=Depends(get_current_user)):
    ss = _get_stream_service()
    jpeg = ss.get_last_frame_jpeg(camera_id)
    if jpeg is None:
        raise HTTPException(status_code=503, detail=f"Camera {camera_id} not connected")
    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/status", response_model=List[CameraStatusResponse])
async def get_camera_status(_=Depends(get_current_user)):
    ss = _get_stream_service()
    return ss.get_all_status()


@router.get("/status/{camera_id}", response_model=CameraStatusResponse)
async def get_camera_status_by_id(camera_id: str, _=Depends(get_current_user)):
    ss = _get_stream_service()
    status = ss.get_status(camera_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
    return status


@router.post("/reconnect/{camera_id}")
async def reconnect_camera(camera_id: str, _=Depends(get_current_user)):
    ss = _get_stream_service()
    ok = ss.reconnect(camera_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
    return {"message": f"Camera {camera_id} reconnection triggered"}


@router.post("/reconnect-all")
async def reconnect_all_cameras(_=Depends(get_current_user)):
    ss = _get_stream_service()
    ids = []
    for s in ss.get_all_status():
        ss.reconnect(s["camera_id"])
        ids.append(s["camera_id"])
    return {"message": "Reconnection triggered for all cameras", "cameras": ids}
