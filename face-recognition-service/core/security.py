from __future__ import annotations

import datetime as dt
from typing import Literal

from jose import jwt


def create_access_token(
    *,
    subject: str,
    secret: str,
    issuer: str,
    audience: str,
    expires_minutes: int,
    roles: list[str],
) -> str:
    now = dt.datetime.now(dt.UTC)
    exp = now + dt.timedelta(minutes=expires_minutes)
    payload = {
        "sub": subject,
        "iss": issuer,
        "aud": audience,
        "exp": exp,
        "roles": roles,
        "typ": "access",
        "iat": now,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def create_refresh_token(
    *,
    subject: str,
    secret: str,
    issuer: str,
    audience: str,
    expires_days: int,
    roles: list[str],
) -> str:
    now = dt.datetime.now(dt.UTC)
    exp = now + dt.timedelta(days=expires_days)
    payload = {
        "sub": subject,
        "iss": issuer,
        "aud": audience,
        "exp": exp,
        "roles": roles,
        "typ": "refresh",
        "iat": now,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


TokenType = Literal["access", "refresh"]


def decode_token(
    *,
    token: str,
    secret: str,
    issuer: str,
    audience: str,
    expected_type: TokenType,
) -> dict:
    payload = jwt.decode(token, secret, algorithms=["HS256"], issuer=issuer, audience=audience)
    if payload.get("typ") != expected_type:
        raise ValueError("Invalid token type")
    return payload

