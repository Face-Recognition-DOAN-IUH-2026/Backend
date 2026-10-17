from __future__ import annotations

import asyncio
import uuid as _uuid
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from PIL import Image


@pytest.fixture(autouse=True)
def _internal_api_key_setting(monkeypatch):
    from infra.config import settings

    monkeypatch.setattr(settings, "internal_api_key", "test-internal-key")


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_celery_task():
    mock_task = MagicMock()
    mock_task.id = "test-task-id-12345"
    mock_task.delay = MagicMock(return_value=mock_task)
    mock_task.status = "PENDING"
    mock_task.result = None

    with patch("worker.tasks.batch_enroll_task", return_value=mock_task) as mock:
        with patch("worker.tasks.verify_task", return_value=mock_task):
            with patch("worker.tasks.identify_task", return_value=mock_task):
                with patch("worker.tasks.liveness_task", return_value=mock_task):
                    with patch("worker.tasks.delete_user_task", return_value=mock_task):
                        with patch("worker.tasks.enroll_face", return_value=mock_task):
                            with patch("worker.tasks.verify_face", return_value=mock_task):
                                yield mock_task


@pytest.fixture
def mock_celery_app():
    mock = MagicMock()
    mock.send_task = MagicMock()
    return mock


@pytest.fixture
def admin_token() -> str:
    from jose import jwt

    payload = {
        "sub": "admin-user-id",
        "email": "admin@example.com",
        "roles": ["admin"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
        "typ": "access",
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def patron_token() -> str:
    from jose import jwt

    payload = {
        "sub": "patron-user-id",
        "email": "patron@example.com",
        "roles": ["patron"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
        "typ": "access",
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def staff_token() -> str:
    from jose import jwt

    payload = {
        "sub": "staff-user-id",
        "email": "staff@example.com",
        "roles": ["staff"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
        "typ": "access",
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def expired_token() -> str:
    from jose import jwt

    payload = {
        "sub": "patron-user-id",
        "email": "patron@example.com",
        "roles": ["patron"],
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
        "typ": "access",
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")


@pytest.fixture
def auth_headers_admin(admin_token) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def auth_headers_patron(patron_token) -> dict:
    return {"Authorization": f"Bearer {patron_token}"}


@pytest.fixture
def auth_headers_staff(staff_token) -> dict:
    return {"Authorization": f"Bearer {staff_token}"}


def _create_test_image_bytes(
    width: int = 640,
    height: int = 480,
    color: tuple[int, int, int] = (128, 128, 128),
    format: str = "JPEG",
) -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = BytesIO()
    img.save(buf, format=format)
    return buf.getvalue()


@pytest.fixture
def test_image_bytes() -> bytes:
    return _create_test_image_bytes()


@pytest.fixture
def test_image_no_face() -> bytes:
    return _create_test_image_bytes(color=(200, 200, 200))


@pytest.fixture
def test_image_blur() -> bytes:
    img = Image.new("RGB", (640, 480), color=(128, 128, 128))
    buf = BytesIO()
    img.save(buf, "JPEG", quality=10)
    return buf.getvalue()


@pytest.fixture
def mock_milvus_client():
    with patch("infra.milvus_client.MilvusClient") as mock:
        instance = MagicMock()
        instance.search.return_value = [{"user_id": "test-user", "score": 0.95}]
        instance.insert.return_value = True
        instance.delete_by_user_id.return_value = True
        instance.collection_exists.return_value = True
        mock.return_value = instance
        yield instance


@pytest.fixture
def mock_redis():
    instance = AsyncMock()
    instance.exists.return_value = 0
    instance.setex.return_value = True
    instance.get.return_value = None
    instance.delete.return_value = True

    with patch("infra.redis_cache.redis_client", instance):
        with patch("infra.cooldown.aioredis.from_url", MagicMock(return_value=instance)):
            yield instance


@pytest.fixture
def mock_minio_client():
    with patch("infra.minio_client.MinioStorage") as mock:
        instance = MagicMock()
        instance.upload_image.return_value = "https://minio.example.com/test.jpg"
        instance.delete_image.return_value = True
        instance.generate_presigned_url.return_value = "https://minio.example.com/test.jpg"
        mock.return_value = instance
        yield instance


@pytest_asyncio.fixture
async def test_client(mock_celery_task, mock_milvus_client, mock_redis, mock_minio_client) -> AsyncGenerator[AsyncClient, None]:
    from api.app import create_app

    app = create_app()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Internal-Key": "test-internal-key"},
    ) as client:
        yield client


@pytest_asyncio.fixture
async def db_with_schema():
    from infra.database import engine, Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session(db_with_schema):
    from infra.database import async_session_factory

    async with async_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def test_patron_user(db_session):
    from infra.models import UserModel

    user = UserModel(
        id=_uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
        full_name="Test Patron",
        email="patron@example.com",
        student_code="PATRON001",
        card_number="THV-PATRON001",
        status="active",
        current_status="outside",
        membership_expiry=date(2099, 12, 31),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_expired_patron(db_session):
    from infra.models import UserModel

    user = UserModel(
        id=_uuid.UUID("bbbbbbbb-cccc-dddd-eeee-ffffffffffff"),
        full_name="Expired Patron",
        email="expired@example.com",
        student_code="EXPIRED001",
        card_number="THV-EXPIRED001",
        status="active",
        current_status="outside",
        membership_expiry=date(2020, 1, 1),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def mock_celery_task_success():
    task = MagicMock()
    task.id = "success-task-id"
    task.status = "SUCCESS"
    task.result = {"status": "success", "score": 0.95, "is_live": True}
    return task


@pytest.fixture
def mock_celery_task_failure():
    task = MagicMock()
    task.id = "failure-task-id"
    task.status = "FAILURE"
    task.result = {"error": "NO_FACE_DETECTED"}
    return task


@pytest.fixture
def mock_celery_task_pending():
    task = MagicMock()
    task.id = "pending-task-id"
    task.status = "PENDING"
    task.result = None
    return task
