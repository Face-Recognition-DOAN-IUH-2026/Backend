import time
import logging
from typing import Tuple, List, Dict, Any, Optional
from PIL import Image
import numpy as np

from core.config import settings
from core.parser import parse_fire_boxes

logger = logging.getLogger(__name__)

class LocateAnythingEngine:
    """
    Wrapper quản lý suy luận của mô hình NVIDIA LocateAnything-3B.
    """
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.processor = None
        self.is_loaded = False
        self.device = settings.DEVICE
        self.use_mock = settings.USE_MOCK_MODEL
        self.use_yolo = settings.USE_LOCAL_YOLO
        self.yolo_model = None
        self.remote_url = settings.REMOTE_SERVER_URL
        self.use_remote = settings.USE_REMOTE_SERVER or bool(self.remote_url)

    def load_model(self):
        if self.use_mock:
            logger.warning("[LocateAnythingEngine] Đang khởi động ở chế độ MOCK (USE_MOCK_MODEL=True).")
            self.is_loaded = True
            return

        if self.use_yolo:
            try:
                import os
                from ultralytics import YOLO
                model_path = settings.YOLO_MODEL_PATH
                if not os.path.isabs(model_path):
                    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                    model_path = os.path.join(base_dir, model_path)
                logger.info(f"[LocateAnythingEngine] Đang tải mô hình YOLOv8 Fire & Smoke từ {model_path}...")
                self.yolo_model = YOLO(model_path)
                self.is_loaded = True
                logger.info("[LocateAnythingEngine] Nạp mô hình YOLOv8 thành công!")
                return
            except Exception as e:
                logger.error(f"[LocateAnythingEngine] Không thể tải model YOLOv8: {e}")
                self.yolo_model = None

        if self.use_remote and self.remote_url:
            logger.info(f"[LocateAnythingEngine] Chạy chế độ REMOTE SERVER: {self.remote_url}")
            self.is_loaded = True
            return

        try:
            import torch
            from transformers import AutoModel, AutoTokenizer, AutoProcessor, BitsAndBytesConfig

            if self.device == "cuda" and not torch.cuda.is_available():
                logger.warning("[LocateAnythingEngine] CUDA không khả dụng, chuyển sang CPU.")
                self.device = "cpu"

            logger.info(f"[LocateAnythingEngine] Đang tải mô hình {settings.MODEL_PATH} trên thiết bị {self.device}...")

            self.tokenizer = AutoTokenizer.from_pretrained(
                settings.MODEL_PATH, 
                trust_remote_code=True
            )
            self.processor = AutoProcessor.from_pretrained(
                settings.MODEL_PATH, 
                trust_remote_code=True
            )

            # Tự động dùng 4-bit nếu là GPU < 8GB VRAM
            if self.device == "cuda":
                vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
                if vram_gb < 7.0:
                    logger.info(f"[LocateAnythingEngine] GPU VRAM ({vram_gb:.1f}GB) < 7GB. Kích hoạt Quantization 4-bit (BitsAndBytes)...")
                    bnb_config = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_compute_dtype=torch.float16
                    )
                    self.model = AutoModel.from_pretrained(
                        settings.MODEL_PATH,
                        quantization_config=bnb_config,
                        device_map="auto",
                        trust_remote_code=True
                    ).eval()
                else:
                    dtype = torch.bfloat16 if settings.TORCH_DTYPE == "bfloat16" else torch.float16
                    self.model = AutoModel.from_pretrained(
                        settings.MODEL_PATH,
                        torch_dtype=dtype,
                        trust_remote_code=True
                    ).to(self.device).eval()
            else:
                self.model = AutoModel.from_pretrained(
                    settings.MODEL_PATH,
                    torch_dtype=torch.float32,
                    trust_remote_code=True
                ).to("cpu").eval()

            self.is_loaded = True
            logger.info("[LocateAnythingEngine] Tải mô hình thành công!")
        except Exception as e:
            logger.error(f"[LocateAnythingEngine] Không thể tải model: {e}")
            logger.info("[LocateAnythingEngine] Tự động fallback sang chế độ MOCK để duy trì hoạt động của service.")
            self.use_mock = True
            self.is_loaded = True

    def predict(
        self, 
        image: Image.Image, 
        prompt: Optional[str] = None
    ) -> Tuple[List[Dict[str, Any]], str, float]:
        """
        Dự đoán vị trí lửa và khói trên ảnh.
        Trả về: (danh_sách_boxes, raw_output_text, latency_ms)
        """
        prompt = prompt or settings.DEFAULT_PROMPT
        width, height = image.size
        start_time = time.time()

        # 1. Nếu cấu hình gọi sang Remote Server (Google Colab qua Ngrok)
        if self.use_remote and self.remote_url:
            boxes, raw_text, latency_ms = self._predict_remote(image, prompt, width, height, start_time)
            return boxes, raw_text, latency_ms

        # 2. Nếu dùng mô hình YOLOv8 Fire & Smoke cục bộ
        if self.use_yolo and self.yolo_model is not None:
            return self._predict_yolo(image, width, height, start_time)

        if self.use_mock or self.model is None:
            # Mô phỏng phản hồi mock cho mục đích test hệ thống
            raw_text = self._generate_mock_output(image)
            boxes = parse_fire_boxes(raw_text, width, height)
            latency_ms = round((time.time() - start_time) * 1000, 2)
            return boxes, raw_text, latency_ms

        import torch

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt}
                ]
            }
        ]

        text = self.processor.py_apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        images, videos = self.processor.process_vision_info(messages)
        inputs = self.processor(text=[text], images=images, videos=videos, return_tensors="pt").to(self.device)

        dtype = torch.bfloat16 if (self.device == "cuda" and settings.TORCH_DTYPE == "bfloat16") else torch.float32

        with torch.no_grad():
            output = self.model.generate(
                pixel_values=inputs["pixel_values"].to(dtype),
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
                tokenizer=self.tokenizer,
                max_new_tokens=settings.MAX_NEW_TOKENS,
                generation_mode=settings.GENERATION_MODE
            )

        raw_text = self.tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=False)
        boxes = parse_fire_boxes(raw_text, width, height)
        latency_ms = round((time.time() - start_time) * 1000, 2)

        return boxes, raw_text, latency_ms

    def _predict_remote(
        self, 
        image: Image.Image, 
        prompt: str, 
        width: int, 
        height: int, 
        start_time: float
    ) -> Tuple[List[Dict[str, Any]], str, float]:
        """
        Gửi yêu cầu suy luận tới Remote Server (Google Colab qua Ngrok).
        Hỗ trợ cả chuẩn OpenAI /chat/completions và chuẩn FastAPI /predict.
        """
        import io
        import base64
        import requests

        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=90)
        img_bytes = buf.getvalue()
        b64_str = base64.b64encode(img_bytes).decode("utf-8")
        data_url = f"data:image/jpeg;base64,{b64_str}"

        headers = {
            "ngrok-skip-browser-warning": "true",
            "Content-Type": "application/json"
        }

        base_url = self.remote_url.rstrip("/")
        # URL có thể là https://xxx.ngrok-free.dev hoặc https://xxx.ngrok-free.dev/v1
        endpoint = f"{base_url}/chat/completions" if base_url.endswith("/v1") else f"{base_url}/v1/chat/completions"

        payload = {
            "model": "nvidia/LocateAnything-3B",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {"type": "text", "text": prompt}
                    ]
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.0
        }

        try:
            resp = requests.post(endpoint, json=payload, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                raw_text = data["choices"][0]["message"]["content"]
            else:
                # Thử endpoint dự phòng /predict của FastAPI
                alt_endpoint = f"{base_url}/predict"
                resp_alt = requests.post(alt_endpoint, json={"image_base64": b64_str, "prompt": prompt}, headers=headers, timeout=30)
                if resp_alt.status_code == 200:
                    raw_text = resp_alt.json().get("raw_response", "")
                else:
                    raise RuntimeError(f"Remote server error: HTTP {resp.status_code} - {resp.text[:200]}")
        except Exception as e:
            logger.error(f"[LocateAnythingEngine] Lỗi gọi Remote Server ({e}). Fallback sang YOLO hoặc mock.")
            if self.yolo_model is not None:
                return self._predict_yolo(image, width, height, start_time)
            raw_text = self._generate_mock_output(image)

        boxes = parse_fire_boxes(raw_text, width, height)
        latency_ms = round((time.time() - start_time) * 1000, 2)
        return boxes, raw_text, latency_ms

    def _predict_yolo(
        self,
        image: Image.Image,
        width: int,
        height: int,
        start_time: float
    ) -> Tuple[List[Dict[str, Any]], str, float]:
        """
        Dự đoán vị trí lửa và khói bằng mô hình YOLOv8 Fire & Smoke cục bộ.
        """
        results = self.yolo_model(image, conf=settings.YOLO_CONF_THRESHOLD, verbose=False)
        boxes = []
        raw_tokens = []

        for r in results:
            for b in r.boxes:
                cls_id = int(b.cls[0])
                label_name = self.yolo_model.names.get(cls_id, "fire")
                label = "smoke" if "smoke" in label_name.lower() else "fire"
                conf = float(b.conf[0])

                coords = b.xyxy[0].tolist()
                px1 = max(0, min(width, int(coords[0])))
                py1 = max(0, min(height, int(coords[1])))
                px2 = max(0, min(width, int(coords[2])))
                py2 = max(0, min(height, int(coords[3])))

                if px2 <= px1 or py2 <= py1:
                    continue

                nx1 = max(0, min(1000, int(px1 / width * 1000)))
                ny1 = max(0, min(1000, int(py1 / height * 1000)))
                nx2 = max(0, min(1000, int(px2 / width * 1000)))
                ny2 = max(0, min(1000, int(py2 / height * 1000)))

                raw_tokens.append(f"{label} <box><{nx1}><{ny1}><{nx2}><{ny2}></box>")
                boxes.append({
                    "label": label,
                    "confidence": round(conf, 2),
                    "box": [px1, py1, px2, py2],
                    "norm_box": [nx1, ny1, nx2, ny2],
                    "width": px2 - px1,
                    "height": py2 - py1,
                    "area": (px2 - px1) * (py2 - py1)
                })

        raw_text = " ".join(raw_tokens) if raw_tokens else "No instances found matching description."
        latency_ms = round((time.time() - start_time) * 1000, 2)
        return boxes, raw_text, latency_ms

    def _generate_mock_output(self, image: Image.Image) -> str:
        """
        Tạo dữ liệu giả lập cho mục đích unit test / smoke test khi không có GPU.
        Phát hiện màu sắc cơ bản (nếu ảnh có vùng đỏ/cam đậm thì giả lập trả về box lửa).
        """
        img_np = np.array(image)
        if len(img_np.shape) == 3:
            r = img_np[:, :, 0].astype(int)
            g = img_np[:, :, 1].astype(int)
            b = img_np[:, :, 2].astype(int)
            # Điểm ảnh màu đỏ/cam nổi bật
            fire_pixels = (r > 180) & (g < 140) & (b < 100)
            if np.sum(fire_pixels) > 500:
                return "fire <box><250><300><650><750></box> smoke <box><150><100><400><320></box>"
        return "No instances found matching description."


engine = LocateAnythingEngine()
