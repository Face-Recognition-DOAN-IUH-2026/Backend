from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    SERVICE_NAME: str = "fire-detection-service"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    PORT: int = int(os.getenv("FIRE_DETECTION_PORT", "8008"))
    HOST: str = "0.0.0.0"

    # Model settings
    MODEL_PATH: str = os.getenv("MODEL_PATH", "nvidia/LocateAnything-3B")
    DEVICE: str = os.getenv("DEVICE", "cuda")  # "cuda" or "cpu"
    TORCH_DTYPE: str = os.getenv("TORCH_DTYPE", "bfloat16")  # "bfloat16", "float16", "float32"
    USE_MOCK_MODEL: bool = os.getenv("USE_MOCK_MODEL", "false").lower() in ("true", "1", "yes")

    # Local YOLOv8 Fire & Smoke Model
    USE_LOCAL_YOLO: bool = os.getenv("USE_LOCAL_YOLO", "true").lower() in ("true", "1", "yes")
    YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "models/fire_smoke_yolov8n.pt")
    YOLO_CONF_THRESHOLD: float = float(os.getenv("YOLO_CONF_THRESHOLD", "0.25"))

    # Remote Inference Server (Google Colab / vLLM / FastAPI Server qua Ngrok)
    REMOTE_SERVER_URL: Optional[str] = os.getenv("REMOTE_SERVER_URL", None)
    USE_REMOTE_SERVER: bool = os.getenv("USE_REMOTE_SERVER", "false").lower() in ("true", "1", "yes")

    # Detection Prompts
    DEFAULT_PROMPT: str = os.getenv(
        "FIRE_SMOKE_PROMPT", 
        "Locate all the instances that matches the following description: fire</c>smoke."
    )
    MAX_NEW_TOKENS: int = 2048
    GENERATION_MODE: str = "hybrid"

    # Anti-False Alarm / Temporal Filter
    MIN_CONSECUTIVE_FRAMES: int = int(os.getenv("MIN_CONSECUTIVE_FRAMES", "3"))
    IOU_THRESHOLD: float = float(os.getenv("IOU_THRESHOLD", "0.3"))
    FRAME_WINDOW_SECONDS: float = float(os.getenv("FRAME_WINDOW_SECONDS", "3.0"))

    # Messaging / RabbitMQ
    RABBITMQ_HOST: str = os.getenv("RABBITMQ_HOST", "localhost")
    RABBITMQ_PORT: int = int(os.getenv("RABBITMQ_PORT", "5672"))
    RABBITMQ_USER: str = os.getenv("RABBITMQ_USER", "guest")
    RABBITMQ_PASS: str = os.getenv("RABBITMQ_PASS", "guest")
    HAZARD_EXCHANGE: str = "hazard_exchange"
    FIRE_ROUTING_KEY: str = "hazard.fire.detected"

    # Snapshot storage
    SNAPSHOT_DIR: str = os.getenv("SNAPSHOT_DIR", "./snapshots")

settings = Settings()
