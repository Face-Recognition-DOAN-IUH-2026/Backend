from __future__ import annotations

from fastapi import Depends, HTTPException, status
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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials

    secrets = [
        (settings.jwt_access_secret, "access"),
    ]
    if settings.user_service_jwt_secret:
        secrets.insert(0, (settings.user_service_jwt_secret, "access"))

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
