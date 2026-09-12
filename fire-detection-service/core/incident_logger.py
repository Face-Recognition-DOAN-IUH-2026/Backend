import os
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
import threading

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
LOG_FILE = os.path.join(LOG_DIR, "fire_incidents_log.json")
_lock = threading.Lock()


class FireIncidentLogger:
    """
    Quản lý ghi nhận và lưu trữ lịch sử các sự cố phát hiện cháy nổ.
    Dữ liệu được lưu trữ bền vững (persistent) vào file JSON tại máy chủ.
    """

    def __init__(self, file_path: str = LOG_FILE):
        self.file_path = file_path
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
        if not os.path.exists(self.file_path):
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)

    def log_incident(
        self,
        camera_id: str,
        location: str,
        hazard_type: str,  # 'fire' | 'smoke'
        confidence: float,
        fire_count: int,
        smoke_count: int,
        boxes: List[Dict[str, Any]],
        thumbnail_base64: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Ghi lại một sự cố phát hiện cháy nổ mới vào nhật ký.
        """
        now = datetime.now()
        timestamp_iso = now.isoformat()
        timestamp_display = now.strftime("%H:%M:%S %d/%m/%Y")

        incident_id = f"INC-{int(time.time() * 1000) % 1000000:06d}"
        
        record = {
            "id": incident_id,
            "timestamp": timestamp_display,
            "timestamp_iso": timestamp_iso,
            "camera_id": camera_id,
            "location": location,
            "type": hazard_type,
            "severity": "high" if hazard_type == "fire" else "medium",
            "confidence": round(confidence, 2),
            "fire_count": fire_count,
            "smoke_count": smoke_count,
            "status": "Đã kích hoạt cảnh báo",
            "boxes_count": len(boxes),
            "thumbnail": thumbnail_base64
        }

        with _lock:
            try:
                records = self.get_all_raw()
                # Thêm vào đầu danh sách (mới nhất lên trước)
                records.insert(0, record)
                # Giới hạn tối đa 500 bản ghi
                if len(records) > 500:
                    records = records[:500]

                with open(self.file_path, "w", encoding="utf-8") as f:
                    json.dump(records, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"[IncidentLogger] Lỗi khi ghi log: {e}")

        return record

    def get_all_raw(self) -> List[Dict[str, Any]]:
        self._ensure_file_exists()
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def get_incidents(self, limit: int = 50, skip: int = 0) -> List[Dict[str, Any]]:
        with _lock:
            all_records = self.get_all_raw()
            return all_records[skip : skip + limit]

    def clear(self):
        with _lock:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)


incident_logger = FireIncidentLogger()
