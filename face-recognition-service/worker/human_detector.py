from __future__ import annotations

import os
import logging
import urllib.request

import cv2
import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
PROTOTXT_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt"
MODEL_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/mobilenet_iter_73000.caffemodel"
PROTOTXT_PATH = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.prototxt")
MODEL_PATH = os.path.join(MODEL_DIR, "MobileNetSSD_deploy.caffemodel")
MODEL_INPUT_SIZE = (300, 300)
PERSON_CLASS_ID = 15
CONFIDENCE_THRESHOLD = 0.3
MIN_PERSON_AREA = 0.008

_net = None


def _ensure_model_dir():
    os.makedirs(MODEL_DIR, exist_ok=True)


def _download(url: str, dst: str, label: str) -> bool:
    try:
        logger.info("Downloading %s from %s ...", label, url)
        urllib.request.urlretrieve(url, dst)
        logger.info("%s downloaded to %s (%d bytes)", label, dst, os.path.getsize(dst))
        return True
    except Exception as e:
        logger.warning("Failed to download %s: %s", label, e)
        return False


def _init():
    global _net
    if _net is not None:
        return True

    _ensure_model_dir()

    if not os.path.exists(PROTOTXT_PATH):
        if not _download(PROTOTXT_URL, PROTOTXT_PATH, "prototxt"):
            logger.error("Prototxt not available. Person detection disabled.")
            return False

    if not os.path.exists(MODEL_PATH):
        if not _download(MODEL_URL, MODEL_PATH, "caffemodel"):
            logger.error(
                "Caffemodel not available. Person detection disabled. "
                "Manual download: %s", MODEL_URL,
            )
            return False

    try:
        _net = cv2.dnn.readNetFromCaffe(PROTOTXT_PATH, MODEL_PATH)
        _net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        _net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        logger.info("MobileNet SSD loaded successfully")
        return True
    except Exception as e:
        logger.error("Failed to load MobileNet SSD model: %s", e)
        _net = None
        return False


def has_person_in_frame(img: np.ndarray, min_area: float = MIN_PERSON_AREA) -> bool:
    """Check if frame contains at least one person (COCO class 15).
    Returns False if model is unavailable (fail-closed) — prevents self-DOS
    from passing every frame through expensive face detection pipeline.
    """
    global _net
    if _net is None:
        if not _init():
            logger.critical(
                "Human detection model unavailable — returning False (fail-closed). "
                "Camera processing paused. OPS TEAM ACTION REQUIRED: check model file and container health."
            )
            return False

    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(img, 0.007843, MODEL_INPUT_SIZE, 127.5)
    _net.setInput(blob)
    detections = _net.forward()

    for i in range(detections.shape[2]):
        confidence = float(detections[0, 0, i, 2])
        if confidence < CONFIDENCE_THRESHOLD:
            continue
        class_id = int(detections[0, 0, i, 1])
        if class_id != PERSON_CLASS_ID:
            continue
        box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
        x1, y1, x2, y2 = box.astype(int)
        area = max(0, x2 - x1) * max(0, y2 - y1) / (w * h)
        if area >= min_area:
            return True

    return False


def safe_has_person_in_frame(img: np.ndarray, min_area: float = MIN_PERSON_AREA) -> bool:
    """Wrapper that catches any exception and fails-closed."""
    try:
        return has_person_in_frame(img, min_area)
    except Exception as e:
        logger.critical("Person detection exception (fail-closed): %s", e)
        return False
