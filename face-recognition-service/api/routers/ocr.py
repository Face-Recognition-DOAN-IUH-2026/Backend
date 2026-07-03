from __future__ import annotations

import asyncio
import base64
import io

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.dependencies import get_current_user

router = APIRouter(prefix="/face", tags=["ocr"])


class OcrProcessRequest(BaseModel):
    """Request body for server-side OCR processing."""
    image: str = Field(..., description="Base64-encoded image data (downscaled by frontend)")


class OcrProcessResponse(BaseModel):
    """OCR processing result."""
    raw_text: str
    processing_time_ms: float


@router.post("/ocr/process-card", response_model=OcrProcessResponse, status_code=status.HTTP_200_OK)
async def process_card(
    request: OcrProcessRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run OCR on a student card image and return raw text.
    
    The image should already be downscaled by the frontend Web Worker.
    This endpoint runs Tesseract OCR server-side to avoid loading
    20+ MB WASM into the browser.
    
    Route: POST /face/ocr/process-card
    Gateway: /api/face/ocr/process-card → face-recognition-service
    """
    import time
    start_time = time.monotonic()

    # Decode base64 image
    try:
        raw = base64.b64decode(request.image)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 image data",
        )

    if len(raw) > 2 * 1024 * 1024:  # 2MB limit for OCR
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image too large for OCR (max 2MB)",
        )

    # Validate image format
    def validate_image_format(data: bytes) -> str:
        if data[:3] == b'\xff\xd8\xff':
            return 'JPEG'
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return 'PNG'
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'WebP'
        raise ValueError("Unsupported image format. Allowed: JPEG, PNG, WebP")

    try:
        validate_image_format(raw)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    # Run OCR using pytesseract in threadpool (CPU-bound)
    try:
        import cv2
        import numpy as np
        import pytesseract
        from PIL import Image

        def _run_ocr(image_bytes: bytes) -> str:
            # Decode with OpenCV
            arr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
            if arr is None:
                raise ValueError("Could not decode image")

            # Convert BGR to RGB for PIL
            arr_rgb = cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)

            # Convert to PIL Image
            pil_image = Image.fromarray(arr_rgb)

            # Convert to grayscale for better OCR
            pil_gray = pil_image.convert('L')

            # Run Tesseract with Vietnamese + English
            text = pytesseract.image_to_string(
                pil_gray,
                lang='vie+eng',
                config='--psm 6',  # Assume uniform block of text
            )

            return text.strip()

        raw_text = await asyncio.get_event_loop().run_in_executor(
            None, _run_ocr, raw
        )

    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OCR dependencies not installed (pytesseract, Pillow)",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OCR processing failed: {exc}",
        )

    processing_time_ms = (time.monotonic() - start_time) * 1000

    return OcrProcessResponse(
        raw_text=raw_text,
        processing_time_ms=round(processing_time_ms, 2),
    )
