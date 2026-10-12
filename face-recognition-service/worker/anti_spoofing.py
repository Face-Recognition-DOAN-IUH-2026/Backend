from __future__ import annotations

import math
import os

import cv2
import numpy as np

DEFAULT_LIVENESS_THRESHOLD = 0.5
DEFAULT_ACTIVE_REJECT_BELOW = 0.45
DEFAULT_ACTIVE_LIVE_ABOVE = 0.65
DEFAULT_MOTION_MIN_DISPLACEMENT = 0.15


def _env_float(name: str, default: float) -> float:
    try:
        raw = os.environ.get(name)
        return float(raw) if raw not in (None, "") else default
    except (TypeError, ValueError):
        return default


def get_liveness_threshold() -> float:
    """Passive-liveness decision threshold, read from env at call time."""
    return _env_float("LIVENESS_THRESHOLD", DEFAULT_LIVENESS_THRESHOLD)


def get_active_bands() -> tuple[float, float]:
    """(reject_below, live_above) band edges for the active challenge."""
    return (
        _env_float("ACTIVE_LIVENESS_REJECT_BELOW", DEFAULT_ACTIVE_REJECT_BELOW),
        _env_float("ACTIVE_LIVENESS_LIVE_ABOVE", DEFAULT_ACTIVE_LIVE_ABOVE),
    )


def decide_active_verdict(avg_score: float, has_motion: bool = True) -> str:
    """Band a multi-frame average into live / inconclusive / spoof.

    A texture-passing average without motion proof is inconclusive, never
    live: static replays (printed photo, phone screen held still) must not
    authenticate. Motion never overrides a texture spoof.
    """
    reject_below, live_above = get_active_bands()
    if avg_score > live_above and has_motion:
        return "live"
    if avg_score < reject_below:
        return "spoof"
    return "inconclusive"


def is_active_liveness_enabled(default: bool = True) -> bool:
    """Feature flag for the kiosk active challenge, read at call time."""
    raw = os.environ.get("ENABLE_ACTIVE_LIVENESS")
    if raw is None or raw == "":
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def get_motion_min_displacement() -> float:
    """Minimum normalized face-center displacement proving real motion."""
    return _env_float("CHALLENGE_MOTION_MIN_DISPLACEMENT", DEFAULT_MOTION_MIN_DISPLACEMENT)


