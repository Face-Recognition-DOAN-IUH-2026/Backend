from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

from core.config import settings
from core.model import engine
from core.messaging import hazard_publisher
from api.routers.health import router as health_router
from api.routers.detect import router as detect_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"--- Đang khởi động {settings.SERVICE_NAME} ---")
    # Tải mô hình NVIDIA LocateAnything-3B
    engine.load_model()
    # Kết nối RabbitMQ
    hazard_publisher.connect()
    yield
    logger.info(f"--- Đang dừng {settings.SERVICE_NAME} ---")
    hazard_publisher.close()


app = FastAPI(
    title="NVIDIA LocateAnything Fire & Smoke Detection Service",
    description="Microservice phát hiện lửa và khói sử dụng mô hình Vision-Language Grounding NVIDIA LocateAnything-3B",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(detect_router)


@app.get("/")
def root():
    return {
        "service": settings.SERVICE_NAME,
        "docs": "/docs",
        "health": "/health"
    }
