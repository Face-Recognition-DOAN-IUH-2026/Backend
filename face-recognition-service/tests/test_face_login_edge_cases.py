"""Edge case tests for _sync_face_login — extends test_security_critical.py.

Covers:
- B1: lockout after repeated failures
- B2: lockout TTL expiry
- B3: user-service timeout
- B4: Milvus connection failure
- B5: Redis connection failure (graceful degradation)
- B6: invalid image format
- B7: file too large rejection
- B8: concurrent login attempts
- B9: spoof increments fail counter
- B10: success clears fail counter
- B11: malformed JWT token after login
- B12: empty user data from user-service
"""
from __future__ import annotations

import io
import sys
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# Mock heavy dependencies BEFORE any worker import
insightface_mock = MagicMock()
sys.modules.setdefault("insightface", insightface_mock)
sys.modules.setdefault("insightface.app", insightface_mock.app)
sys.modules.setdefault("insightface.model_zoo", insightface_mock.model_zoo)
sys.modules.setdefault("cv2", MagicMock())
sys.modules.setdefault("onnxruntime", MagicMock())

import worker.tasks as wt


def _make_face_object(embedding=None):
    if embedding is None:
        embedding = np.random.rand(512).astype(np.float32)
    face = MagicMock()
    face.embedding = embedding
    face.bbox = np.array([100, 100, 200, 200], dtype=np.float32)
    face.det_score = 0.95
    face.kps = np.array([[130, 130], [170, 130], [150, 160], [135, 180], [165, 180]], dtype=np.float32)
    return face


def _make_user_data(user_id="user-1", role="patron", status="active"):
    return {
        "id": user_id,
        "email": f"{user_id}@test.com",
        "role": role,
        "status": status,
        "full_name": f"Test User {user_id}",
        "student_code": f"STU-{user_id}",
        "membership_expiry": date(2099, 12, 31).isoformat(),
    }


@pytest.fixture(autouse=True)
def _mock_settings():
    with patch("worker.tasks.settings") as s:
        s.face_match_threshold = 0.4
        s.max_image_width = 1920
        s.max_image_height = 1080
        s.max_image_pixels = 2000000
        s.min_face_size = 40
        s.jwt_issuer = "face-recognition"
        s.jwt_audience = "face-recognition-users"
        s.jwt_access_secret = "test-access-secret"
        s.jwt_refresh_secret = "test-refresh-secret"
        s.jwt_access_expires_minutes = 60
        s.jwt_refresh_expires_days = 7
        s.service_jwt_secret = "test-service-jwt-secret"
        s.user_service_url = "http://user-service:3001"
        s.redis_url = "redis://localhost:6379/0"
        yield s


@pytest.fixture(autouse=True)
def _mock_storage():
    with patch("worker.tasks._get_storage") as mock:
        instance = MagicMock()
        instance.upload_image.return_value = "ok"
        instance.delete_image.return_value = True
        mock.return_value = instance
        yield instance


@pytest.fixture(autouse=True)
def _mock_temp_frames():
    with patch("worker.tasks._upload_temp_frame", return_value="temp_frames/test.jpg"):
        with patch("worker.tasks._delete_temp_frame"):
            with patch("worker.tasks._get_temp_frame", return_value=b"fake-image-bytes"):
                yield


# ═══════════════════════════════════════════════════════════════════════════════
# B1: Lockout after repeated failures
# ═══════════════════════════════════════════════════════════════════════════════

class TestLockoutAfterFailures:

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_lockout_after_3_spoof_attempts(self, mock_user, mock_resize, mock_read, mock_detect):
        """After 3 spoof attempts, Redis counter reaches 3. A 4th attempt should still work
        (lockout is set separately via face_login_lockout key, not the fail counter)."""
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
            with patch("worker.tasks.run_liveness_analysis", return_value={"is_live": False, "liveness_score": 0.2}):
                with patch("redis.Redis") as redis_mod:
                    redis_inst = MagicMock()
                    # Simulate 3 prior failures (fail counter = 3)
                    redis_inst.get.side_effect = lambda key: None if "lockout" in key else b"3"
                    redis_inst.incr.return_value = 4  # next increment
                    redis_mod.from_url.return_value = redis_inst

                    result = _sync_face_login(b"fake-image-bytes")

        # Should fail due to spoof, not lockout (lockout is separate key)
        assert result["status"] == "error"
        assert "giả mạo" in result["error"].lower() or "Phát hiện" in result["error"]

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_lockout_key_blocks_login(self, mock_user, mock_resize, mock_read, mock_detect):
        """When face_login_lockout key exists, login is blocked regardless of face match."""
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
                redis_inst.ttl.return_value = 600
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "khóa" in result["error"].lower() or "tạm thời" in result["error"]


