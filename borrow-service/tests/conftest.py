from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch as mock_patch

import pytest
import pytest_asyncio


mock_engine = MagicMock()
mock_async_session_factory = MagicMock()

mock_database_module = MagicMock()
mock_database_module.engine = mock_engine
mock_database_module.async_session_factory = mock_async_session_factory
mock_database_module.Base = MagicMock()
mock_database_module.get_db_session = MagicMock()
mock_database_module.init_db = MagicMock()
mock_database_module.close_db = MagicMock()

sys.modules['src.infra.database'] = mock_database_module
sys.modules['src.infra.models'] = MagicMock()
sys.modules['src.infra.repository'] = MagicMock()

from jose import jwt
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def mock_user_service():
    from unittest.mock import AsyncMock
    mock = AsyncMock()
    mock.get_patron.return_value = {
        "id": "test-patron-id",
        "full_name": "Test Patron",
        "currentStatus": "inside",
        "current_status": "inside",
        "role": "patron",
    }
    return mock


@pytest_asyncio.fixture
async def test_client(mock_user_service) -> AsyncGenerator[AsyncClient, None]:
    with mock_patch("src.api.routers.borrow._check_patron_inside", return_value=True):
        with mock_patch("src.api.routers.borrow.httpx.AsyncClient", return_value=mock_user_service):
            from src.api.app import create_app
            app = create_app()

            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://test"
            ) as client:
                yield client


@pytest_asyncio.fixture
async def db_session():
    pass


@pytest.fixture
def patron_uuid() -> uuid.UUID:
    return uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
def staff_uuid() -> uuid.UUID:
    return uuid.UUID("22222222-2222-2222-2222-222222222222")


@pytest.fixture
def patron_token(patron_uuid) -> str:
    from src.config import settings
    payload = {
        "sub": str(patron_uuid),
        "email": "test@example.com",
        "roles": ["patron"],
        "aud": settings.jwt_audience,
        "iss": settings.jwt_issuer,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@pytest.fixture
def staff_token(staff_uuid) -> str:
    from src.config import settings
    payload = {
        "sub": str(staff_uuid),
        "email": "staff@example.com",
        "roles": ["staff"],
        "aud": settings.jwt_audience,
        "iss": settings.jwt_issuer,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@pytest.fixture
def expired_token(patron_uuid) -> str:
    from src.config import settings
    payload = {
        "sub": str(patron_uuid),
        "email": "test@example.com",
        "roles": ["patron"],
        "aud": settings.jwt_audience,
        "iss": settings.jwt_issuer,
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
        "typ": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@pytest.fixture
def auth_headers_patron(patron_token) -> dict:
    return {"Authorization": f"Bearer {patron_token}"}


@pytest.fixture
def auth_headers_staff(staff_token) -> dict:
    return {"Authorization": f"Bearer {staff_token}"}