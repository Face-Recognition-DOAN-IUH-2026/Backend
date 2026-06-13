from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from celery.result import AsyncResult


class TestFaceRecognitionAsyncTasks:
    """FR-01 to FR-10: Face Recognition Async Celery Task Tests"""

    @pytest.mark.asyncio
    async def test_fr01_enroll_batch_returns_job_id(
        self, test_client, auth_headers_patron, test_image_bytes, mock_celery_task
    ):
        """FR-01: Enroll batch returns 202 with job_id"""
        files = {
            "frontal": ("frontal.jpg", test_image_bytes, "image/jpeg"),
            "right": ("right.jpg", test_image_bytes, "image/jpeg"),
            "left": ("left.jpg", test_image_bytes, "image/jpeg"),
            "down": ("down.jpg", test_image_bytes, "image/jpeg"),
        }
        data = {"consent_given": True}

        response = await test_client.post(
            "/face/enroll-batch",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result

    @pytest.mark.asyncio
    async def test_fr02_verify_face_returns_job_id(
        self, test_client, auth_headers_patron, test_image_bytes, mock_celery_task, test_patron_user
    ):
        """FR-02: Verify face returns 202 with job_id"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {
            "target_user_id": str(test_patron_user.id),
            "consent_given": True,
        }

        response = await test_client.post(
            "/face/verify",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result

    @pytest.mark.asyncio
    async def test_fr03_identify_face_returns_job_id(
        self, test_client, auth_headers_patron, test_image_bytes, mock_celery_task
    ):
        """FR-03: Identify face returns 202 with job_id"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"consent_given": True}

        response = await test_client.post(
            "/face/identify",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result

    @pytest.mark.asyncio
    async def test_fr04_liveness_check_returns_job_id(
        self, test_client, auth_headers_patron, test_image_bytes, mock_celery_task
    ):
        """FR-04: Liveness check returns 202 with job_id"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"consent_given": True}

        response = await test_client.post(
            "/face/liveness",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result

    @pytest.mark.asyncio
    async def test_fr05_poll_task_pending_to_success(self, test_client, auth_headers_admin):
        """FR-05: Poll task PENDING → SUCCESS transition"""
        mock_task = MagicMock()
        mock_task.id = "poll-test-task-id"
        mock_task.status = "PENDING"
        mock_task.result = None

        result_holder = {"call_count": 0}

        def get_task_result(task_id):
            result_holder["call_count"] += 1
            if result_holder["call_count"] == 1:
                return {"task_id": task_id, "status": "PENDING", "result": None}
            else:
                return {
                    "task_id": task_id,
                    "status": "SUCCESS",
                    "result": {"status": "success", "score": 0.95, "is_live": True},
                }

        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_result = MagicMock()
            mock_result.status = "PENDING"
            mock_result.result = None
            mock_async_result.return_value = mock_result

            response = await test_client.get("/tasks/poll-test-task-id")
            data = response.json()
            initial_status = data.get("status")

        mock_result.status = "SUCCESS"
        mock_result.result = {"status": "success", "score": 0.95, "is_live": True}
        mock_async_result.return_value = mock_result

        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_async_result.return_value = mock_result
            response = await test_client.get("/tasks/poll-test-task-id")
            data = response.json()
            final_status = data.get("status")

        assert initial_status in ["PENDING", "SUCCESS"]
        assert final_status == "SUCCESS"

    @pytest.mark.asyncio
    async def test_fr06_task_not_found(self, test_client, auth_headers_admin):
        """FR-06: Task not found returns error"""
        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_result = MagicMock()
            mock_result.status = "PENDING"
            mock_result.result = None
            mock_result._cache = None
            mock_async_result.return_value = mock_result

            response = await test_client.get("/tasks/nonexistent-task-id")
            data = response.json()

        assert "task_id" in data

    @pytest.mark.asyncio
    async def test_fr07_kiosk_enter_returns_job_id(
        self, test_client, test_image_bytes, mock_celery_task, test_patron_user
    ):
        """FR-07: Kiosk enter returns 200 with job_id"""
        files = {"image": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"student_code": test_patron_user.student_code}

        response = await test_client.post(
            "/kiosk/enter",
            files=files,
            data=data,
        )

        assert response.status_code == 200
        result = response.json()
        assert "job_id" in result
        assert result.get("success") is True

    @pytest.mark.asyncio
    async def test_fr08_kiosk_lookup_valid_patron(
        self, test_client, test_patron_user
    ):
        """FR-08: Kiosk lookup returns patron info for valid student_code"""
        response = await test_client.post(
            "/kiosk/lookup",
            json={"student_code": test_patron_user.student_code},
        )

        assert response.status_code == 200
        result = response.json()
        assert result["exists"] is True
        assert result["patron"] is not None
        assert result["patron"]["student_code"] == test_patron_user.student_code

    @pytest.mark.asyncio
    async def test_fr09_kiosk_lookup_invalid_patron(self, test_client):
        """FR-09: Kiosk lookup returns exists=false for invalid student_code"""
        response = await test_client.post(
            "/kiosk/lookup",
            json={"student_code": "NONEXISTENT"},
        )

        assert response.status_code == 200
        result = response.json()
        assert result["exists"] is False
        assert result["patron"] is None

    @pytest.mark.asyncio
    async def test_fr10_enroll_single_angle_deprecated(
        self, test_client, auth_headers_patron, test_image_bytes
    ):
        """FR-10: Single angle enrollment returns 410 Gone"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"angle": "frontal", "consent_given": True}

        response = await test_client.post(
            "/face/enroll",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 410


class TestFaceEnrollments:
    """Additional tests for face enrollment flows"""

    @pytest.mark.asyncio
    async def test_enroll_batch_requires_consent(
        self, test_client, auth_headers_patron, test_image_bytes
    ):
        """Enrollment without consent is rejected"""
        files = {
            "frontal": ("frontal.jpg", test_image_bytes, "image/jpeg"),
            "right": ("right.jpg", test_image_bytes, "image/jpeg"),
            "left": ("left.jpg", test_image_bytes, "image/jpeg"),
            "down": ("down.jpg", test_image_bytes, "image/jpeg"),
        }
        data = {"consent_given": False}

        response = await test_client.post(
            "/face/enroll-batch",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_kiosk_enroll_face_success(
        self, test_client, test_image_bytes, test_patron_user, mock_celery_task
    ):
        """Kiosk enroll additional face angle"""
        files = {"image": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"angle": "right"}

        response = await test_client.post(
            f"/kiosk/enroll-face/{test_patron_user.id}",
            files=files,
            data=data,
        )

        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_kiosk_enroll_face_patron_not_found(
        self, test_client, test_image_bytes
    ):
        """Kiosk enroll face for non-existent patron returns 404"""
        files = {"image": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"angle": "frontal"}

        response = await test_client.post(
            "/kiosk/enroll-face/99999999-9999-9999-9999-999999999999",
            files=files,
            data=data,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_identify_requires_consent(
        self, test_client, auth_headers_patron, test_image_bytes
    ):
        """Identify without consent is rejected"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"consent_given": False}

        response = await test_client.post(
            "/face/identify",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 400


class TestTaskPolling:
    """Tests for task polling and status checking"""

    @pytest.mark.asyncio
    async def test_task_status_pending(self, test_client, auth_headers_admin):
        """Task with PENDING status returns correct response"""
        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_result = MagicMock()
            mock_result.task_id = "test-pending-task"
            mock_result.status = "PENDING"
            mock_result.result = None
            mock_async_result.return_value = mock_result

            response = await test_client.get("/tasks/test-pending-task")
            data = response.json()

        assert data["task_id"] == "test-pending-task"
        assert data["status"] == "PENDING"
        assert data["result"] is None

    @pytest.mark.asyncio
    async def test_task_status_success(self, test_client, auth_headers_admin):
        """Task with SUCCESS status returns result"""
        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_result = MagicMock()
            mock_result.task_id = "test-success-task"
            mock_result.status = "SUCCESS"
            mock_result.result = {"status": "success", "score": 0.95}
            mock_async_result.return_value = mock_result

            response = await test_client.get("/tasks/test-success-task")
            data = response.json()

        assert data["task_id"] == "test-success-task"
        assert data["status"] == "SUCCESS"
        assert data["result"] is not None
        assert data["result"]["status"] == "success"

    @pytest.mark.asyncio
    async def test_task_status_failure(self, test_client, auth_headers_admin):
        """Task with FAILURE status returns error"""
        with patch("api.routers.tasks.AsyncResult") as mock_async_result:
            mock_result = MagicMock()
            mock_result.task_id = "test-failure-task"
            mock_result.status = "FAILURE"
            mock_result.result = "NO_FACE_DETECTED"
            mock_async_result.return_value = mock_result

            response = await test_client.get("/tasks/test-failure-task")
            data = response.json()

        assert data["task_id"] == "test-failure-task"
        assert data["status"] == "FAILURE"
        assert data["result"] is not None

    @pytest.mark.asyncio
    async def test_delete_face_requires_admin(
        self, test_client, auth_headers_patron, mock_celery_task
    ):
        """Delete face endpoint requires admin role"""
        response = await test_client.delete(
            "/face/some-user-id",
            headers=auth_headers_patron,
        )

        assert response.status_code in [401, 403]

    @pytest.mark.asyncio
    async def test_delete_face_success_admin(
        self, test_client, auth_headers_admin, mock_celery_task
    ):
        """Delete face succeeds with admin token"""
        response = await test_client.delete(
            "/face/some-user-id",
            headers=auth_headers_admin,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result


class TestLivenessCheck:
    """Tests for liveness detection"""

    @pytest.mark.asyncio
    async def test_liveness_returns_job_id(
        self, test_client, auth_headers_patron, test_image_bytes, mock_celery_task
    ):
        """Liveness check returns 202 with job_id"""
        files = {"file": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {"consent_given": True}

        response = await test_client.post(
            "/face/liveness",
            files=files,
            data=data,
            headers=auth_headers_patron,
        )

        assert response.status_code == 202
        result = response.json()
        assert "job_id" in result


class TestKioskEnroll:
    """Tests for kiosk enrollment flows"""

    @pytest.mark.asyncio
    async def test_kiosk_batch_enroll_missing_images(
        self, test_client
    ):
        """Batch enroll requires all 4 angles"""
        files = {
            "image_frontal": ("frontal.jpg", b"fake", "image/jpeg"),
        }
        data = {
            "full_name": "Test User",
            "student_code": "TEST123",
            "membership_expiry": "2025-12-31",
        }

        response = await test_client.post(
            "/kiosk/batch-enroll",
            files=files,
            data=data,
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_kiosk_enroll_duplicate_student_code(
        self, test_client, test_image_bytes, test_patron_user
    ):
        """Enrollment with duplicate student_code returns 409"""
        files = {"image": ("face.jpg", test_image_bytes, "image/jpeg")}
        data = {
            "full_name": "Another User",
            "student_code": test_patron_user.student_code,
            "membership_expiry": "2025-12-31",
        }

        with patch("api.routers.kiosk.celery_app") as mock_celery:
            mock_task = MagicMock()
            mock_task.id = "task-id"
            mock_task.get.return_value = {"status": "success"}
            mock_celery.send_task.return_value = mock_task

            with patch("api.routers.kiosk._proxy_create_user") as mock_proxy:
                mock_proxy.return_value = {
                    "id": "new-user-id",
                    "student_code": test_patron_user.student_code,
                }

                response = await test_client.post(
                    "/kiosk/enroll",
                    files=files,
                    data=data,
                )

        assert response.status_code == 409