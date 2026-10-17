from __future__ import annotations

import secrets as _secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import decode_token
from infra.config import settings
from infra.database import async_session_factory

security = HTTPBearer()


async def get_db_session() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


def _try_decode_token(token: str, secrets: list[tuple[str, str]]) -> dict | None:
    for secret, expected_type in secrets:
        try:
            return decode_token(
                token=token,
                secret=secret,
                issuer=settings.jwt_issuer,
                audience=settings.jwt_audience,
                expected_type=expected_type,
            )
        except Exception:
            continue
    return None


def _decode_optional(request: Request) -> dict | None:
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    secrets_list: list[tuple[str, str]] = [
        (settings.jwt_access_secret, "access"),
    ]
    if settings.service_jwt_secret:
        secrets_list.insert(0, (settings.service_jwt_secret, "access"))
    return _try_decode_token(token, secrets_list)


async def require_internal_key_or_staff(request: Request) -> dict | None:
    """Device/service guard: X-Internal-Key OR admin/staff JWT. 401/403 otherwise."""
    expected = settings.internal_api_key
    provided = request.headers.get("x-internal-key", "")
    if expected and provided and _secrets.compare_digest(provided, expected):
        return None
    user = _decode_optional(request)
    if user is not None:
        roles = user.get("roles") or []
        if any(role in ("admin", "staff") for role in roles):
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials

    secrets = [
        (settings.jwt_access_secret, "access"),
    ]
    if settings.service_jwt_secret:
        secrets.insert(0, (settings.service_jwt_secret, "access"))

    payload = _try_decode_token(token, secrets)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    return {
        "id": payload["sub"],
        "email": payload.get("email", ""),
        "full_name": payload.get("full_name"),
        "role": (payload.get("roles") or [""])[0],
        "student_code": payload.get("student_code"),
    }


def require_role(required_role: str):
    async def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return role_checker
