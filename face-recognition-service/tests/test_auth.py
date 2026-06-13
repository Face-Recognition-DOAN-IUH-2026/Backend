from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from core.security import decode_token


SECRET = "test-secret"
ISSUER = "test-issuer"
AUDIENCE = "test-audience"


def _make_token(payload: dict) -> str:
    return jwt.encode(payload, SECRET, algorithm="HS256")


def test_decode_token_success():
    payload = {
        "sub": "user-123",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "roles": ["user"],
        "typ": "access",
        "iat": datetime.now(timezone.utc),
    }
    token = _make_token(payload)

    result = decode_token(
        token=token,
        secret=SECRET,
        issuer=ISSUER,
        audience=AUDIENCE,
        expected_type="access",
    )
    assert result["sub"] == "user-123"
    assert result["typ"] == "access"


def test_decode_token_wrong_type():
    payload = {
        "sub": "user-123",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "roles": ["user"],
        "typ": "access",
        "iat": datetime.now(timezone.utc),
    }
    token = _make_token(payload)

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
    token = _make_token(payload)

    with pytest.raises(Exception):
        decode_token(
            token=token,
            secret=SECRET,
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_type="access",
        )


def test_decode_token_wrong_secret():
    payload = {
        "sub": "user-123",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "roles": ["user"],
        "typ": "access",
        "iat": datetime.now(timezone.utc),
    }
    token = _make_token(payload)

    with pytest.raises(Exception):
        decode_token(
            token=token,
            secret="wrong-secret",
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_type="access",
        )


def test_decode_token_wrong_issuer():
    payload = {
        "sub": "user-123",
        "iss": "wrong-issuer",
        "aud": AUDIENCE,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "roles": ["user"],
        "typ": "access",
        "iat": datetime.now(timezone.utc),
    }
    token = _make_token(payload)

    with pytest.raises(Exception):
        decode_token(
            token=token,
            secret=SECRET,
            issuer=ISSUER,
            audience=AUDIENCE,
            expected_type="access",
        )