# ═══════════════════════════════════════════════════════════════════════════════
# B2: Lockout TTL expiry
# ═══════════════════════════════════════════════════════════════════════════════

class TestLockoutTtlExpiry:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_lockout_expired_allows_login(self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness):
        """After lockout TTL expires, the key is gone and login succeeds."""
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
                redis_inst.get.return_value = None  # lockout key expired/gone
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "success"
        assert "access_token" in result


# ═══════════════════════════════════════════════════════════════════════════════
# B3: user-service timeout
# ═══════════════════════════════════════════════════════════════════════════════

class TestUserServiceTimeout:

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api", return_value=None)
    def test_user_service_returns_none(self, mock_user, mock_resize, mock_read, mock_detect):
        """When user-service returns None (timeout or error), face login returns account not found."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "tài khoản" in result["error"].lower() or "Không tìm thấy" in result["error"]

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api", side_effect=Exception("Connection timeout"))
    def test_user_service_raises_exception(self, mock_user, mock_resize, mock_read, mock_detect):
        """When user-service raises an exception (timeout, connection error), it's caught gracefully."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert result["error"]  # should have some error message


# ═══════════════════════════════════════════════════════════════════════════════
# B4: Milvus connection failure
# ═══════════════════════════════════════════════════════════════════════════════

