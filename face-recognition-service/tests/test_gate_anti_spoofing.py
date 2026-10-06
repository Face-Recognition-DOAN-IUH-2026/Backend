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
