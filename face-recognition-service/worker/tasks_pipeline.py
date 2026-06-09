from __future__ import annotations

import cv2
import numpy as np
from worker.face_model import check_face_quality, extract_embedding, check_liveness


def safe_read_image_from_bytes(data: bytes) -> "cv2.Mat":
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        raise ValueError("Invalid image bytes")
    return arr


def resize_if_necessary(img: "cv2.Mat", *, max_w: int, max_h: int, max_pixels: int) -> "cv2.Mat":
    h, w = img.shape[:2]
    pixels = h * w
    if pixels <= max_pixels and w <= max_w and h <= max_h:
        return img

    scale = min(max_w / w, max_h / h, (max_pixels / pixels) ** 0.5)
    scale = float(max(scale, 0.05))
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))

    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return resized


def extract_embedding_placeholder(img: "cv2.Mat") -> list[float]:
    return extract_embedding(img)


def run_liveness_analysis(img: "cv2.Mat") -> dict:
    return check_liveness(img)

