"""
Script Demo Thử nghiệm NVIDIA LocateAnything-3B cho bài toán phát hiện Lửa & Khói.
Cách chạy:
    python demo_fire_detection.py [--image path/to/fire.jpg]
"""
import sys
import os
import argparse

# Đảm bảo in tiếng Việt trên console Windows không bị UnicodeEncodeError
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import numpy as np
from PIL import Image, ImageDraw
import cv2

# Thêm thư mục gốc vào sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.model import engine
from core.parser import draw_detection_results, parse_fire_boxes
from core.config import settings


def create_synthetic_fire_image(output_path: str = "sample_test_fire.jpg") -> str:
    """
    Tạo một bức ảnh mẫu giả lập có khu vực cháy và khói để test trực tiếp.
    """
    width, height = 640, 480
    # Nền xám tối (giả lập phòng/hành lang tối)
    img = Image.new("RGB", (width, height), color=(40, 40, 45))
    draw = ImageDraw.Draw(img)

    # Vẽ ngọn lửa màu cam/đỏ ở giữa
    draw.ellipse([(240, 220), (380, 400)], fill=(255, 60, 0))
    draw.polygon([(260, 260), (310, 160), (360, 260)], fill=(255, 140, 0))
    draw.ellipse([(280, 280), (340, 370)], fill=(255, 220, 50))

    # Vẽ vệt khói màu xám phía trên
    draw.ellipse([(220, 80), (400, 200)], fill=(120, 120, 130))

    img.save(output_path)
    print(f"[*] Đã tạo ảnh mẫu thử nghiệm tại: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Demo Fire & Smoke Detection with NVIDIA LocateAnything-3B")
    parser.add_argument("--image", type=str, default=None, help="Đường dẫn file ảnh đầu vào")
    parser.add_argument("--prompt", type=str, default=None, help="Văn bản mô tả đối tượng cần định vị")
    parser.add_argument("--output", type=str, default="demo_detection_result.jpg", help="Đường dẫn lưu ảnh kết quả")
    args = parser.parse_args()

    image_path = args.image
    if not image_path or not os.path.exists(image_path):
        print("[!] Không có file ảnh đầu vào, tự động tạo ảnh mẫu giả lập...")
        image_path = create_synthetic_fire_image()

    print(f"[*] Đang nạp ảnh: {image_path}")
    pil_image = Image.open(image_path).convert("RGB")
    width, height = pil_image.size

    # Khởi động engine
    print("[*] Đang khởi tạo mô hình...")
    engine.load_model()

    prompt = args.prompt or settings.DEFAULT_PROMPT
    print(f"[*] Prompt sử dụng: '{prompt}'")

    print("[*] Đang thực hiện suy luận...")
    boxes, raw_text, latency = engine.predict(pil_image, prompt=prompt)

    print("\n" + "=" * 50)
    print(f" KẾT QUẢ PHÁT HIỆN ({latency} ms)")
    print("=" * 50)
    print(f"Raw Output: {raw_text}")
    print(f"Số đối tượng tìm thấy: {len(boxes)}")
    for i, b in enumerate(boxes, 1):
        print(f"  [{i}] Nhãn: {b['label'].upper()} | Box pixel: {b['box']} | Kích thước: {b['width']}x{b['height']}")

    # Vẽ kết quả lên ảnh
    img_cv = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    annotated = draw_detection_results(img_cv, boxes, is_confirmed=(len(boxes) > 0))
    cv2.imwrite(args.output, annotated)
    print(f"\n[✓] Ảnh kết quả đã được lưu tại: {os.path.abspath(args.output)}")


if __name__ == "__main__":
    main()
