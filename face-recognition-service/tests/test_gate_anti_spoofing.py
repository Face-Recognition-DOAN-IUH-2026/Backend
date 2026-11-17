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

        # Aggregate should trigger HARD VETO
        breakdown = {
            "color_score": 0.95,
            "lbp_score": 0.85,
            **bezel_result,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "SCREEN_BEZEL_DETECTED" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_specular_glare_triggers_veto(self, analyzer):
        """Simulate a screen glass specular reflection (bright saturated glare spot)."""
        # 100x100 skin-tone patch
        face_roi = np.full((100, 100, 3), [140, 160, 210], dtype=np.uint8)
        
        # Add a bright concentrated glare spot (40x40 pure white saturated pixels)
        face_roi[20:60, 20:60] = 255

        glare_result = analyzer.analyze_specular_glare(face_roi)
        assert glare_result["has_glare"] is True
        assert glare_result["glare_veto"] is True

        # Aggregate should trigger HARD VETO
        breakdown = {
            "color_score": 0.90,
            "lbp_score": 0.80,
            **glare_result,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "SCREEN_GLASS_GLARE_DETECTED" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_lbp_flat_surface_triggers_veto(self, analyzer):
        """Simulate a completely flat/smooth surface (printed paper with no 3D skin micro-texture)."""
        # Completely uniform gray image
        flat_roi = np.full((120, 120), 128, dtype=np.uint8)

        lbp_result = analyzer.analyze_lbp(flat_roi)
        assert lbp_result["lbp_veto"] is True

        breakdown = {
            "color_score": 0.90,
            **lbp_result,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "TEXTURE_UNNATURALLY_FLAT" in agg["veto_reasons"]
        assert agg["liveness_score"] <= 0.25

    def test_fft_moire_pattern_triggers_veto(self, analyzer):
        """Simulate high-frequency digital screen grid / Moiré artifact."""
        np.random.seed(42)
        face = np.full((128, 128), 160, dtype=np.uint8)
        grid = np.random.normal(0, 35, (128, 128)).astype(np.int16)
        moire_roi = np.clip(face.astype(np.int16) + grid, 0, 255).astype(np.uint8)

        fft_result = analyzer.analyze_fft(moire_roi)
        assert fft_result["fft_veto"] is True

        breakdown = {
            "color_score": 0.90,
            **fft_result,
        }
        agg = analyzer.aggregate(breakdown)
        assert agg["is_live"] is False
        assert "SCREEN_MOIRE_FREQUENCY_DETECTED" in agg["veto_reasons"]
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

    def test_opposite_parallel_edges_still_veto(self, analyzer):
        """2 cạnh song song đối xứng 2 bên mặt (thân máy) vẫn phải veto."""
        full_img = np.zeros((480, 640, 3), dtype=np.uint8)
        face_bbox = [200, 150, 400, 350]
        # 2 đường dọc dài đối xứng trái/phải mặt (nằm trong ROI quanh mặt)
        full_img[60:420, 120:123] = 255
        full_img[60:420, 500:503] = 255

        bezel_result = analyzer.analyze_screen_bezel(full_img, face_bbox)
        assert bezel_result["has_bezel"] is True
        assert bezel_result["bezel_veto"] is True


class TestGateProcessSingleFaceLiveness:
    def test_spoof_blocks_face_before_milvus_and_publishes_spoof_event(self, monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        import worker.tasks as tasks

        monkeypatch.setenv("ENABLE_GATE_LIVENESS", "true")

        published = []
        uploaded = []
        milvus_mock = MagicMock()

        monkeypatch.setattr(
            tasks,
            "liveness_from_face",
            lambda img, face: {
                "is_live": False,
                "liveness_score": 0.15,
                "veto_reasons": ["SCREEN_BEZEL_DETECTED"],
            },
        )
        monkeypatch.setattr(tasks, "_publish_camera_event", lambda ev: published.append(ev))
        monkeypatch.setattr(tasks, "_upload_evidence_frame", lambda raw, key, prefix="": uploaded.append((key, prefix)))
        monkeypatch.setattr(tasks, "_get_milvus", lambda: milvus_mock)

        fake_face = SimpleNamespace(bbox=np.array([10, 10, 110, 110]), kps=None)
        face_data = {"face": fake_face, "embedding": np.ones(512, dtype=np.float32)}
        img = np.zeros((200, 200, 3), dtype=np.uint8)

        res = tasks._process_single_face("entry_gate", img, face_data, raw_bytes=b"jpgbytes")

        assert res is None
        milvus_mock.search.assert_not_called()
        assert len(published) == 1
        assert published[0]["status"] == "spoof"
        assert published[0]["camera_id"] == "entry_gate"
        assert published[0]["veto_reasons"] == ["SCREEN_BEZEL_DETECTED"]
        assert uploaded == [("spoof", "spoof_")]

    def test_process_single_face_uses_unenhanced_img_liveness(self, monkeypatch):
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        import worker.tasks as tasks

        monkeypatch.setenv("ENABLE_GATE_LIVENESS", "true")
        seen_imgs = []

        def fake_liveness(img, face):
            seen_imgs.append(img)
            return {"is_live": True, "liveness_score": 0.92, "veto_reasons": []}

        milvus_mock = MagicMock()
        milvus_mock.search.return_value = []

        monkeypatch.setattr(tasks, "liveness_from_face", fake_liveness)
        monkeypatch.setattr(tasks, "_publish_camera_event", lambda ev: None)
        monkeypatch.setattr(tasks, "_get_milvus", lambda: milvus_mock)

        img_clahe = np.full((120, 120, 3), 200, dtype=np.uint8)
        img_raw = np.full((120, 120, 3), 50, dtype=np.uint8)
        fake_face = SimpleNamespace(bbox=np.array([10, 10, 90, 90]), kps=None)
        face_data = {"face": fake_face, "embedding": np.ones(512, dtype=np.float32)}

        tasks._process_single_face("entry_gate", img_clahe, face_data, img_liveness=img_raw)

        assert len(seen_imgs) == 1
        assert seen_imgs[0] is img_raw

    def test_temporal_liveness_blocks_frozen_2d_frame_when_enabled(self, monkeypatch):
        from worker.anti_spoofing import verify_gate_temporal_liveness

        monkeypatch.setenv("GATE_MIN_FRAMES", "1")
        monkeypatch.setenv("GATE_BLOCK_FROZEN_REPLAY", "true")

        store = {}

        class FakeRedis:
            def get(self, k):
                return store.get(k)

            def setex(self, k, ttl, v):
                store[k] = v

        rc = FakeRedis()
        r1 = verify_gate_temporal_liveness("entry_gate", "u1", [100, 100, 200, 200], None, redis_client=rc)
        assert r1["is_live"] is True
        r2 = verify_gate_temporal_liveness("entry_gate", "u1", [100, 100, 200, 200], None, redis_client=rc)
        assert r2["is_live"] is False
        assert r2["reason"] == "FROZEN_2D_FRAME"