class TestMilvusConnectionFailure:

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    def test_milvus_search_raises_exception(self, mock_resize, mock_read, mock_detect):
        """When Milvus is down, the exception is caught and returned as a generic error."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.side_effect = Exception("Milvus connection refused")
            result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "Milvus" in result["error"] or "connection" in result["error"].lower()


# ═══════════════════════════════════════════════════════════════════════════════
# B5: Redis connection failure (graceful degradation)
# ═══════════════════════════════════════════════════════════════════════════════

class TestRedisConnectionFailure:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_login_succeeds_when_redis_down(self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness):
        """When Redis is down, lockout check and fail counter are skipped but login still works."""
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
                # All Redis operations raise exceptions
                redis_inst.get.side_effect = Exception("Redis connection refused")
                redis_inst.incr.side_effect = Exception("Redis connection refused")
                redis_inst.delete.side_effect = Exception("Redis connection refused")
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        # Login should still succeed — Redis failures are silently swallowed
        assert result["status"] == "success"
        assert "access_token" in result


# ═══════════════════════════════════════════════════════════════════════════════
# B6: Invalid image format
# ═══════════════════════════════════════════════════════════════════════════════

class TestInvalidImageFormat:

    @patch("worker.tasks.safe_read_image_from_bytes", side_effect=ValueError("Invalid image data"))
    def test_non_image_bytes_return_error(self, mock_read):
        """When the uploaded bytes are not a valid image, an error is returned."""
        from worker.tasks import _sync_face_login

        result = _sync_face_login(b"this is not an image")
        assert result["status"] == "error"
        assert result["error"]  # should have error message

    @patch("worker.tasks.safe_read_image_from_bytes", side_effect=Exception("Unsupported format"))
    def test_unsupported_format_return_error(self, mock_read):
        """Unsupported image format is caught gracefully."""
        from worker.tasks import _sync_face_login

        result = _sync_face_login(b"\x89PNG\r\n\x1a\n")  # PNG header but incomplete
        assert result["status"] == "error"


# ═══════════════════════════════════════════════════════════════════════════════
# B7: File too large rejection
# ═══════════════════════════════════════════════════════════════════════════════

class TestFileTooLarge:

    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    def test_large_image_is_resized(self, mock_resize, mock_read):
        """Large images should be resized, not rejected. resize_if_necessary handles this."""
        from worker.tasks import _sync_face_login

        img = MagicMock()
        img.shape = (4000, 6000, 3)
        mock_read.return_value = img
        mock_resize.return_value = MagicMock(shape=(1080, 1920, 3))

        with patch("worker.tasks.detect_face_once") as mock_detect:
            mock_detect.return_value = {"valid": False, "error": "No face"}
            result = _sync_face_login(b"large-image-bytes")

        # resize_if_necessary should have been called
        mock_resize.assert_called_once()
        assert result["status"] == "error"  # no face in mock, but resize worked

    @patch("worker.tasks.safe_read_image_from_bytes", side_effect=MemoryError("Image too large"))
    def test_extreme_size_causes_memory_error(self, mock_read):
        """Extremely large image causes MemoryError, caught gracefully."""
        from worker.tasks import _sync_face_login

        result = _sync_face_login(b"\x00" * (50 * 1024 * 1024))  # 50MB null bytes
        assert result["status"] == "error"


# ═══════════════════════════════════════════════════════════════════════════════
# B8: Concurrent login attempts
# ═══════════════════════════════════════════════════════════════════════════════

class TestConcurrentLoginAttempts:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_concurrent_requests_both_succeed(
        self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """Two concurrent face login requests for the same user should both succeed
        (no distributed lock, but each request is independent)."""
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

                # Simulate two sequential calls (concurrent in production)
                result1 = _sync_face_login(b"face-image-1")
                result2 = _sync_face_login(b"face-image-2")

        assert result1["status"] == "success"
        assert result2["status"] == "success"


# ═══════════════════════════════════════════════════════════════════════════════
# B9: Spoof increments fail counter
# ═══════════════════════════════════════════════════════════════════════════════

class TestSpoofIncrementsFailCounter:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": False, "liveness_score": 0.15})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_spoof_increments_redis_counter(
        self, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """When spoof is detected, Redis fail counter should be incremented."""
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
                redis_inst.get.return_value = None  # no lockout
                redis_inst.incr.return_value = 1
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "giả mạo" in result["error"].lower() or "Phát hiện" in result["error"]
        # Verify fail counter was incremented
        redis_inst.incr.assert_called_with("face_login_fail:user-1")
        # Verify TTL was set on first failure
        redis_inst.expire.assert_called_with("face_login_fail:user-1", 900)

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": False, "liveness_score": 0.1})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_spoof_does_not_set_ttl_on_subsequent_failures(
        self, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """TTL should only be set on the first failure (incr returns 1), not on subsequent ones."""
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
                redis_inst.get.return_value = None
                redis_inst.incr.return_value = 3  # 3rd failure
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        # incr called but expire should NOT be called (count != 1)
        redis_inst.incr.assert_called_with("face_login_fail:user-1")
        redis_inst.expire.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════════
# B10: Success clears fail counter
# ═══════════════════════════════════════════════════════════════════════════════

class TestSuccessClearsFailCounter:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.95})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_success_deletes_fail_key(
        self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """On successful login, the face_login_fail:{user_id} key should be deleted."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-42")
        mock_jwt.encode.return_value = "mock-jwt-token"

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-42", "score": 0.92, "angle": "frontal"},
            ]
            with patch("redis.Redis") as redis_mod:
                redis_inst = MagicMock()
                redis_inst.get.return_value = None
                redis_mod.from_url.return_value = redis_inst

                result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "success"
        # Verify the fail counter was deleted
        redis_inst.delete.assert_any_call("face_login_fail:user-42")

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_success_does_not_delete_lockout(
        self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """On successful login, the face_login_lockout key should NOT be deleted
        (lockout is managed externally, not by the login function)."""
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
        # Verify lockout key was NOT deleted (only fail counter is deleted)
        for call in redis_inst.delete.call_args_list:
            assert "lockout" not in str(call)


# ═══════════════════════════════════════════════════════════════════════════════
# B11: Malformed JWT token after login
# ═══════════════════════════════════════════════════════════════════════════════

class TestMalformedJwtAfterLogin:

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_jwt_encode_failure_returns_error(
        self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """If JWT encoding fails, the error is caught and returned gracefully."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_jwt.encode.side_effect = Exception("JWT encoding failed")

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "JWT" in result["error"] or "encoding" in result["error"].lower()

    @patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True, "liveness_score": 0.9})
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    @patch("worker.tasks.jwt")
    def test_access_token_is_string(
        self, mock_jwt, mock_user, mock_resize, mock_read, mock_detect, mock_liveness
    ):
        """The access_token in the response should be a string, not bytes or None."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = _make_user_data(user_id="user-1")
        mock_jwt.encode.return_value = "valid-jwt-string-token"

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
        assert isinstance(result["access_token"], str)
        assert isinstance(result["refresh_token"], str)
        assert result["token_type"] == "bearer"


# ═══════════════════════════════════════════════════════════════════════════════
# B12: Empty/partial user data from user-service
# ═══════════════════════════════════════════════════════════════════════════════

class TestEmptyUserData:

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api", return_value={})
    def test_empty_user_dict_returns_error(self, mock_user, mock_resize, mock_read, mock_detect):
        """When user-service returns an empty dict, it should be treated as user not found."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            result = _sync_face_login(b"fake-image-bytes")

        # Empty dict is falsy, so _get_user_via_api returning {} should trigger "not found"
        # But since {} is falsy in Python, the `if not user_data` check catches it
        assert result["status"] == "error"

    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_user_missing_email_field(self, mock_user, mock_resize, mock_read, mock_detect):
        """When user data is missing the email field, KeyError is caught gracefully."""
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding, "face": _make_face_object(embedding)}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = {"id": "user-1", "role": "patron"}  # missing email

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"},
            ]
            with patch("worker.tasks.run_liveness_analysis", return_value={"is_live": True}):
                result = _sync_face_login(b"fake-image-bytes")

        # Should either succeed (if email defaults to None) or fail with caught exception
        assert result["status"] in ("success", "error")