def verify_challenge_motion(frames_kps: list) -> dict:
    """Prove real head motion across challenge frames from 5-point kps.

    Each entry is an insightface-style (5, 2) keypoint array
    [left_eye, right_eye, nose, mouth_left, mouth_right] or None when no
    face was detected in that frame.

    Displacement of the face center is normalized by the inter-ocular
    distance, so the check is scale-invariant (near/far camera). A static
    replay (printed photo, phone screen held still) produces near-zero
    displacement and never passes; hand tremor stays far below the default
    0.15 threshold while a real turn/nod exceeds it comfortably.
    """
    valid = [np.asarray(k, dtype=np.float64) for k in frames_kps if k is not None]
    valid = [k for k in valid if k.shape == (5, 2)]
    if len(valid) < 2:
        return {"has_motion": False, "displacement": 0.0, "frames_valid": len(valid)}
    iods = [float(np.linalg.norm(k[0] - k[1])) for k in valid]
    reference = float(np.median(iods))
    if reference <= 0:
        return {"has_motion": False, "displacement": 0.0, "frames_valid": len(valid)}
    centers = [k.mean(axis=0) for k in valid]
    displacement = 0.0
    for i in range(len(centers)):
        for j in range(i + 1, len(centers)):
            displacement = max(displacement, float(np.linalg.norm(centers[i] - centers[j])))
    normalized = displacement / reference
    return {
        "has_motion": bool(normalized >= get_motion_min_displacement()),
        "displacement": float(normalized),
        "frames_valid": len(valid),
    }


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
        gray = face_roi if face_roi.ndim == 2 else cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
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
        # Real faces: higher entropy (>2.0), lower max-bin concentration
        # Spoofed (screens / prints / flat papers): unnaturally low entropy (<1.2) or high peak concentration (>0.65)
        if entropy < 2.5:
            entropy_score = max(0.0, entropy / 2.5)
        else:
            entropy_score = min(1.0, 0.6 + (entropy - 2.5) / 2.5)
        peak_penalty = max(0.0, 1.0 - max_bin * 2.5)
        lbp_score = 0.6 * entropy_score + 0.4 * peak_penalty
        lbp_score = max(0.0, min(1.0, lbp_score))
        lbp_veto = bool(entropy < 1.2 or max_bin > 0.65)
        return {
            "lbp_score": float(lbp_score),
            "lbp_entropy": float(entropy),
            "lbp_variance": variance,
            "lbp_veto": lbp_veto,
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
        gray = face_roi if face_roi.ndim == 2 else cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
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
        # Real faces: ~0.45 - 0.65 (energy drops off naturally with frequency)
        # Screen/print/moire: ratio > 0.75 indicates abnormal high-frequency noise or subpixel grid
        if high_low_ratio > 0.75:
            fft_score = max(0.0, 1.0 - (high_low_ratio - 0.75) * 4.0)
        else:
            fft_score = 1.0
        fft_score = max(0.0, min(1.0, fft_score))
        fft_veto = bool(high_low_ratio > 0.88)
        return {
            "fft_score": float(fft_score),
            "fft_high_low_ratio": float(high_low_ratio),
            "fft_mid_low_ratio": float(mid_low_ratio),
            "fft_veto": fft_veto,
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

    def analyze_screen_bezel(self, full_img: np.ndarray, face_bbox: np.ndarray) -> dict:
        """Detect rectangular screen bezel or photo borders in the context surrounding the face."""
        if full_img is None or face_bbox is None or len(face_bbox) < 4:
            return {"bezel_score": 0.5, "has_bezel": False, "bezel_veto": False}
        h, w = full_img.shape[:2]
        x1, y1, x2, y2 = int(face_bbox[0]), int(face_bbox[1]), int(face_bbox[2]), int(face_bbox[3])
        fw, fh = x2 - x1, y2 - y1
        if fw <= 20 or fh <= 20:
            return {"bezel_score": 0.5, "has_bezel": False, "bezel_veto": False}

        # Expand padding to 55% so phone chassis edges on sides/top/bottom are caught
        pad_x = int(fw * 0.55)
        pad_y = int(fh * 0.55)
        cx1 = max(0, x1 - pad_x)
        cy1 = max(0, y1 - pad_y)
        cx2 = min(w, x2 + pad_x)
        cy2 = min(h, y2 + pad_y)

        context_roi = full_img[cy1:cy2, cx1:cx2]
        if context_roi.size == 0 or context_roi.shape[0] < 30 or context_roi.shape[1] < 30:
            return {"bezel_score": 0.5, "has_bezel": False, "bezel_veto": False}

        gray_ctx = cv2.cvtColor(context_roi, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray_ctx, 40, 120)

        # Mask out face interior so we only check margins for bezel lines
        fx1 = max(0, x1 - cx1)
        fy1 = max(0, y1 - cy1)
        fx2 = min(edges.shape[1], x2 - cx1)
        fy2 = min(edges.shape[0], y2 - cy1)
        edges[fy1:fy2, fx1:fx2] = 0

        # Detect straight line segments in margin (robust across cv2/numpy versions:
        # HoughLinesP may return shape (N,1,4) or (N,4))
        min_dim = min(fw, fh)
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=25, minLineLength=int(min_dim * 0.28), maxLineGap=10)
        vert_lines = []  # (x_center, y1, y2) in context-roi coords
        horiz_lines = []  # (y_center, x1, x2) in context-roi coords
        long_line_count = 0
        if lines is not None:
            import numpy as _np

            for line in _np.asarray(lines).reshape(-1, 4):
                lx1, ly1, lx2, ly2 = (float(v) for v in line)
                dx = abs(lx2 - lx1)
                dy = abs(ly2 - ly1)
                line_len = _np.sqrt(dx * dx + dy * dy)
                if line_len > min_dim * 0.42:
                    long_line_count += 1
                if dy > 1.8 * (dx + 1e-5) and dy > min_dim * 0.28:
                    vert_lines.append(((lx1 + lx2) / 2.0, min(ly1, ly2), max(ly1, ly2)))
                elif dx > 1.8 * (dy + 1e-5) and dx > min_dim * 0.28:
                    horiz_lines.append(((ly1 + ly2) / 2.0, min(lx1, lx2), max(lx1, lx2)))

        # A real screen/phone chassis forms a RECTANGLE around the face, not just
        # stray straight lines (door frames, shelves, tiles, glasses arms).
        # Veto only on rectangle structure, in context-roi coordinates:
        # - corner: a vertical and horizontal line meeting nearby, OR
        # - opposite parallel pair: lines on both sides of the face center.
        tol = min_dim * 0.12
        face_cx = (fx1 + fx2) / 2.0
        face_cy = (fy1 + fy2) / 2.0
        margin = min_dim * 0.15
        has_corner = False
        for vx, vy1, vy2 in vert_lines:
            for hy, hx1, hx2 in horiz_lines:
                if abs(vx - hx1) < tol or abs(vx - hx2) < tol:
                    if abs(hy - vy1) < tol or abs(hy - vy2) < tol:
                        has_corner = True
                        break
            if has_corner:
                break
        left_edges = [vx for vx, _, _ in vert_lines if vx < face_cx - margin]
        right_edges = [vx for vx, _, _ in vert_lines if vx > face_cx + margin]
        top_edges = [hy for hy, _, _ in horiz_lines if hy < face_cy - margin]
        bottom_edges = [hy for hy, _, _ in horiz_lines if hy > face_cy + margin]
        has_opposite_pair = bool(
            (left_edges and right_edges and (top_edges or bottom_edges)) or
            (top_edges and bottom_edges and (left_edges or right_edges))
        )

        has_bezel = bool(has_corner and has_opposite_pair)
        if has_bezel:
            bezel_score = 0.10
        elif vert_lines or horiz_lines or long_line_count >= 1:
            # Stray straight lines (furniture, tiles): suspicious but not a veto
            bezel_score = 0.30
        else:
            bezel_score = 0.5
        return {
            "bezel_score": float(bezel_score),
            "has_bezel": has_bezel,
            "bezel_veto": has_bezel,
            "vert_lines": len(vert_lines),
            "horiz_lines": len(horiz_lines),
            "long_lines": long_line_count,
        }

    def analyze_specular_glare(self, face_roi: np.ndarray) -> dict:
        """Detect harsh specular highlights caused by screen glass reflection."""
        if face_roi is None or face_roi.size == 0:
            return {"glare_score": 0.5, "glare_ratio": 0.0, "has_glare": False, "glare_veto": False}
        hsv = cv2.cvtColor(face_roi, cv2.COLOR_BGR2HSV)
        v = hsv[:, :, 2]
        s = hsv[:, :, 1]
        glare_mask = (v > 240) & (s < 35)
        glare_ratio = float(np.mean(glare_mask))
        if glare_ratio > 0.015:
            glare_score = max(0.0, 1.0 - (glare_ratio - 0.015) * 25.0)
        else:
            glare_score = 0.5
        glare_veto = bool(glare_ratio > 0.035)
        has_glare = bool(glare_ratio > 0.015)
        return {
            "glare_score": float(glare_score),
            "glare_ratio": float(glare_ratio),
            "has_glare": has_glare,
            "glare_veto": glare_veto,
        }

    def aggregate(self, breakdown: dict, insightface_score: float | None = None) -> dict:
        veto_reasons = []
        if (breakdown.get("has_bezel", False) or breakdown.get("bezel_veto", False)) and breakdown.get("long_lines", 0) >= 4:
            veto_reasons.append("SCREEN_BEZEL_DETECTED")
        if breakdown.get("fft_veto", False):
            veto_reasons.append("SCREEN_MOIRE_FREQUENCY_DETECTED")
        if breakdown.get("lbp_veto", False):
            veto_reasons.append("TEXTURE_UNNATURALLY_FLAT")
        if breakdown.get("glare_veto", False):
            veto_reasons.append("SCREEN_GLASS_GLARE_DETECTED")

        # Positive liveness features
        weights = {
            "lbp": 0.28,
            "fft": 0.28,
            "color": 0.22,
            "noise": 0.11,
            "multi_scale": 0.11,
        }
        if insightface_score is not None:
            weights["insightface"] = 0.10

        total_score = 0.0
        raw_breakdown = {}
        active_weights_sum = 0.0
        for key, weight in weights.items():
            score_key = f"{key}_score"
            if key == "insightface" and insightface_score is not None:
                total_score += insightface_score * weight
                raw_breakdown[key] = insightface_score
                active_weights_sum += weight
            elif score_key in breakdown:
                total_score += breakdown[score_key] * weight
                raw_breakdown[key] = breakdown[score_key]
                active_weights_sum += weight

        if active_weights_sum > 0:
            total_score /= active_weights_sum

        # Attack indicator penalties (bezel, glare)
        if breakdown.get("has_bezel", False):
            total_score *= 0.35
            raw_breakdown["bezel_penalty"] = 0.35
        if breakdown.get("has_glare", False):
            total_score *= 0.55
            raw_breakdown["glare_penalty"] = 0.55

        total_score = max(0.0, min(1.0, total_score))

        threshold = get_liveness_threshold()
        # Single heuristic is noisy in room lighting; hard-veto only if >= 2 signals agree
        if len(veto_reasons) >= 2:
            is_live = False
            total_score = min(total_score, 0.20)
        elif len(veto_reasons) == 1:
            total_score *= 0.70
            is_live = total_score > threshold
        else:
            is_live = total_score > threshold

        res = {
            "liveness_score": float(total_score),
            "is_live": is_live,
            "breakdown": raw_breakdown,
        }
        if veto_reasons:
            res["veto_reasons"] = veto_reasons
        return res

