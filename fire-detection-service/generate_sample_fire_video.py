"""
Script tạo video mẫu mô phỏng camera giám sát CCTV ghi lại cảnh cháy (ngọn lửa bùng phát và vệt khói).
Định dạng: MP4 (H.264/mp4v), 640x480, 20 FPS, 8 giây.
"""
import os
import cv2
import numpy as np

def generate_fire_cctv_video(output_path: str = "sample_fire_cctv.mp4", duration_sec: int = 6, fps: int = 20):
    width, height = 640, 480
    total_frames = duration_sec * fps
    
    # Dùng fourcc mp4v tương thích cao
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    print(f"[*] Đang tạo video mẫu {duration_sec}s ({total_frames} frames)...")
    
    for i in range(total_frames):
        # 1. Nền phòng tối / nhà kho xám
        frame = np.full((height, width, 3), 35, dtype=np.uint8)
        
        # Thêm lưới sàn nhà kho
        for y in range(250, height, 40):
            cv2.line(frame, (0, y), (width, y), (50, 50, 50), 1)
        
        # Thêm timestamp CCTV giả lập ở góc trên
        ts_text = f"CAM-ZONE-02  2026-09-11 16:45:{i//fps:02d}.{i%fps:02d}"
        cv2.putText(frame, ts_text, (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)
        
        # 2. Sau 1.5 giây (frame > 30), ngọn lửa bắt đầu bùng lên và lan rộng
        if i > 25:
            progress = min(1.0, (i - 25) / 50.0)
            
            # Tọa độ gốc đám cháy
            center_x = 320 + int(np.sin(i * 0.3) * 5)
            center_y = 350
            fire_radius_x = int(30 + progress * 45 + np.random.randint(-4, 5))
            fire_radius_y = int(45 + progress * 60 + np.random.randint(-6, 7))
            
            # Vệt khói bốc lên cao (màu xám nhạt)
            smoke_y = center_y - fire_radius_y - int(progress * 80)
            smoke_w = int(fire_radius_x * 1.5)
            smoke_h = int(60 + progress * 50)
            cv2.ellipse(frame, (center_x, max(60, smoke_y)), (smoke_w, smoke_h), 0, 0, 360, (130, 130, 140), -1)
            
            # Ngọn lửa ngoài (Đỏ cam)
            cv2.ellipse(frame, (center_x, center_y), (fire_radius_x, fire_radius_y), 0, 0, 360, (0, 69, 255), -1)
            
            # Lõi lửa trong (Vàng cam sáng)
            inner_rx = int(fire_radius_x * 0.6)
            inner_ry = int(fire_radius_y * 0.6)
            cv2.ellipse(frame, (center_x, center_y + 10), (inner_rx, inner_ry), 0, 0, 360, (0, 215, 255), -1)
            
            # Chóp lửa nhấp nháy
            tip_y = center_y - fire_radius_y - np.random.randint(10, 30)
            pts = np.array([[center_x - inner_rx, center_y], [center_x + inner_rx, center_y], [center_x, tip_y]], np.int32)
            cv2.fillPoly(frame, [pts], (0, 140, 255))
        
        out.write(frame)
        
    out.release()
    print(f"[✓] Đã tạo thành công video mẫu tại: {os.path.abspath(output_path)}")
    return output_path

if __name__ == "__main__":
    generate_fire_cctv_video()
