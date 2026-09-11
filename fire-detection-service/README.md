# 🔥 Fire Detection Service (NVIDIA LocateAnything-3B)

Microservice nhận diện và cảnh báo cháy nổ (phát hiện lửa và khói) theo thời gian thực, sử dụng mô hình Vision-Language Grounding **NVIDIA LocateAnything-3B**.

---

## 1. Tính năng Nổi bật

* **Zero-shot Object Detection**: Định vị trực tiếp ngọn lửa và khói thông qua mô tả tự nhiên (prompting), không cần huấn luyện lại mô hình.
* **Temporal Smoothing (Chống Báo động giả)**: Tích hợp bộ lọc thời gian và theo dõi IoU đa frame, loại bỏ hoàn toàn các trường hợp ánh sáng phản chiếu, đèn xe, hoặc ánh hoàng hôn.
* **Hỗ trợ Multi-source**:
  * Upload ảnh đơn lẻ hoặc ảnh chụp định kỳ từ Camera qua REST API.
  * Ingest luồng frame từ Camera Stream (RTSP).
* **Tích hợp Microservices**: Tự động phát sự kiện cảnh báo `hazard.fire.detected` lên **RabbitMQ** khi xác nhận có đám cháy thực tế để `notification-service` đẩy thông báo Push Mobile và Web SSE.
* **Dual-mode Engine**:
  * **GPU Production Mode**: Tận dụng GPU NVIDIA với CUDA, `bfloat16`/`float16` và AutoProcessor.
  * **Mock/Dev Fallback Mode**: Tự động fallback khi môi trường dev không có GPU để đảm bảo test CI/CD không bị gián đoạn.

---

## 2. Cấu trúc Thư mục

```
fire-detection-service/
├── api/
│   ├── app.py                 # Ứng dụng FastAPI & lifespan
│   └── routers/
│       ├── detect.py          # API nhận diện ảnh & luồng camera
│       └── health.py          # Kiểm tra trạng thái GPU và Model
├── core/
│   ├── config.py              # Cấu hình môi trường (Pydantic Settings)
│   ├── model.py               # Engine NVIDIA LocateAnything-3B
│   ├── parser.py              # Regex parser trích xuất tọa độ & vẽ bounding box
│   ├── temporal.py            # Bộ lọc chống báo động giả theo thời gian
│   └── messaging.py           # RabbitMQ Publisher phát cảnh báo nguy hiểm
├── tests/
│   ├── test_api.py            # Unit test cho FastAPI endpoints
│   ├── test_parser.py         # Unit test parse thẻ <box> & tính IoU
│   └── test_temporal.py       # Unit test cơ chế xác nhận cảnh báo qua nhiều frame
├── demo_fire_detection.py     # Script chạy thử nghiệm nhanh qua Terminal
├── requirements.txt
├── Dockerfile
└── README.md
```

---

## 3. Cài đặt & Khởi chạy

### 3.1. Chạy trực tiếp qua Python (Local)

1. Cài đặt các thư viện phụ thuộc:
   ```bash
   pip install -r requirements.txt
   ```
2. Chạy thử nghiệm nhanh bằng script demo:
   ```bash
   python demo_fire_detection.py
   # Hoặc truyền file ảnh bất kỳ:
   python demo_fire_detection.py --image path/to/fire_sample.jpg --output result.jpg
   ```
3. Chạy server API:
   ```bash
   python main.py
   ```
   * Swagger UI: [http://localhost:8008/docs](http://localhost:8008/docs)
   * Health Check: [http://localhost:8008/health](http://localhost:8008/health)

### 3.2. Chạy qua Docker (Hỗ trợ NVIDIA GPU)

```bash
docker build -t fire-detection-service .
docker run --gpus all -p 8008:8008 fire-detection-service
```

---

## 4. Danh sách REST API Chính

### 4.1. Nhận diện ảnh đơn lẻ (`POST /api/v1/detect/image`)
* **Headers**: `Content-Type: multipart/form-data`
* **Params**:
  * `file`: File ảnh (jpg, png)
  * `prompt` *(optional)*: Mặc định `"Locate all the instances that matches the following description: fire</c>smoke."`
  * `return_annotated` *(optional, bool)*: Có trả về ảnh vẽ bounding box dạng base64 không.
* **Response**:
  ```json
  {
    "success": true,
    "has_fire": true,
    "has_smoke": false,
    "fire_count": 1,
    "smoke_count": 0,
    "boxes": [
      {
        "label": "fire",
        "box": [160, 144, 416, 360],
        "norm_box": [250, 300, 650, 750],
        "width": 256,
        "height": 216,
        "area": 55296
      }
    ],
    "latency_ms": 14.2,
    "annotated_image_base64": "data:image/jpeg;base64,..."
  }
  ```

### 4.2. Gửi Frame liên tục từ Camera (`POST /api/v1/detect/stream/feed-frame`)
* Dành cho client capture định kỳ (1 - 2 FPS) từ Camera IP.
* Khi đám cháy xuất hiện liên tục qua `>= 3 frames`, hệ thống tự động kích hoạt trạng thái `is_confirmed_hazard: true` và phát event qua RabbitMQ.

---

## 5. Chạy Kiểm thử (Unit Tests)

```bash
python -m pytest tests/
```
