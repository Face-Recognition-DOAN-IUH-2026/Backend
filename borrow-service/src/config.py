from __future__ import annotations

import os
from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    service_name: str = "borrow-service"
    port: int = 8000
    node_env: str = "development"

    postgres_url: str = os.getenv(
        "POSTGRES_URL",
        "postgresql://postgres:postgres@localhost:5432/borrowdb"
    )

    user_service_url: str = os.getenv(
        "USER_SERVICE_URL",
        "http://user-service:3001"
    )

    jwt_secret: str = os.getenv("JWT_ACCESS_SECRET", "change-me-in-production")
    jwt_issuer: str = os.getenv("JWT_ISSUER", "face-recognition")
    jwt_audience: str = os.getenv("JWT_AUDIENCE", "face-recognition-users")

    internal_api_key: str = os.getenv("INTERNAL_API_KEY", "internal-secret-key")

    max_borrow_days: int = 14
    max_borrow_books: int = 3

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()