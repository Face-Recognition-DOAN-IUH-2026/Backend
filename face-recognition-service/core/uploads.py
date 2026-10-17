from __future__ import annotations

from fastapi import HTTPException

MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024


def _is_supported_image(raw: bytes) -> bool:
    if raw[:3] == b"\xff\xd8\xff":
        return True
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return True
    return False


def validate_image_upload(raw: bytes, *, max_bytes: int = MAX_IMAGE_UPLOAD_BYTES) -> None:
    """Size + magic-byte validation aligned with /face/process (5MB, JPEG/PNG/WebP)."""
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image")
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large (max {max_bytes // (1024 * 1024)}MB)",
        )
    if not _is_supported_image(raw):
        raise HTTPException(
            status_code=400,
            detail="Unsupported image format. Allowed: JPEG, PNG, WebP",
        )
