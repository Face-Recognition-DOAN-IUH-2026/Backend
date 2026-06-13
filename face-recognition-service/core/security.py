from __future__ import annotations

from jose import jwt

# Token verification only - token creation is handled by user-service

TokenType = str


def decode_token(
    *,
    token: str,
    secret: str,
    issuer: str,
    audience: str,
    expected_type: TokenType,
) -> dict:
    """Verify and decode a JWT token.
    
    Note: Only user-service has permission to CREATE (sign) tokens.
    This function only verifies tokens that were created by user-service.
    """
    payload = jwt.decode(token, secret, algorithms=["HS256"], issuer=issuer, audience=audience)
    if expected_type and payload.get("typ") != expected_type:
        raise ValueError("Invalid token type")
    return payload