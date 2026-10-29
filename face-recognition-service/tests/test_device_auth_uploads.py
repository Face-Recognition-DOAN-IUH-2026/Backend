"""MIN-BE-2: device/internal-key guards (#6/#7/#8), upload validation (#22),
internal status auth (#7 step), face-login lockout fail-closed (#12), cooldown fail-closed (#22)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt

from infra.config import settings

INTERNAL_KEY = "test-internal-key"
BIG_OVER_LIMIT = b"\xff\xd8\xff" + b"x" * (5 * 1024 * 1024)


def _token(roles: list[str], sub: str = "user-1") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "email": f"{sub}@example.com",
        "roles": roles,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "exp": now + timedelta(hours=1),
        "iat": now,
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_access_secret, algorithm="HS256")


@pytest_asyncio.fixture
async def unauthed_client(mock_celery_task, mock_milvus_client, mock_redis, mock_minio_client, monkeypatch):
    """App client WITHOUT the default X-Internal-Key header."""
    from api.app import create_app
    from api.dependencies import get_db_session

    monkeypatch.setattr(settings, "internal_api_key", INTERNAL_KEY)
    app = create_app()

    async def _fake_db():
        yield AsyncMock()

    app.dependency_overrides[get_db_session] = _fake_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


class TestPatronsLookupGuard:
    async def test_no_credentials_401(self, unauthed_client):
        resp = await unauthed_client.get("/patrons/lookup", params={"student_code": "SV001"})
        assert resp.status_code == 401

    async def test_wrong_internal_key_401(self, unauthed_client):
        resp = await unauthed_client.get(
            "/patrons/lookup", params={"student_code": "SV001"}, headers={"X-Internal-Key": "wrong"}
        )
        assert resp.status_code == 401

    async def test_patron_token_403(self, unauthed_client):
        resp = await unauthed_client.get(
            "/patrons/lookup",
            params={"student_code": "SV001"},
            headers={"Authorization": f"Bearer {_token(['patron'])}"},
        )
        assert resp.status_code == 403

    async def test_staff_token_200(self, unauthed_client):
        with patch(
            "api.routers.patrons._proxy_to_user_service", new=AsyncMock(return_value={"exists": False})
        ):
            resp = await unauthed_client.get(
                "/patrons/lookup",
                params={"student_code": "SV001"},
                headers={"Authorization": f"Bearer {_token(['staff'])}"},
            )
        assert resp.status_code == 200
        assert resp.json()["exists"] is False

    async def test_internal_key_200(self, unauthed_client):
        with patch(
            "api.routers.patrons._proxy_to_user_service", new=AsyncMock(return_value={"exists": False})
        ):
            resp = await unauthed_client.get(
                "/patrons/lookup",
                params={"student_code": "SV001"},
                headers={"X-Internal-Key": INTERNAL_KEY},
            )
        assert resp.status_code == 200
        assert resp.json()["exists"] is False


class TestKioskRouterGuard:
    async def test_no_credentials_401(self, unauthed_client):
        resp = await unauthed_client.post("/kiosk/lookup", params={"student_code": "SV001"})
        assert resp.status_code == 401

    async def test_patron_token_403(self, unauthed_client):
        resp = await unauthed_client.post(
            "/kiosk/lookup",
            params={"student_code": "SV001"},
            headers={"Authorization": f"Bearer {_token(['patron'])}"},
        )
        assert resp.status_code == 403

    async def test_internal_key_200(self, unauthed_client):
        with patch("api.routers.kiosk._proxy_lookup_user", new=AsyncMock(return_value=None)):
            resp = await unauthed_client.post(
                "/kiosk/lookup",
                params={"student_code": "SV001"},
                headers={"X-Internal-Key": INTERNAL_KEY},
            )
        assert resp.status_code == 200
        assert resp.json()["exists"] is False

    async def test_kiosk_enroll_oversized_image_413(self, unauthed_client):
        with patch("api.routers.kiosk._proxy_lookup_user", new=AsyncMock(return_value=None)):
            resp = await unauthed_client.post(
                "/kiosk/enroll",
                files={"image": ("f.jpg", BIG_OVER_LIMIT, "image/jpeg")},
                data={
                    "full_name": "Test",
                    "student_code": "SV001",
                    "membership_expiry": "2099-12-31",
                },
                headers={"X-Internal-Key": INTERNAL_KEY},
            )
        assert resp.status_code == 413

    async def test_kiosk_enter_non_image_400(self, unauthed_client):
        with patch(
            "api.routers.kiosk._proxy_lookup_user",
            new=AsyncMock(return_value={"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "membership_expiry": "2099-12-31"}),
        ):
            resp = await unauthed_client.post(
                "/kiosk/enter",
                files={"image": ("f.jpg", b"not-an-image", "image/jpeg")},
                data={"student_code": "SV001"},
                headers={"X-Internal-Key": INTERNAL_KEY},
            )
        assert resp.status_code == 400


class TestCameraFrameGuardAndValidation:
    async def test_no_credentials_401(self, unauthed_client):
        resp = await unauthed_client.post(
            "/camera/frame/cam1", files={"file": ("f.jpg", b"\xff\xd8\xff" + b"x" * 100, "image/jpeg")}
        )
        assert resp.status_code == 401

    async def test_internal_key_valid_jpeg_200(self, unauthed_client):
        with patch("worker.celery_app.celery_app") as celery_mock:
            celery_mock.send_task.return_value = MagicMock(id="job-1")
            resp = await unauthed_client.post(
                "/camera/frame/cam1",
                files={"file": ("f.jpg", b"\xff\xd8\xff" + b"x" * 100, "image/jpeg")},
                headers={"X-Internal-Key": INTERNAL_KEY},
            )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_internal_key_oversized_413(self, unauthed_client):
        resp = await unauthed_client.post(
            "/camera/frame/cam1",
            files={"file": ("f.jpg", BIG_OVER_LIMIT, "image/jpeg")},
            headers={"X-Internal-Key": INTERNAL_KEY},
        )
        assert resp.status_code == 413

    async def test_internal_key_non_image_400(self, unauthed_client):
        resp = await unauthed_client.post(
            "/camera/frame/cam1",
            files={"file": ("f.jpg", b"MZ\x90\x00definitely-not-an-image", "application/octet-stream")},
            headers={"X-Internal-Key": INTERNAL_KEY},
        )
        assert resp.status_code == 400


class TestInternalFaceStatus:
    async def test_no_credentials_401(self, unauthed_client):
        resp = await unauthed_client.get("/internal/face/u1/status")
        assert resp.status_code == 401

    async def test_internal_key_200(self, unauthed_client):
        mc = MagicMock()
        mc.client.query.return_value = []
        with patch("infra.milvus_client.get_milvus_client", return_value=mc):
            resp = await unauthed_client.get(
                "/internal/face/u1/status", headers={"X-Internal-Key": INTERNAL_KEY}
            )
        assert resp.status_code == 200
        assert resp.json() == {"enrolled": False}

    async def test_milvus_error_logged_and_enrolled_false(self, unauthed_client, caplog):
        mc = MagicMock()
        mc.client.query.side_effect = Exception("milvus down")
        with patch("infra.milvus_client.get_milvus_client", return_value=mc):
            with caplog.at_level(logging.ERROR):
                resp = await unauthed_client.get(
                    "/internal/face/u1/status", headers={"X-Internal-Key": INTERNAL_KEY}
                )
        assert resp.status_code == 200
        assert resp.json() == {"enrolled": False}
        assert "milvus" in caplog.text.lower()


class TestUploadValidation:
    async def test_face_login_oversized_413(self, test_client):
        resp = await test_client.post(
            "/auth/face-login", files={"file": ("f.jpg", BIG_OVER_LIMIT, "image/jpeg")}
        )
        assert resp.status_code == 413

    async def test_face_login_non_image_400(self, test_client):
        resp = await test_client.post(
            "/auth/face-login", files={"file": ("f.jpg", b"garbage-bytes", "application/octet-stream")}
        )
        assert resp.status_code == 400

    async def test_face_verify_oversized_413(self, test_client):
        resp = await test_client.post(
            "/face/verify",
            files={"file": ("f.jpg", BIG_OVER_LIMIT, "image/jpeg")},
            data={"target_user_id": "u1", "consent_given": "true"},
            headers={"Authorization": f"Bearer {_token(['patron'])}"},
        )
        assert resp.status_code == 413

    async def test_patron_enroll_batch_oversized_413(self, test_client):
        files = {
            name: (f"{name}.jpg", BIG_OVER_LIMIT, "image/jpeg")
            for name in ("frontal", "right", "left", "down")
        }
        with patch(
            "api.routers.patrons._get_user_summary", new=AsyncMock(return_value={"id": "u1"})
        ):
            resp = await test_client.post(
                "/patrons/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/enroll-batch",
                files=files,
                data={"consent_given": "true"},
                headers={"Authorization": f"Bearer {_token(['admin'])}"},
            )
        assert resp.status_code == 413


class TestFaceLoginLockoutFailClosed:
    @patch("worker.tasks._upload_temp_frame", return_value="temp/fake.jpg")
    @patch("worker.tasks.enhance_illumination", side_effect=lambda img: img)
    @patch("worker.tasks.detect_face_once")
    @patch("worker.tasks.safe_read_image_from_bytes")
    @patch("worker.tasks.resize_if_necessary")
    @patch("worker.tasks._get_user_via_api")
    def test_lockout_redis_error_denies_login(
        self,
        mock_user,
        mock_resize,
        mock_read,
        mock_detect,
        mock_enhance,
        mock_upload,
        caplog,
    ):
        from worker.tasks import _sync_face_login

        embedding = np.random.rand(512).astype(np.float32)
        mock_detect.return_value = {"valid": True, "embedding": embedding}
        mock_resize.return_value = MagicMock()
        mock_read.return_value = MagicMock()
        mock_user.return_value = {
            "id": "user-1",
            "email": "u1@example.com",
            "role": "patron",
            "full_name": "User One",
            "student_code": "SV001",
        }

        with patch("worker.tasks._get_milvus") as milvus_mock:
            milvus_mock.return_value.search.return_value = [
                {"user_id": "user-1", "score": 0.9, "angle": "frontal"}
            ]
            with patch("redis.Redis") as redis_mod:
                redis_mod.from_url.side_effect = Exception("Redis down")
                with caplog.at_level(logging.ERROR):
                    result = _sync_face_login(b"fake-image-bytes")

        assert result["status"] == "error"
        assert "không khả dụng" in result["error"] or "khóa" in result["error"].lower()
        assert "lockout" in caplog.text.lower()


class TestCooldownFailClosed:
    def test_check_redis_cooldown_fails_closed_on_error(self, caplog):
        from worker.tasks import _check_redis_cooldown

        with patch("infra.redis_cache.redis_client") as mock_rc:
            mock_rc.get.side_effect = Exception("Redis down")
            with caplog.at_level(logging.ERROR):
                result = _check_redis_cooldown("patron-1", "entry")

        assert result is True
        assert "cooldown" in caplog.text.lower()
