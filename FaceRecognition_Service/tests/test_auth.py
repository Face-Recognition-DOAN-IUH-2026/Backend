from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from core.security import create_access_token, create_refresh_token, decode_token

SECRET = "test-secret"
ISSUER = "test-issuer"
AUDIENCE = "test-audience"


def test_create_access_token():
    token = create_access_token(
        subject="user-123",
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expires_minutes=15,
        roles=["user"],
    )
    payload = jwt.decode(token, SECRET, algorithms=["HS256"], issuer=ISSUER, audience=AUDIENCE)
    assert payload["sub"] == "user-123"
    assert payload["typ"] == "access"
    assert payload["roles"] == ["user"]
    assert "exp" in payload
    assert "iat" in payload


def test_create_refresh_token():
    token = create_refresh_token(
        subject="user-123",
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expires_days=30,
        roles=["user"],
    )
    payload = jwt.decode(token, SECRET, algorithms=["HS256"], issuer=ISSUER, audience=AUDIENCE)
    assert payload["sub"] == "user-123"
    assert payload["typ"] == "refresh"
    assert payload["roles"] == ["user"]


def test_decode_access_token_success():
    token = create_access_token(
        subject="user-123",
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expires_minutes=15,
        roles=["user"],
    )
    payload = decode_token(
        token=token,
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expected_type="access",
    )
    assert payload["sub"] == "user-123"


def test_decode_token_wrong_type():
    token = create_access_token(
        subject="user-123",
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expires_minutes=15,
        roles=["user"],
    )
    with pytest.raises(ValueError, match="Invalid token type"):
        decode_token(
            token=token,
            secret=SECRET,
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_type="refresh",
        )


def test_decode_token_expired():
    payload = {
        "sub": "user-123",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "roles": ["user"],
        "typ": "access",
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
    }
    token = jwt.encode(payload, SECRET, algorithm="HS256")
    with pytest.raises(Exception):
        decode_token(
            token=token,
            secret=SECRET,
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_type="access",
        )
