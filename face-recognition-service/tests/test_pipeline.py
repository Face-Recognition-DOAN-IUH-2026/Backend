from __future__ import annotations

import cv2
import numpy as np
import pytest

from worker.tasks_pipeline import (
    extract_embedding_placeholder,
    resize_if_necessary,
    run_liveness_analysis,
    safe_read_image_from_bytes,
)


def _make_test_image(h: int = 100, w: int = 100) -> bytes:
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = (128, 128, 128)
    _, encoded = cv2.imencode(".jpg", img)
    return encoded.tobytes()


def test_safe_read_image_from_bytes():
    data = _make_test_image()
    mat = safe_read_image_from_bytes(data)
    assert mat is not None
    assert mat.shape == (100, 100, 3)


def test_safe_read_image_invalid_bytes():
    with pytest.raises(ValueError, match="Invalid image bytes"):
        safe_read_image_from_bytes(b"not an image")


def test_resize_if_necessary_no_resize():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    result = resize_if_necessary(img, max_w=200, max_h=200, max_pixels=100000)
    assert result.shape == (100, 100, 3)


def test_resize_if_necessary_downscale():
    img = np.zeros((2000, 2000, 3), dtype=np.uint8)
    result = resize_if_necessary(img, max_w=1280, max_h=1280, max_pixels=2073600)
    assert result.shape[0] <= 1280
    assert result.shape[1] <= 1280
    assert result.shape[0] * result.shape[1] <= 2073600


def test_extract_embedding_placeholder_shape():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    vec = extract_embedding_placeholder(img)
    assert len(vec) == 512
    assert all(isinstance(v, float) for v in vec)


def test_run_liveness_analysis():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    result = run_liveness_analysis(img)
    assert "is_live" in result or "liveness_score" in result
