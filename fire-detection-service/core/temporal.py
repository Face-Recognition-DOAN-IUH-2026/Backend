import time
from typing import List, Dict, Any, Optional
from core.parser import calculate_iou


class TrackedObject:
    def __init__(self, box: List[int], label: str, timestamp: float):
        self.box = box
        self.label = label
        self.first_seen = timestamp
        self.last_seen = timestamp
        self.consecutive_hits = 1
        self.is_confirmed = False

    def update(self, box: List[int], timestamp: float):
        self.box = box
        self.last_seen = timestamp
        self.consecutive_hits += 1


class TemporalFireFilter:
    """
    Bộ lọc chống báo động giả theo thời gian (Anti-False Alarm Temporal Filter).
    Yêu cầu lửa hoặc khói phải xuất hiện ổn định qua ít nhất `min_hits` frames liên tiếp.
    """
    def __init__(
        self, 
        min_hits: int = 3, 
        iou_thresh: float = 0.3, 
        ttl_seconds: float = 3.0
    ):
        self.min_hits = min_hits
        self.iou_thresh = iou_thresh
        self.ttl_seconds = ttl_seconds
        self.tracked_objects: List[TrackedObject] = []

    def update(self, current_boxes: List[Dict[str, Any]]) -> Dict[str, Any]:
        now = time.time()
        
        # 1. Dọn dẹp các vật thể quá hạn (TTL)
        self.tracked_objects = [
            obj for obj in self.tracked_objects 
            if (now - obj.last_seen) <= self.ttl_seconds
        ]

        matched_tracks = set()

        # 2. So khớp các box mới với các track hiện có
        for box_item in current_boxes:
            box = box_item["box"]
            label = box_item.get("label", "fire")
            best_iou = 0.0
            best_idx = -1

            for idx, track in enumerate(self.tracked_objects):
                if idx in matched_tracks:
                    continue
                if track.label != label:
                    continue
                iou = calculate_iou(box, track.box)
                if iou > best_iou and iou >= self.iou_thresh:
                    best_iou = iou
                    best_idx = idx

            if best_idx >= 0:
                self.tracked_objects[best_idx].update(box, now)
                matched_tracks.add(best_idx)
            else:
                # Tạo track mới
                new_track = TrackedObject(box, label, now)
                self.tracked_objects.append(new_track)

        # 3. Đánh giá trạng thái cảnh báo
        confirmed_boxes = []
        has_confirmed_hazard = False

        for track in self.tracked_objects:
            if track.consecutive_hits >= self.min_hits:
                track.is_confirmed = True
                has_confirmed_hazard = True
                confirmed_boxes.append({
                    "label": track.label,
                    "box": track.box,
                    "duration": round(now - track.first_seen, 2),
                    "consecutive_hits": track.consecutive_hits
                })

        return {
            "has_hazard": has_confirmed_hazard,
            "confirmed_count": len(confirmed_boxes),
            "confirmed_boxes": confirmed_boxes,
            "active_tracks_count": len(self.tracked_objects)
        }

    def reset(self):
        self.tracked_objects.clear()
