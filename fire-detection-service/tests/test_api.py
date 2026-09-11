import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image
import numpy as np

from api.app import app
from core.config import settings

# Ép mock mode khi chạy unit test
settings.USE_MOCK_MODEL = True

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == settings.SERVICE_NAME


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "gpu" in data


def test_detect_image_endpoint():
    # Tạo một ảnh test màu đỏ (giả lập lửa)
    img = Image.new("RGB", (300, 300), color=(255, 50, 0))
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="JPEG")
    img_byte_arr.seek(0)

    files = {"file": ("test_fire.jpg", img_byte_arr, "image/jpeg")}
    response = client.post(
        "/api/v1/detect/image",
        files=files,
        data={"return_annotated": "true"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "boxes" in data
    assert "latency_ms" in data


def test_yolo_detection_endpoint():
    from core.model import engine
    # Bật YOLO engine
    engine.use_mock = False
    engine.use_yolo = True
    engine.load_model()

    # Thử ảnh sample_test_fire.jpg
    with open("sample_test_fire.jpg", "rb") as f:
        files = {"file": ("sample_test_fire.jpg", f.read(), "image/jpeg")}

    response = client.post(
        "/api/v1/detect/image",
        files=files,
        data={"return_annotated": "true"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "boxes" in data
    assert "latency_ms" in data
