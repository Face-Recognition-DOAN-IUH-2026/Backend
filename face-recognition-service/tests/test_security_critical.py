"""Security-critical tests for face-recognition-service.

Tests the most security-sensitive functions:
- _sync_face_login (passwordless JWT issuance)
- _process_single_face (camera access pipeline)
- process_camera_frame (Celery task orchestrator)
- identify_patron (multi-face identification)
- _resolve_best_match, _is_patron_inside, _publish_camera_event, _check_redis_cooldown, _scale_bbox_landmarks
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, PropertyMock

import numpy as np
import pytest


# ─── Mock heavy dependencies BEFORE any worker import ────────────────────────

# Mock insightface (not in pyproject.toml — only in Docker)
insightface_mock = MagicMock()
sys.modules.setdefault("insightface", insightface_mock)
sys.modules.setdefault("insightface.app", insightface_mock.app)
sys.modules.setdefault("insightface.model_zoo", insightface_mock.model_zoo)

# Mock cv2 (OpenCV)
cv2_mock = MagicMock()
sys.modules.setdefault("cv2", cv2_mock)

# Mock onnxruntime
sys.modules.setdefault("onnxruntime", MagicMock())

import worker.tasks as wt
from worker.tasks import _publish_camera_event as _pce_func


def _make_face_object(embedding=None, bbox=None, det_score=0.95, kps=None):
    """Create a mock face object matching InsightFace output format."""
    if embedding is None:
        embedding = np.random.rand(512).astype(np.float32)
    if bbox is None:
        bbox = np.array([100, 100, 200, 200], dtype=np.float32)
    if kps is None:
        kps = np.array([[130, 130], [170, 130], [150, 160], [135, 180], [165, 180]], dtype=np.float32)
    face = MagicMock()
    face.embedding = embedding
    face.bbox = bbox
    face.det_score = det_score
    face.kps = kps
    return face


def _make_user_data(user_id="user-1", role="patron", status="active", membership_expiry=None):
    return {
        "id": user_id,
        "email": f"{user_id}@test.com",
        "role": role,
        "status": status,
        "full_name": f"Test User {user_id}",
        "student_code": f"STU-{user_id}",
        "membership_expiry": membership_expiry or date(2099, 12, 31).isoformat(),
    }


def _make_access_status(current_status="outside", last_entry_at=None):
    return {
        "current_status": current_status,
        "last_entry_at": last_entry_at or datetime.now(timezone.utc).isoformat(),
    }


# ─── Shared mock patches ─────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _mock_settings():
    with patch("worker.tasks.settings") as s:
        s.face_match_threshold = 0.4
        s.max_image_width = 1920
        s.max_image_height = 1080
        s.max_image_pixels = 2000000
        s.min_face_size = 40
        s.entry_cam_id = "cam-entry-1"
        s.exit_cam_id = "cam-exit-1"
        s.access_cooldown_seconds = 5
        s.direction_grace_seconds = 30
        s.max_entry_hours = 12
        s.celery_broker_url = "redis://localhost:6379/0"
        s.jwt_issuer = "face-recognition"
        s.jwt_audience = "face-recognition-users"
        s.jwt_access_secret = "test-access-secret"
        s.jwt_refresh_secret = "test-refresh-secret"
        s.jwt_access_expires_minutes = 60
        s.jwt_refresh_expires_days = 7
        s.internal_api_key = "test-internal-key"
        s.user_service_url = "http://user-service:3001"
        s.access_service_url = "http://access-service:3003"
        s.enable_person_detection = False
        yield s


@pytest.fixture(autouse=True)
def _mock_milvus():
    with patch("worker.tasks._get_milvus") as mock:
        instance = MagicMock()
        instance.search.return_value = []
        instance.delete_by_user_id.return_value = True
        mock.return_value = instance
        yield instance


@pytest.fixture(autouse=True)
def _mock_storage():
    with patch("worker.tasks._get_storage") as mock:
        instance = MagicMock()
        instance.upload_image.return_value = "ok"
        instance.delete_image.return_value = True
        mock.return_value = instance
        yield instance


@pytest.fixture(autouse=True)
def _mock_redis():
    with patch("worker.tasks._get_redis_throttle") as mock:
        instance = MagicMock()
        instance.set.return_value = True
        instance.close.return_value = None
        mock.return_value = instance
        yield instance


@pytest.fixture(autouse=True)
def _mock_publish_event():
    with patch("worker.tasks._publish_camera_event") as mock:
        yield mock


@pytest.fixture(autouse=True)
def _mock_temp_frames():
    with patch("worker.tasks._upload_temp_frame", return_value="temp_frames/test.jpg"):
        with patch("worker.tasks._delete_temp_frame"):
            with patch("worker.tasks._get_temp_frame", return_value=b"fake-image-bytes"):
                yield


# ═══════════════════════════════════════════════════════════════════════════════
# Group 1: _sync_face_login
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyncFaceLogin:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_happy_path(self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_jwt.encode.return_value = "mock-jwt-token"

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                redis_inst.get.return_value = None  # no lockout
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "success"
        assert "access_token" in result
        assert "refresh_token" in result
        assert result["token_type"] == "bearer"

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    def test_no_face_detected(self, mock_resize, mock_read, mock_detect):
        from worker.tasks import _sync_face_login

        mock_detect.return_value = {"valid": False, "error": "No face"}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        result = _sync_face_login(b"fake-image-bytes")
        assert result["status"] == "error"
        assert "không phát hiện" in result["error"].lower() or "Không phát hiện" in result["error"]

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    def test_no_match_in_milvus(self, mock_resize, mock_read, mock_detect):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = []
            result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "không khớp" in result["error"].lower() or "Không khớp" in result["error"]

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": False, "liveness_score": 0.2})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_spoof_detected(self, mock_user, mock_resize, mock_read, mock_detect, mock_liveness):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                # No lockout (get returns None), but fail counter incremented
                def mock_get(key):
                    return None
                redis_inst.get = mock_get
                redis_inst.incr.return_value = 1
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "giả mạo" in result["error"].lower() or "Phát hiện" in result["error"]

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_lockout_active(self, mock_user, mock_resize, mock_read, mock_detect):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                redis_inst.get.return_value = b"1"  # lockout active
                redis_inst.ttl.return_value = 300
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "khóa" in result["error"].lower() or "tạm thời" in result["error"]

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_deletes_fail_counter_on_success(self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_jwt.encode.return_value = "mock-jwt-token"

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                redis_inst.get.return_value = None
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "success"
        # Verify fail counter was deleted
        redis_inst.delete.assert_any_call("face_login_fail:user-1")


# ═══════════════════════════════════════════════════════════════════════════════
# Group 2: _process_single_face
# ═══════════════════════════════════════════════════════════════════════════════

class TestProcessSingleFace:

    @patch("worker.tasks.liveness_from_face", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks._get_access_status")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks._check_redis_cooldown", return_value=False)
    def test_happy_path_granted(self, mock_cooldown, mock_user, mock_access, mock_liveness):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_access.return_value = _make_access_status(current_status="outside")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-entry-1", MagicMock(), face_data, raw_bytes=b"frame")

        assert result is not None
        assert result["status"] == "granted"
        assert result["patron_id"] == "user-1"
        assert result["is_live"] is True

    @patch("worker.tasks._publish_camera_event")
    def test_stranger_alert(self, mock_publish):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = []
            result = _process_single_face("cam-entry-1", MagicMock(), face_data)

        assert result is None
        mock_publish.assert_called_once()
        call_args = mock_publish.call_args[0][0]
        assert call_args["status"] == "unknown"

    @patch("worker.tasks._check_redis_cooldown", return_value=True)
    def test_cooldown_active(self, mock_cooldown):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-entry-1", MagicMock(), face_data)

        assert result is None

    @patch("worker.tasks.liveness_from_face")
    @patch("worker.tasks._get_access_status")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks._check_redis_cooldown", return_value=False)
    def test_expired_membership(self, mock_cooldown, mock_user, mock_access, mock_liveness):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        mock_user.return_value = _make_user_data(user_id="user-1", membership_expiry="2020-01-01")
        mock_access.return_value = _make_access_status(current_status="outside")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-entry-1", MagicMock(), face_data, raw_bytes=b"frame")

        assert result is None

    @patch("worker.tasks.liveness_from_face", return_value={"is_live": False, "liveness_score": 0.2})
    @patch("worker.tasks._get_access_status")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks._check_redis_cooldown", return_value=False)
    def test_liveness_fail(self, mock_cooldown, mock_user, mock_access, mock_liveness):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_access.return_value = _make_access_status(current_status="outside")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-entry-1", MagicMock(), face_data, raw_bytes=b"frame")

        assert result is None

    @patch("worker.tasks._get_access_status")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks._check_redis_cooldown", return_value=False)
    def test_wrong_direction_at_exit(self, mock_cooldown, mock_user, mock_access):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_access.return_value = _make_access_status(current_status="outside")  # not inside, trying to exit

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-exit-1", MagicMock(), face_data)

        assert result is None

    @patch("worker.tasks._get_access_status")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks._check_redis_cooldown", return_value=False)
    def test_unknown_camera_returns_none(self, mock_cooldown, mock_user, mock_access):
        from worker.tasks import _process_single_face

        embedding = np.random.rand(512).astype(np.float32)
        face = _make_face_object(embedding)
        face_data = {"embedding": embedding, "face": face, "score": 0.95}

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _process_single_face("cam-unknown-1", MagicMock(), face_data)

        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# Group 3: process_camera_frame
# ═══════════════════════════════════════════════════════════════════════════════

class TestProcessCameraFrame:

    @patch("worker.tasks._process_single_face")
    @patch("worker.tasks.detect_all_faces")
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_happy_path(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect_faces, mock_process):
        from worker.tasks import process_camera_frame

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img
        mock_detect_faces.return_value = [{"embedding": np.random.rand(512), "face": _make_face_object()}]
        mock_process.return_value = {"status": "granted", "patron_id": "user-1", "camera_id": "cam-entry-1"}

        with patch("redis.Redis") as redis_mod:
            redis_inst = MagicMock()
            redis_mod.from_url.return_value = redis_inst

            # Mock Redis cache get for frame retrieval
            with patch("infra.redis_cache.redis_client") as rc:
                rc.get.return_value = b"fake-image-bytes"
                rc.delete.return_value = None

                result = process_camera_frame("cam-entry-1", "temp_frames/test.jpg")

        assert result["status"] == "granted"
        assert result["count"] == 1

    @patch("worker.tasks.detect_all_faces", return_value=[])
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_no_faces_detected(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect_faces):
        from worker.tasks import process_camera_frame

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img

        with patch("redis.Redis") as redis_mod:
            redis_inst = MagicMock()
            redis_mod.from_url.return_value = redis_inst

            with patch("infra.redis_cache.redis_client") as rc:
                rc.get.return_value = b"fake-image-bytes"
                rc.delete.return_value = None

                result = process_camera_frame("cam-entry-1", "temp_frames/test.jpg")

        assert result["status"] == "no_match"

    @patch("worker.tasks.check_motion_blur", return_value=True)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_blurry_frame_skipped(self, mock_read, mock_resize, mock_enhance, mock_blur):
        from worker.tasks import process_camera_frame

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img

        with patch("redis.Redis") as redis_mod:
            redis_inst = MagicMock()
            redis_mod.from_url.return_value = redis_inst

            with patch("infra.redis_cache.redis_client") as rc:
                rc.get.return_value = b"fake-image-bytes"
                rc.delete.return_value = None

                result = process_camera_frame("cam-entry-1", "temp_frames/test.jpg")

        assert result["status"] == "no_match"

    @patch("worker.tasks.detect_all_faces")
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_multiple_faces(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect_faces):
        from worker.tasks import process_camera_frame

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img

        faces = [
            {"embedding": np.random.rand(512), "face": _make_face_object()},
            {"embedding": np.random.rand(512), "face": _make_face_object()},
        ]
        mock_detect_faces.return_value = faces

        with patch("worker.tasks._process_single_face") as mock_process:
            mock_process.return_value = {"status": "granted", "patron_id": "user-1"}

            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                redis_mod.from_url.return_value = redis_inst

                with patch("infra.redis_cache.redis_client") as rc:
                    rc.get.return_value = b"fake-image-bytes"
                    rc.delete.return_value = None

                    result = process_camera_frame("cam-entry-1", "temp_frames/test.jpg")

        assert result["status"] == "granted"
        assert result["count"] == 2

    @patch("redis.Redis")
    def test_frame_not_in_redis_raises(self, mock_redis_mod):
        from worker.tasks import process_camera_frame

        mock_redis_inst = MagicMock()
        mock_redis_mod.from_url.return_value = mock_redis_inst

        with patch("infra.redis_cache.redis_client") as rc:
            rc.get.return_value = None  # frame expired

            result = process_camera_frame("cam-entry-1", "temp_frames/test.jpg")

        assert result["status"] == "error"


# ═══════════════════════════════════════════════════════════════════════════════
# Group 4: identify_patron
# ═══════════════════════════════════════════════════════════════════════════════

class TestIdentifyPatron:

    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.detect_all_faces")
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_happy_path(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect, mock_user):
        from worker.tasks import identify_patron

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img
        mock_detect.return_value = [{"embedding": np.random.rand(512), "face": _make_face_object(), "score": 0.95}]
        mock_user.return_value = _make_user_data(user_id="user-1")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = identify_patron("temp_frames/test.jpg")

        assert result["status"] == "success"
        assert len(result["matches"]) == 1
        assert result["matches"][0]["patron_id"] == "user-1"

    @patch("worker.tasks.detect_all_faces", return_value=[])
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_no_faces(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect):
        from worker.tasks import identify_patron

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img

        result = identify_patron("temp_frames/test.jpg")
        assert result["status"] == "no_match"

    @patch("worker.tasks.check_motion_blur", return_value=True)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_blurry_frame(self, mock_read, mock_resize, mock_enhance, mock_blur):
        from worker.tasks import identify_patron

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img

        result = identify_patron("temp_frames/test.jpg")
        assert result["status"] == "low_quality"

    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.detect_all_faces")
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_expired_membership(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect, mock_user):
        from worker.tasks import identify_patron

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img
        mock_detect.return_value = [{"embedding": np.random.rand(512), "face": _make_face_object(), "score": 0.95}]
        mock_user.return_value = _make_user_data(user_id="user-1", membership_expiry="2020-01-01")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = identify_patron("temp_frames/test.jpg")

        assert result["status"] == "success"
        assert result["matches"][0]["status"] == "expired"

    @patch("worker.tasks._get_user_via_api", return_value=None)
    @patch("worker.tasks.detect_all_faces")
    @patch("worker.tasks.check_motion_blur", return_value=False)
    @patch("worker.tasks.enhance_illumination")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks.safe_read_image_from_bytes")
    def test_orphaned_embedding_cleaned(self, mock_read, mock_resize, mock_enhance, mock_blur, mock_detect, mock_user):
        from worker.tasks import identify_patron

        img = MagicMock()
        img.shape = (480, 640, 3)
        mock_read.return_value = img
        mock_resize.return_value = img
        mock_enhance.return_value = img
        mock_detect.return_value = [{"embedding": np.random.rand(512), "face": _make_face_object(), "score": 0.95}]

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "orphan-user", "score": 0.9, "angle": "frontal"},
            ]
            result = identify_patron("temp_frames/test.jpg")

        assert result["status"] == "no_match"
        milvus_mock.return_value.delete_by_user_id.assert_called_with(user_id="orphan-user")


# ═══════════════════════════════════════════════════════════════════════════════
# Group 5: Supporting functions
# ═══════════════════════════════════════════════════════════════════════════════

class TestResolveBestMatch:

    def test_empty_results(self):
        from worker.tasks import _resolve_best_match
        assert _resolve_best_match([], 0.5) is None

    def test_below_threshold(self):
        from worker.tasks import _resolve_best_match
        results = [{"user_id": "u1", "score": 0.3}]
        assert _resolve_best_match(results, 0.5) is None

    def test_above_threshold(self):
        from worker.tasks import _resolve_best_match
        results = [{"user_id": "u1", "score": 0.9}]
        result = _resolve_best_match(results, 0.5)
        assert result is not None
        assert result["user_id"] == "u1"
        assert result["score"] == 0.9

    def test_vote_tiebreak(self):
        from worker.tasks import _resolve_best_match
        # u1 has 2 votes, u2 has 1 vote — u1 wins despite same max score
        results = [
            {"user_id": "u1", "score": 0.8},
            {"user_id": "u1", "score": 0.7},
            {"user_id": "u2", "score": 0.9},
        ]
        result = _resolve_best_match(results, 0.5)
        assert result["user_id"] == "u1"
        assert result["votes"] == 2


class TestScaleBboxLandmarks:

    def test_no_scaling(self):
        from worker.tasks import _scale_bbox_landmarks
        bbox = [10, 20, 30, 40]
        landmarks = [[15, 25], [25, 35]]
        b, l = _scale_bbox_landmarks(bbox, landmarks, 1.0, 1.0)
        assert b == bbox
        assert l == landmarks

    def test_with_scaling(self):
        from worker.tasks import _scale_bbox_landmarks
        bbox = [10, 20, 30, 40]
        landmarks = [[15, 25]]
        b, l = _scale_bbox_landmarks(bbox, landmarks, 2.0, 3.0)
        assert b == [20, 60, 60, 120]
        assert l == [[30, 75]]

    def test_none_inputs(self):
        from worker.tasks import _scale_bbox_landmarks
        b, l = _scale_bbox_landmarks(None, None, 2.0, 2.0)
        assert b is None
        assert l is None


class TestCheckRedisCooldown:

    @patch("redis.Redis")
    def test_not_in_cooldown(self, mock_redis_mod):
        from worker.tasks import _check_redis_cooldown

        redis_inst = MagicMock()
        redis_inst.get.return_value = None
        mock_redis_mod.from_url.return_value = redis_inst

        result = _check_redis_cooldown("patron-1", "entry")
        assert result is False
        redis_inst.setex.assert_called_once()

    @patch("redis.Redis")
    def test_in_cooldown(self, mock_redis_mod):
        from worker.tasks import _check_redis_cooldown

        redis_inst = MagicMock()
        redis_inst.get.return_value = b"1"
        mock_redis_mod.from_url.return_value = redis_inst

        result = _check_redis_cooldown("patron-1", "entry")
        assert result is True

    @patch("redis.Redis")
    def test_redis_unavailable_returns_false(self, mock_redis_mod):
        from worker.tasks import _check_redis_cooldown
        mock_redis_mod.from_url.side_effect = Exception("Redis down")
        result = _check_redis_cooldown("patron-1", "entry")
        assert result is False


class TestPublishCameraEvent:

    def test_publishes_event(self):
        redis_inst = MagicMock()
        redis_inst.set.return_value = True

        with patch.object(wt, "_call_access_service") as mock_call:
            with patch.object(wt, "_get_redis_throttle", return_value=redis_inst):
                _pce_func({"camera_id": "cam-1", "status": "granted", "patron_id": "u1"})

        mock_call.assert_called_once()
        call_args = mock_call.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/internal/access/recognition-events"

    def test_throttled_event_not_published(self):
        redis_inst = MagicMock()
        redis_inst.set.return_value = False  # throttled

        with patch.object(wt, "_call_access_service") as mock_call:
            with patch.object(wt, "_get_redis_throttle", return_value=redis_inst):
                _pce_func({"camera_id": "cam-1", "status": "granted", "patron_id": "u1"})

        mock_call.assert_not_called()

    def test_unknown_status_becomes_no_match(self):
        redis_inst = MagicMock()
        redis_inst.set.return_value = True

        with patch.object(wt, "_call_access_service") as mock_call:
            with patch.object(wt, "_get_redis_throttle", return_value=redis_inst):
                _pce_func({"camera_id": "cam-1", "status": "unknown"})

        call_args = mock_call.call_args
        assert call_args[0][0] == "POST"
        assert call_args[0][1] == "/internal/access/recognition-events"
        assert call_args[1]["json"]["status"] == "no_match"


class TestIsPatronInside:

    @patch("worker.tasks._get_access_status")
    def test_inside(self, mock_access):
        from worker.tasks import _is_patron_inside
        mock_access.return_value = _make_access_status(current_status="inside")
        assert _is_patron_inside("patron-1") is True

    @patch("worker.tasks._get_access_status")
    def test_outside(self, mock_access):
        from worker.tasks import _is_patron_inside
        mock_access.return_value = _make_access_status(current_status="outside")
        assert _is_patron_inside("patron-1") is False

    @patch("worker.tasks._get_access_status", return_value=None)
    def test_no_access_data(self, mock_access):
        from worker.tasks import _is_patron_inside
        assert _is_patron_inside("patron-1") is False

    @patch("worker.tasks._get_access_status")
    def test_stale_entry_auto_expire(self, mock_access):
        from worker.tasks import _is_patron_inside
        # Entry was 24 hours ago, max_entry_hours is 12
        stale_time = datetime.now(timezone.utc) - timedelta(hours=25)
        mock_access.return_value = _make_access_status(
            current_status="inside",
            last_entry_at=stale_time.isoformat(),
        )
        assert _is_patron_inside("patron-1") is False
