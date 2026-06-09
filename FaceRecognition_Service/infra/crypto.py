from __future__ import annotations

import base64

from cryptography.fernet import Fernet

from infra.config import settings


def _get_fernet() -> Fernet:
    raw = settings.data_encryption_key.encode("utf-8")
    if len(raw) < 32:
        raw = raw + b"x" * (32 - len(raw))
    else:
        raw = raw[:32]
    key = base64.urlsafe_b64encode(raw)
    return Fernet(key)


def encrypt_data(data: bytes) -> bytes:
    return _get_fernet().encrypt(data)


def decrypt_data(data: bytes) -> bytes:
    return _get_fernet().decrypt(data)
