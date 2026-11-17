"""
Unit tests for Camera Entry/Exit Anti-Spoofing and Hard-Veto System
Verifies:
1. Screen bezel / paper border detection (Canny + HoughLinesP)
2. Specular glare detection (glass reflections from mobile phone screens)
3. LBP flat surface veto (paper print / smooth digital display)
4. FFT Moiré high-frequency screen pattern veto
5. Aggregator Hard Veto overrides high scores from detection / color
"""

import numpy as np
import pytest
from worker.anti_spoofing import AntiSpoofingAnalyzer


class TestGateAntiSpoofing:
    @pytest.fixture
    def analyzer(self):
        return AntiSpoofingAnalyzer()

    def test_screen_bezel_detection_triggers_veto(self, analyzer):
        """Simulate a phone border around a face bbox."""
        # Full frame 640x480 black background
        full_img = np.zeros((480, 640, 3), dtype=np.uint8)
        
        # Face bbox at center [200, 150, 400, 350]
        face_bbox = [200, 150, 400, 350]
        
        # Draw a bright sharp rectangular frame around the face (like a phone chassis/screen border)
        x1, y1, x2, y2 = 160, 110, 440, 390
        # Draw vertical lines
        full_img[y1:y2, x1:x1+3] = 255
        full_img[y1:y2, x2-3:x2] = 255
        # Draw horizontal lines
        full_img[y1:y1+3, x1:x2] = 255
        full_img[y2-3:y2, x1:x2] = 255

        bezel_result = analyzer.analyze_screen_bezel(full_img, face_bbox)
        assert bezel_result["has_bezel"] is True
        assert bezel_result["bezel_veto"] is True

        # Single bezel + second spoof signal (glare) triggers HARD VETO
        breakdown = {
            "color_score": 0.95,
            "lbp_score": 0.85,
            **bezel_result,
            "glare_veto": True,
            "has_glare": True,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "SCREEN_BEZEL_DETECTED" in agg["veto_reasons"]
        assert "SCREEN_GLASS_GLARE_DETECTED" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_single_glare_alone_does_not_false_veto_real_face(self, analyzer):
        """A single noisy signal (glasses glare in fluorescent room) with strong texture should still pass."""
        face_roi = np.full((100, 100, 3), [140, 160, 210], dtype=np.uint8)
        face_roi[20:60, 20:60] = 255

        glare_result = analyzer.analyze_specular_glare(face_roi)
        assert glare_result["has_glare"] is True
        assert glare_result["glare_veto"] is True

        breakdown = {
            "color_score": 0.90,
            "lbp_score": 0.80,
            **glare_result,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is True
        assert "SCREEN_GLASS_GLARE_DETECTED" in agg["veto_reasons"]

    def test_combined_lbp_flat_and_moire_triggers_hard_veto(self, analyzer):
        """Combined flat texture (LBP veto) + Moire/bezel triggers HARD VETO."""
        flat_roi = np.full((120, 120), 128, dtype=np.uint8)

        lbp_result = analyzer.analyze_lbp(flat_roi)
        assert lbp_result["lbp_veto"] is True

        breakdown = {
            "color_score": 0.90,
            **lbp_result,
            "fft_veto": True,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "TEXTURE_UNNATURALLY_FLAT" in agg["veto_reasons"]
        assert "SCREEN_MOIRE_FREQUENCY_DETECTED" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_fft_moire_pattern_combined_with_bezel_triggers_veto(self, analyzer):
        """Simulate high-frequency digital screen grid / Moire artifact + screen bezel."""
        np.random.seed(42)
        face = np.full((128, 128), 160, dtype=np.uint8)
        grid = np.random.normal(0, 35, (128, 128)).astype(np.int16)
        moire_roi = np.clip(face.astype(np.int16) + grid, 0, 255).astype(np.uint8)

        fft_result = analyzer.analyze_fft(moire_roi)
        assert fft_result["fft_veto"] is True

        breakdown = {
            "color_score": 0.90,
            **fft_result,
            "has_bezel": True,
            "bezel_veto": True,
            "long_lines": 4,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "SCREEN_MOIRE_FREQUENCY_DETECTED" in agg["veto_reasons"]
        assert "SCREEN_BEZEL_DETECTED" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_genuine_face_passes_without_vetoes(self, analyzer):
        """Simulate a natural skin region with natural gradient, 3D facial lighting and optical sensor response."""
        np.random.seed(42)
        import cv2
        face = np.full((120, 120), 160, dtype=np.uint8)
        grad = np.tile(np.linspace(10, 40, 120), (120, 1)).astype(np.uint8)
        face = np.clip(face.astype(int) + grad, 0, 255).astype(np.uint8)
        # Optical sensor PSF / skin micro-texture
        noise = np.random.normal(0, 6, (120, 120))
        noise = cv2.GaussianBlur(noise, (5, 5), 1.2).astype(np.int16)
        natural_roi = np.clip(face.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        lbp_res = analyzer.analyze_lbp(natural_roi)
        fft_res = analyzer.analyze_fft(natural_roi)

        # Neither should trigger a hard veto
        assert lbp_res["lbp_veto"] is False
        assert fft_res["fft_veto"] is False

    def test_single_straight_line_is_not_bezel(self, analyzer):
        """Hồi quy LIB-254: khung cửa/kệ/gạch (1 đường thẳng dài đơn lẻ) quanh
        mặt thật KHÔNG được coi là viền màn hình."""
        full_img = np.zeros((480, 640, 3), dtype=np.uint8)
        face_bbox = [200, 150, 400, 350]
        # Một đường dọc dài duy nhất bên trái mặt (như khung cửa)
        full_img[60:420, 100:103] = 255

        bezel_result = analyzer.analyze_screen_bezel(full_img, face_bbox)
        assert bezel_result["has_bezel"] is False
        assert bezel_result["bezel_veto"] is False

    def test_opposite_lines_without_corner_do_not_false_veto(self, analyzer):
        """2 đường dọc song song không tạo khung góc (vd khung cửa/kệ 2 bên) KHÔNG được false-veto."""
        full_img = np.zeros((480, 640, 3), dtype=np.uint8)
        face_bbox = [200, 150, 400, 350]
        full_img[60:420, 120:123] = 255
        full_img[60:420, 500:503] = 255

        bezel_result = analyzer.analyze_screen_bezel(full_img, face_bbox)
        assert bezel_result["has_bezel"] is False
        assert bezel_result["bezel_veto"] is False


class TestGateProcessSingleFaceLiveness:
    def test_gate_bypasses_passive_liveness_and_proceeds_directly_to_milvus(self, monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from worker.anti_spoofing import is_gate_liveness_enabled
        import worker.tasks as tasks

        assert is_gate_liveness_enabled() is False

        published = []
        milvus_mock = MagicMock()
        milvus_mock.search.return_value = []

        liveness_called = []
        monkeypatch.setattr(tasks, "liveness_from_face", lambda img, face: liveness_called.append(True) or {"is_live": False})
        monkeypatch.setattr(tasks, "_publish_camera_event", lambda ev: published.append(ev))
        monkeypatch.setattr(tasks, "_get_milvus", lambda: milvus_mock)

        fake_face = SimpleNamespace(bbox=np.array([10, 10, 110, 110]), kps=None)
        face_data = {"face": fake_face, "embedding": np.ones(512, dtype=np.float32)}
        img = np.zeros((200, 200, 3), dtype=np.uint8)

        res = tasks._process_single_face("entry_gate", img, face_data, raw_bytes=b"jpgbytes")

        assert res is None
        assert liveness_called == []
        milvus_mock.search.assert_called_once()
        assert len(published) == 1
        assert published[0]["status"] == "unknown"
        assert published[0]["camera_id"] == "entry_gate"

    def test_gate_ignores_enable_gate_liveness_env_and_never_emits_spoof(self, monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        import worker.tasks as tasks

        monkeypatch.setenv("ENABLE_GATE_LIVENESS", "true")
        published = []
        milvus_mock = MagicMock()
        milvus_mock.search.return_value = [{"user_id": "patron-1", "score": 0.91}]

        monkeypatch.setattr(tasks, "_publish_camera_event", lambda ev: published.append(ev))
        monkeypatch.setattr(tasks, "_get_milvus", lambda: milvus_mock)
        monkeypatch.setattr(tasks, "_get_user_via_api", lambda pid: {
            "id": pid,
            "full_name": "Nguyen Van A",
            "student_code": "20012345",
            "status": "active",
        })
        monkeypatch.setattr(tasks, "_get_access_status", lambda pid: {"current_status": "outside"})
        monkeypatch.setattr(tasks, "_check_redis_cooldown", lambda pid, at: False)
        monkeypatch.setattr(tasks, "_upload_evidence_frame", lambda raw, log_id, prefix="": None)

        fake_face = SimpleNamespace(bbox=np.array([10, 10, 90, 90]), kps=None)
        face_data = {"face": fake_face, "embedding": np.ones(512, dtype=np.float32)}
        img = np.full((120, 120, 3), 128, dtype=np.uint8)

        event = tasks._process_single_face("entry_gate", img, face_data, raw_bytes=b"jpgbytes")

        milvus_mock.search.assert_called_once()
        assert event is not None
        assert event["status"] == "granted"
        assert event["is_live"] is True
        assert event["liveness_score"] == 1.0
        assert all(ev.get("status") != "spoof" for ev in published)
