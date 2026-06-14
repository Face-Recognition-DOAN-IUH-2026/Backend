from __future__ import annotations

import math

import cv2
import numpy as np


def _local_binary_pattern(gray: np.ndarray, radius: int = 1, n_points: int = 8) -> np.ndarray:
    h, w = gray.shape
    lbp = np.zeros_like(gray, dtype=np.uint16)
    for i in range(n_points):
        angle = 2.0 * math.pi * i / n_points
        x = radius * math.cos(angle)
        y = -radius * math.sin(angle)
        x1, y1 = int(math.floor(x)), int(math.floor(y))
        x2, y2 = int(math.ceil(x)), int(math.ceil(y))
        wx, wy = x - x1, y - y1
        shifted = np.roll(gray, (-y1, x1), axis=(0, 1)).astype(np.float32)
        shifted2 = np.roll(gray, (-y2, x2), axis=(0, 1)).astype(np.float32)
        shifted3 = np.roll(gray, (-y1, x2), axis=(0, 1)).astype(np.float32)
        shifted4 = np.roll(gray, (-y2, x1), axis=(0, 1)).astype(np.float32)
        interp = (1 - wy) * ((1 - wx) * shifted + wx * shifted2) + wy * ((1 - wx) * shifted3 + wx * shifted4)
        lbp |= ((interp >= gray.astype(np.float32)).astype(np.uint16)) << i
    return lbp


def _uniform_patterns(n_points: int = 8) -> dict:
    mapping = {}
    for i in range(1 << n_points):
        bits = (i >> 1) | ((i & 1) << (n_points - 1))
        xor = i ^ bits
        n_transitions = 0
        for j in range(n_points):
            if (xor >> j) & 1:
                n_transitions += 1
        mapping[i] = n_transitions // 2
    return mapping


_UNIFORM_MAP = _uniform_patterns(8)


