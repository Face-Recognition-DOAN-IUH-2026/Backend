from fastapi import APIRouter
from core.config import settings
from core.model import engine

router = APIRouter(tags=["Health"])


@router.get("/health")
def health_check():
    gpu_info = {"available": False}
    try:
        import torch
        if torch.cuda.is_available():
            gpu_info = {
                "available": True,
                "device_name": torch.cuda.get_device_name(0),
                "allocated_vram_mb": round(torch.cuda.memory_allocated(0) / (1024 * 1024), 2),
                "reserved_vram_mb": round(torch.cuda.memory_reserved(0) / (1024 * 1024), 2)
            }
    except Exception:
        pass

    active_engine = "LocateAnything-3B (Mock)"
    if getattr(engine, "use_yolo", False) and engine.yolo_model is not None:
        active_engine = "YOLOv8-Nano (Local)"
    elif getattr(engine, "use_remote", False):
        active_engine = "LocateAnything-3B (Remote)"
    elif getattr(engine, "model", None) is not None:
        active_engine = "LocateAnything-3B (Local)"

    return {
        "status": "healthy",
        "service": settings.SERVICE_NAME,
        "engine": active_engine,
        "model_loaded": engine.is_loaded,
        "use_yolo": getattr(engine, "use_yolo", False) and engine.yolo_model is not None,
        "use_mock": engine.use_mock,
        "device": engine.device,
        "gpu": gpu_info
    }
