import re
from typing import List, Dict, Any, Tuple
import cv2
import numpy as np


def parse_fire_boxes(answer_text: str, img_width: int, img_height: int) -> List[Dict[str, Any]]:
    """
    Trích xuất các bounding box từ văn bản kết quả của NVIDIA LocateAnything-3B.
    Quy đổi từ tọa độ chuẩn hóa [0, 1000] sang pixel thực tế [0..img_width, 0..img_height].
    """
    boxes = []
    
    # LocateAnything output dạng:
    # "fire <box><x1><y1><x2><y2></box>" hoặc "<box><x1><y1><x2><y2></box>"
    # Pattern tìm cả label phía trước (nếu có) và thẻ box
    labeled_pattern = r"(?:(fire|smoke|flame|fire\s+alarm|thick\s+smoke)\s*:?\s*)?<box><(\d+)><(\d+)><(\d+)><(\d+)></box>"
    
    for m in re.finditer(labeled_pattern, answer_text, flags=re.IGNORECASE):
        label_raw, x1_s, y1_s, x2_s, y2_s = m.groups()
        x1_norm = int(x1_s)
        y1_norm = int(y1_s)
        x2_norm = int(x2_s)
        y2_norm = int(y2_s)
        
        # Đảm bảo thứ tự x1 < x2, y1 < y2
        left = min(x1_norm, x2_norm)
        right = max(x1_norm, x2_norm)
        top = min(y1_norm, y2_norm)
        bottom = max(y1_norm, y2_norm)

        # Tránh các box rác có diện tích = 0
        if right <= left or bottom <= top:
            continue
            
        # Quy đổi tọa độ thực tế
        px1 = max(0, int(left / 1000.0 * img_width))
        py1 = max(0, int(top / 1000.0 * img_height))
        px2 = min(img_width, int(right / 1000.0 * img_width))
        py2 = min(img_height, int(bottom / 1000.0 * img_height))

        # Phân định label
        label = "fire"
        if label_raw:
            label_lower = label_raw.strip().lower()
            if "smoke" in label_lower:
                label = "smoke"
            else:
                label = "fire"

        boxes.append({
            "label": label,
            "box": [px1, py1, px2, py2],
            "norm_box": [left, top, right, bottom],
            "width": px2 - px1,
            "height": py2 - py1,
            "area": (px2 - px1) * (py2 - py1)
        })

    return boxes


def calculate_iou(boxA: List[int], boxB: List[int]) -> float:
    """
    Tính chỉ số Intersection over Union (IoU) giữa 2 bounding box [x1, y1, x2, y2].
    """
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    inter_width = max(0, xB - xA)
    inter_height = max(0, yB - yA)
    inter_area = inter_width * inter_height

    boxA_area = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxB_area = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    union_area = boxA_area + boxB_area - inter_area

    if union_area <= 0:
        return 0.0
    return inter_area / union_area


def draw_detection_results(
    image: np.ndarray, 
    boxes: List[Dict[str, Any]], 
    is_confirmed: bool = False
) -> np.ndarray:
    """
    Vẽ bounding box lửa/khói và thông tin cảnh báo lên ảnh.
    """
    annotated = image.copy()
    h, w = annotated.shape[:2]

    # Bảng màu (BGR):
    # Lửa: Đỏ cam (0, 69, 255)
    # Khói: Xám khói (128, 128, 128) hoặc Xanh tím đậm
    color_fire = (0, 69, 255)
    color_smoke = (160, 160, 160)

    for item in boxes:
        label = item.get("label", "fire")
        box = item["box"]
        x1, y1, x2, y2 = box
        color = color_smoke if label == "smoke" else color_fire

        # Vẽ hình chữ nhật bao quanh
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        # Header tag
        tag_text = f"{label.upper()}"
        font_scale = 0.55
        thickness = 2
        (text_w, text_h), baseline = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        
        # Tag background
        tag_y1 = max(0, y1 - text_h - 6)
        tag_y2 = y1
        cv2.rectangle(annotated, (x1, tag_y1), (x1 + text_w + 10, tag_y2), color, -1)
        cv2.putText(
            annotated, 
            tag_text, 
            (x1 + 5, tag_y2 - 4), 
            cv2.FONT_HERSHEY_SIMPLEX, 
            font_scale, 
            (255, 255, 255), 
            thickness
        )

    # Nếu được xác nhận nguy hiểm cấp cao (Confirmed Hazard)
    if is_confirmed and len(boxes) > 0:
        banner_text = "CRITICAL ALERT: FIRE / SMOKE DETECTED"
        cv2.rectangle(annotated, (0, 0), (w, 40), (0, 0, 200), -1)
        cv2.putText(annotated, banner_text, (15, 27), cv2.FONT_HERSHEY_DUPLEX, 0.75, (255, 255, 255), 2)

    return annotated
