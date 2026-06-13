from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "face-recognition-platform"
    env: str = "dev"
    log_level: str = "INFO"

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

    celery_broker_url: str
    celery_result_backend: str

    data_encryption_key: str

    entry_cam_id: str = "entry_gate"
    exit_cam_id: str = "exit_gate"
    entry_cam_url: str = ""
    exit_cam_url: str = ""
    relay_api_url: str = ""
    face_match_threshold: float = 0.5
    access_cooldown_seconds: int = 10
    max_entry_hours: int = 24
    enable_person_detection: bool = True
    enable_multi_angle: bool = True
    min_face_size: int = 80
    frame_process_interval: float = 1.0
    direction_grace_seconds: int = 120
    camera_max_queue_depth: int = 50

    user_service_url: str = "http://user-service:3001"
    internal_api_key: str = ""
    user_service_jwt_secret: str = ""


settings = Settings()