class AntiSpoofingAnalyzer:
    def analyze_lbp(self, face_roi: np.ndarray) -> dict:
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        lbp = _local_binary_pattern(gray, radius=1, n_points=8)
        # Map to uniform patterns (0-58 uniform, 59 non-uniform)
        h, w = lbp.shape
        mapped = np.zeros_like(lbp, dtype=np.uint8)
        for val, n_trans in _UNIFORM_MAP.items():
            mask = lbp == val
            if n_trans <= 2:
                mapped[mask] = val
            else:
                mapped[mask] = 59
        hist = np.zeros(60, dtype=np.float32)
        for v in range(60):
            hist[v] = np.count_nonzero(mapped == v)
        hist /= hist.sum() + 1e-7
        entropy = -np.sum(hist * np.log(hist + 1e-7))
        variance = float(np.var(hist))
        max_bin = float(hist.max())
        # Real faces: higher entropy (>3.5), lower max-bin concentration
        # Spoofed: lower entropy, higher peak concentration
        entropy_score = min(1.0, entropy / 5.0)
        peak_penalty = max(0.0, 1.0 - max_bin * 3.0)
        lbp_score = 0.6 * entropy_score + 0.4 * peak_penalty
        lbp_score = max(0.0, min(1.0, lbp_score))
        return {
            "lbp_score": float(lbp_score),
            "lbp_entropy": float(entropy),
            "lbp_variance": variance,
        }

    def analyze_color_histogram(self, face_roi: np.ndarray) -> dict:
        scores = []
        for i in range(3):
            hist = cv2.calcHist([face_roi], [i], None, [256], [0, 256])
            hist = cv2.normalize(hist, hist, norm_type=cv2.NORM_L1).flatten()
            scores.append(float(np.var(hist)))
        hsv = cv2.cvtColor(face_roi, cv2.COLOR_BGR2HSV)
        h_hist = cv2.calcHist([hsv], [0], None, [180], [0, 180])
        h_hist = cv2.normalize(h_hist, h_hist, norm_type=cv2.NORM_L1).flatten()
        skin_consistency = float(np.sum(h_hist[5:25]))  # typical skin hue range
        mean_spread = float(np.mean(scores))
        # Real skin: moderate spread, good skin hue concentration
        # Max variance of 256-bin L1-normalized histogram = ~0.00389 → multiplier 256 normalizes to [0,1]
        spread_score = min(1.0, mean_spread * 256.0)
        skin_score = min(1.0, skin_consistency * 2.0)
        color_score = 0.5 * spread_score + 0.5 * skin_score
        color_score = max(0.0, min(1.0, color_score))
        return {"color_score": color_score}

    def analyze_noise(self, face_roi: np.ndarray) -> dict:
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        noise_var = float(np.var(laplacian))
        # Real faces: moderate noise variance (~50-300)
        # Printed: very high (dot pattern) or very low (smoothing)
        if noise_var < 30:
            noise_score = max(0.0, noise_var / 30.0)
        elif noise_var > 500:
            noise_score = max(0.0, 1.0 - (noise_var - 500) / 1500.0)
        else:
            noise_score = 1.0
        return {"noise_score": noise_score, "noise_variance": noise_var}

    def analyze_fft(self, face_roi: np.ndarray) -> dict:
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        f = np.fft.fft2(gray)
        fshift = np.fft.fftshift(f)
        magnitude = np.abs(fshift)
        magnitude_log = np.log(magnitude + 1)
        h, w = gray.shape
        center_h, center_w = h // 2, w // 2
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt((X - center_w) ** 2 + (Y - center_h) ** 2)
        low_r = min(h, w) // 8
        mid_r = min(h, w) // 3
        low_mask = dist <= low_r
        mid_mask = (dist > low_r) & (dist <= mid_r)
        high_mask = dist > mid_r
        low_energy = float(np.mean(magnitude_log[low_mask]))
        mid_energy = float(np.mean(magnitude_log[mid_mask]))
        high_energy = float(np.mean(magnitude_log[high_mask]))
        high_low_ratio = high_energy / (low_energy + 1e-7)
        mid_low_ratio = mid_energy / (low_energy + 1e-7)
        # Screen/print: abnormally high high-frequency energy
        if high_low_ratio > 2.0:
            fft_score = max(0.0, 1.0 - (high_low_ratio - 2.0) / 5.0)
        else:
            fft_score = 1.0
        fft_score = max(0.0, min(1.0, fft_score))
        return {
            "fft_score": fft_score,
            "fft_high_low_ratio": float(high_low_ratio),
            "fft_mid_low_ratio": float(mid_low_ratio),
        }

    def analyze_multi_scale(self, face_roi: np.ndarray) -> dict:
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        scales = [1.0, 0.5, 0.25]
        blur_scores = []
        for scale in scales:
            if scale < 1.0:
                h_s, w_s = gray.shape
                scaled = cv2.resize(gray, (int(w_s * scale), int(h_s * scale)), interpolation=cv2.INTER_AREA)
            else:
                scaled = gray
            lap_var = float(cv2.Laplacian(scaled, cv2.CV_64F).var())
            blur_scores.append(lap_var)
        mean_blur = float(np.mean(blur_scores)) if blur_scores else 1.0
        std_blur = float(np.std(blur_scores)) if blur_scores else 0.0
        consistency = std_blur / (mean_blur + 1e-7)
        # Real faces: consistent degradation across scales
        multi_score = max(0.0, 1.0 - consistency * 2.0)
        multi_score = min(1.0, multi_score)
        return {
            "multi_scale_score": multi_score,
            "blur_scores": blur_scores,
            "blur_consistency": float(consistency),
        }

    def analyze_bounding_box(self, face_bbox: np.ndarray, img_width: int, img_height: int) -> dict:
        x1, y1, x2, y2 = face_bbox[0], face_bbox[1], face_bbox[2], face_bbox[3]
        fw = x2 - x1
        fh = y2 - y1
        if fw <= 0 or fh <= 0:
            return {"bbox_score": 0.0, "aspect_ratio": 0.0, "face_size_ratio": 0.0}
        aspect_ratio = fw / fh
        face_area = fw * fh
        image_area = img_width * img_height
        face_size_ratio = face_area / image_area if image_area > 0 else 0
        # Real webcam face: aspect ~0.7-0.9, face covers 5-25% of image
        aspect_ok = 0.65 <= aspect_ratio <= 1.0
        size_ok = 0.03 <= face_size_ratio <= 0.40
        if aspect_ok and size_ok:
            bbox_score = 1.0
        elif not aspect_ok and not size_ok:
            bbox_score = 0.2
        elif not aspect_ok or not size_ok:
            bbox_score = 0.5
        else:
            bbox_score = 0.0
        return {
            "bbox_score": bbox_score,
            "aspect_ratio": float(aspect_ratio),
            "face_size_ratio": float(face_size_ratio),
        }

    def aggregate(self, breakdown: dict, insightface_score: float | None = None) -> dict:
        weights = {
            "lbp": 0.18,
            "color": 0.18,
            "noise": 0.14,
            "fft": 0.14,
            "multi_scale": 0.14,
            "bbox": 0.12,
        }
        total_weight = sum(weights.values())
        if insightface_score is not None:
            weights["insightface"] = 0.10
            total_weight += 0.10
        total_score = 0.0
        raw_breakdown = {}
        for key, weight in weights.items():
            score_key = f"{key}_score"
            if key == "insightface" and insightface_score is not None:
                total_score += insightface_score * weight
                raw_breakdown[key] = insightface_score
            elif score_key in breakdown:
                total_score += breakdown[score_key] * weight
                raw_breakdown[key] = breakdown[score_key]
        if total_weight > 0:
            total_score /= total_weight
        total_score = max(0.0, min(1.0, total_score))
        return {
            "liveness_score": total_score,
            "is_live": total_score > 0.5,
            "breakdown": raw_breakdown,
        }
