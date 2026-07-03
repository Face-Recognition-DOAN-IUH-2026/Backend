"""Service-to-Service JWT token utilities for face-recognition-service.

Generates and verifies JWT tokens for inter-service communication.
Uses the same algorithm (HS256) and shared secret as the Node.js services.
"""

from __future__ import annotations

import time
from typing import Optional

from jose import jwt

# Token type identifier
SERVICE_TOKEN_TYPE = "service"

# Token cache to avoid regeneration on every call
_token_cache: dict[str, dict] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


def generate_service_token(
    service_name: str,
    scopes: list[str],
    secret: str,
    expires_in_seconds: int = 900,
) -> str:
    """Generate a JWT token for service-to-service communication.

    Args:
        service_name: Name of the calling service (e.g., 'face-recognition-service')
        scopes: List of permission scopes (e.g., ['users:read', 'access:read'])
        secret: Secret key used to sign the token
        expires_in_seconds: Token expiration time in seconds (default: 900 = 15 min)

    Returns:
        Signed JWT token string
    """
    now = int(time.time())
    payload = {
        "sub": service_name,
        "scope": scopes,
        "typ": SERVICE_TOKEN_TYPE,
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def verify_service_token(token: str, secret: str) -> dict:
    """Verify a service JWT token and return its payload.

    Args:
        token: JWT token string to verify
        secret: Secret key used to sign the token

    Returns:
        Token payload dict with 'sub', 'scope', 'exp', etc.

    Raises:
        ValueError: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        if payload.get("typ") != SERVICE_TOKEN_TYPE:
            raise ValueError(f"Invalid token type: {payload.get('typ')}")
        return payload
    except Exception as e:
        raise ValueError(f"Invalid service token: {e}")


def get_service_token(
    service_name: str,
    scopes: list[str],
    secret: str,
    expires_in_seconds: int = 900,
) -> str:
    """Get a cached or newly generated service token.

    Tokens are cached for 5 minutes and refreshed 60 seconds before expiry.
    This avoids regenerating tokens on every HTTP call.

    Args:
        service_name: Name of the calling service
        scopes: List of permission scopes
        secret: Secret key used to sign the token
        expires_in_seconds: Token expiration time in seconds

    Returns:
        Valid JWT token string
    """
    cache_key = f"{service_name}:{','.join(sorted(scopes))}"
    now = int(time.time())

    # Check cache
    if cache_key in _token_cache:
        cached = _token_cache[cache_key]
        # Refresh if more than 60 seconds before expiry
        if cached["exp"] - now > 60:
            return cached["token"]

    # Generate new token
    token = generate_service_token(service_name, scopes, secret, expires_in_seconds)
    payload = verify_service_token(token, secret)

    _token_cache[cache_key] = {
        "token": token,
        "exp": payload["exp"],
    }

    return token


def get_auth_headers(
    service_name: str,
    scopes: list[str],
    secret: str,
) -> dict[str, str]:
    """Get HTTP headers with Authorization Bearer token.

    Args:
        service_name: Name of the calling service
        scopes: List of permission scopes
        secret: Secret key used to sign the token

    Returns:
        Dict with 'Authorization' header
    """
    token = get_service_token(service_name, scopes, secret)
    return {"Authorization": f"Bearer {token}"}
