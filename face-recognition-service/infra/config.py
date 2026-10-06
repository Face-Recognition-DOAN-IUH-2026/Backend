from __future__ import annotations

from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "face-recognition-platform"
    env: str = "dev"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000,http://localhost:19006"

    jwt_issuer: str
    jwt_audience: str
    jwt_access_secret: str
    jwt_refresh_secret: str
    jwt_access_expires_minutes: int = 15
    jwt_refresh_expires_days: int = 30

    redis_url: str

    postgres_url: str

    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str

    milvus_host: str
    milvus_port: int = 19530
    milvus_collection: str = "face_embeddings"

    use_cuda: bool = False
    max_image_width: int = 1280
    max_image_height: int = 1280
    max_image_pixels: int = 2073600

    celery_broker_url: str = "amqp://guest:guest@rabbitmq:5672"
    celery_result_backend: str = ""
    rabbitmq_url: str = "amqp://guest:guest@rabbitmq:5672"

    data_encryption_key: str

    entry_cam_id: str = "entry_gate"
    exit_cam_id: str = "exit_gate"
    entry_cam_url: str = ""
    exit_cam_url: str = ""
    relay_api_url: str = ""
    face_match_threshold: float = 0.65
    access_cooldown_seconds: int = 10
    max_entry_hours: int = 24
    liveness_threshold: float = 0.5
    enable_active_liveness: bool = True
    active_liveness_reject_below: float = 0.45
    active_liveness_live_above: float = 0.65
    active_liveness_frames: int = 3
    active_liveness_interval_ms: int = 1500
    active_liveness_max_attempts: int = 3
    enable_person_detection: bool = True
    enable_multi_angle: bool = True
    min_face_size: int = 80
    frame_process_interval: float = 1.0
    direction_grace_seconds: int = 120
    strict_direction: bool = False
    camera_max_queue_depth: int = 50

    user_service_url: str = "http://user-service:3001"
    access_service_url: str = "http://access-service:3003"
    service_jwt_secret: str = ""

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.env.strip().lower() not in {"production", "prod"}:
            return self

        secret_values = {
            "JWT_ACCESS_SECRET": self.jwt_access_secret,
            "JWT_REFRESH_SECRET": self.jwt_refresh_secret,
            "SERVICE_JWT_SECRET": self.service_jwt_secret,
            "MINIO_SECRET_KEY": self.minio_secret_key,
            "DATA_ENCRYPTION_KEY": self.data_encryption_key,
        }
        for name, value in secret_values.items():
            normalized = value.strip()
            if len(normalized) < 32 or normalized.upper().startswith("REPLACE_WITH"):
                raise ValueError(f"{name} must be an externally supplied production secret")

        minio_access_key = self.minio_access_key.strip()
        if (
            not minio_access_key
            or minio_access_key.lower() == "minioadmin"
            or minio_access_key.upper().startswith("REPLACE_WITH")
        ):
            raise ValueError("MINIO_ACCESS_KEY must be externally supplied in production")

        credential_urls = {
            "POSTGRES_URL": self.postgres_url,
            "REDIS_URL": self.redis_url,
            "CELERY_BROKER_URL": self.celery_broker_url,
            "RABBITMQ_URL": self.rabbitmq_url,
        }
        forbidden_passwords = {"guest", "postgres", "minioadmin", "password"}
        for name, value in credential_urls.items():
            parsed = urlparse(value)
            username = (parsed.username or "").lower()
            password = (parsed.password or "").lower()
            requires_username = name != "REDIS_URL"
            if not password or (requires_username and not username):
                raise ValueError(f"{name} must include production credentials")
            if "REPLACE_" in value.upper() or password in forbidden_passwords:
                raise ValueError(f"{name} contains default credentials")
            if name in {"CELERY_BROKER_URL", "RABBITMQ_URL"} and username == "guest":
                raise ValueError(f"{name} contains the default RabbitMQ identity")

        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if not origins or "*" in origins:
            raise ValueError("CORS_ORIGINS must explicitly allow trusted origins in production")

        return self


# Required values are injected by pydantic-settings from the process environment.
settings = Settings()  # type: ignore[call-arg]
