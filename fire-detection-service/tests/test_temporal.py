import pytest
import time
from core.temporal import TemporalFireFilter


def test_temporal_filter_requires_consecutive_hits():
    # Cần 3 hits để xác nhận cảnh báo
    flt = TemporalFireFilter(min_hits=3, iou_thresh=0.3, ttl_seconds=2.0)

    # Frame 1: Xuất hiện box lửa đầu tiên -> Chưa báo động
    boxes_frame1 = [{"box": [100, 100, 200, 200], "label": "fire"}]
    res1 = flt.update(boxes_frame1)
    assert res1["has_hazard"] is False
    assert res1["active_tracks_count"] == 1

    # Frame 2: Lửa dịch chuyển nhẹ -> Vẫn chưa đủ 3 frames
    boxes_frame2 = [{"box": [105, 102, 205, 202], "label": "fire"}]
    res2 = flt.update(boxes_frame2)
    assert res2["has_hazard"] is False

    # Frame 3: Lửa tiếp tục tồn tại -> Xác nhận cảnh báo nguy hiểm!
    boxes_frame3 = [{"box": [102, 101, 203, 201], "label": "fire"}]
    res3 = flt.update(boxes_frame3)
    assert res3["has_hazard"] is True
    assert res3["confirmed_count"] == 1
    assert res3["confirmed_boxes"][0]["label"] == "fire"


def test_temporal_filter_ttl_clears_stale():
    flt = TemporalFireFilter(min_hits=3, iou_thresh=0.3, ttl_seconds=0.1)

    boxes = [{"box": [50, 50, 150, 150], "label": "smoke"}]
    flt.update(boxes)
    assert len(flt.tracked_objects) == 1

    # Đợi quá TTL
    time.sleep(0.15)
    res = flt.update([])
    assert len(flt.tracked_objects) == 0
    assert res["has_hazard"] is False
