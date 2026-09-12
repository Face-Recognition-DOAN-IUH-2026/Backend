import io
import base64
import time
from typing import Optional, Dict
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from PIL import Image
import cv2
import numpy as np

from core.model import engine
from core.parser import draw_detection_results
from core.temporal import TemporalFireFilter
from core.messaging import hazard_publisher
from core.incident_logger import incident_logger

router = APIRouter(prefix="/api/v1/detect", tags=["Detection"])

# Quản lý bộ lọc theo từng Camera ID
camera_filters: Dict[str, TemporalFireFilter] = {}


def get_camera_filter(camera_id: str) -> TemporalFireFilter:
    if camera_id not in camera_filters:
        camera_filters[camera_id] = TemporalFireFilter()
    return camera_filters[camera_id]


@router.post("/image")
async def detect_fire_in_image(
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
    return_annotated: bool = Form(True),
    camera_id: str = Form("CAM-PCCC-01"),
    location: str = Form("Kho sách Tầng 1")
):
    """
    Phát hiện lửa và khói từ file ảnh tải lên.
    """
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Không thể đọc file ảnh: {str(e)}")

    # Dự đoán bằng NVIDIA LocateAnything-3B
    boxes, raw_text, latency_ms = engine.predict(image, prompt=prompt)

    # Yêu cầu độ tin cậy từ 60% (>= 0.60) trở lên mới kích hoạt báo động
    ALARM_CONF_THRESHOLD = 0.60
    confirmed_boxes = [b for b in boxes if b.get("confidence", 0.9) >= ALARM_CONF_THRESHOLD]

    fire_count = sum(1 for b in confirmed_boxes if b["label"] == "fire")
    smoke_count = sum(1 for b in confirmed_boxes if b["label"] == "smoke")

    annotated_base64 = None
    if return_annotated:
        img_np = np.array(image)
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        annotated_bgr = draw_detection_results(img_bgr, confirmed_boxes, is_confirmed=(fire_count > 0 or smoke_count > 0))
        _, buffer = cv2.imencode(".jpg", annotated_bgr)
        annotated_base64 = base64.b64encode(buffer).decode("utf-8")

    # Lưu vĩnh viễn vào nhật ký sự cố và phát thông báo khẩn nếu phát hiện lửa/khói với độ tin cậy >= 60%
    incident_record = None
    if fire_count > 0 or smoke_count > 0:
        max_conf = max([b.get("confidence", 0.9) for b in confirmed_boxes], default=0.92)
        hazard_type = "fire" if fire_count > 0 else "smoke"
        incident_record = incident_logger.log_incident(
            camera_id=camera_id,
            location=location,
            hazard_type=hazard_type,
            confidence=max_conf,
            fire_count=fire_count,
            smoke_count=smoke_count,
            boxes=confirmed_boxes,
            thumbnail_base64=f"data:image/jpeg;base64,{annotated_base64}" if annotated_base64 else None
        )

        # Gửi sự kiện báo cháy tức thời lên RabbitMQ để thông báo cho toàn hệ thống
        hazard_payload = {
            "camera_id": camera_id,
            "location": location,
            "timestamp": time.time(),
            "hazard_type": hazard_type,
            "confidence": float(max_conf),
            "fire_count": fire_count,
            "smoke_count": smoke_count,
            "confirmed_boxes": confirmed_boxes,
            "thumbnail_base64": f"data:image/jpeg;base64,{annotated_base64}" if annotated_base64 else None
        }
        hazard_publisher.publish_fire_hazard(hazard_payload)

    return {
        "success": True,
        "filename": file.filename,
        "image_size": {"width": image.width, "height": image.height},
        "has_fire": fire_count > 0,
        "has_smoke": smoke_count > 0,
        "fire_count": fire_count,
        "smoke_count": smoke_count,
        "boxes": boxes,
        "latency_ms": latency_ms,
        "raw_response": raw_text,
        "annotated_image_base64": f"data:image/jpeg;base64,{annotated_base64}" if annotated_base64 else None,
        "incident_logged": incident_record is not None
    }


@router.post("/stream/feed-frame")
async def feed_stream_frame(
    camera_id: str = Form(...),
    location: str = Form("Zone Camera"),
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None)
):
    """
    Nhận frame liên tục từ Camera stream.
    Tự động áp dụng bộ lọc Temporal Filter chống báo động giả.
    Nếu xác nhận cháy, tự động gửi message lên RabbitMQ.
    """
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi đọc ảnh: {str(e)}")

    boxes, raw_text, latency_ms = engine.predict(image, prompt=prompt)

    # Đưa qua bộ lọc độ tin cậy >= 60%
    ALARM_CONF_THRESHOLD = 0.60
    reliable_boxes = [b for b in boxes if b.get("confidence", 0.9) >= ALARM_CONF_THRESHOLD]

    # Đưa qua bộ lọc thời gian
    cam_filter = get_camera_filter(camera_id)
    filter_result = cam_filter.update(reliable_boxes)

    has_confirmed_hazard = filter_result["has_hazard"]

    # Nếu phát hiện nguy cơ thật sự qua nhiều frame
    if has_confirmed_hazard:
        hazard_payload = {
            "camera_id": camera_id,
            "location": location,
            "timestamp": time.time(),
            "hazard_type": "FIRE_OR_SMOKE",
            "confirmed_boxes": filter_result["confirmed_boxes"],
            "raw_boxes_count": len(boxes)
        }
        hazard_publisher.publish_fire_hazard(hazard_payload)

        # Ghi log sự cố bền vững
        f_count = sum(1 for b in filter_result["confirmed_boxes"] if b.get("label") == "fire")
        s_count = sum(1 for b in filter_result["confirmed_boxes"] if b.get("label") == "smoke")
        incident_logger.log_incident(
            camera_id=camera_id,
            location=location,
            hazard_type="fire" if f_count > 0 else "smoke",
            confidence=0.95,
            fire_count=f_count,
            smoke_count=s_count,
            boxes=filter_result["confirmed_boxes"]
        )

    return {
        "camera_id": camera_id,
        "timestamp": time.time(),
        "instant_boxes": boxes,
        "is_confirmed_hazard": has_confirmed_hazard,
        "filter_status": filter_result,
        "latency_ms": latency_ms
    }


@router.get("/incidents")
def get_incident_logs(limit: int = 50, skip: int = 0):
    """
    Lấy danh sách lịch sử các vụ phát hiện cháy nổ.
    """
    records = incident_logger.get_incidents(limit=limit, skip=skip)
    return {
        "success": True,
        "total": len(records),
        "items": records
    }


@router.delete("/incidents")
def clear_incident_logs():
    """
    Xóa hoặc làm mới sổ nhật ký sự cố PCCC.
    """
    incident_logger.clear()
    return {"success": True, "message": "Đã làm mới sổ nhật ký sự cố PCCC"}


@router.get("/cameras")
def get_monitored_cameras():
    """
    Lấy danh sách các camera đang được theo dõi và trạng thái bộ lọc.
    """
    result = {}
    for cam_id, f in camera_filters.items():
        result[cam_id] = {
            "active_tracks": len(f.tracked_objects),
            "tracks": [
                {
                    "label": t.label,
                    "consecutive_hits": t.consecutive_hits,
                    "is_confirmed": t.is_confirmed
                }
                for t in f.tracked_objects
            ]
        }
    return result
