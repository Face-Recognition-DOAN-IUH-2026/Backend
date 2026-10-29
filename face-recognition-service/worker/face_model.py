from __future__ import annotations

import cv2
import numpy as np

from worker.anti_spoofing import AntiSpoofingAnalyzer

_model = None


class FaceModel:
    def __init__(self):
        import insightface
        from insightface.app import FaceAnalysis
        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(640, 640))
        self._spoof_model = None
        self._spoof_available = False
        try:
            from insightface.model_zoo import get_model
            self._spoof_model = get_model("antispoofing_normal", providers=["CPUExecutionProvider"])
            self._spoof_model.prepare(ctx_id=0)
            self._spoof_available = True
        except Exception:
            self._spoof_available = False
        self._cv_analyzer = AntiSpoofingAnalyzer()

    @staticmethod
    def enhance_illumination(img: cv2.Mat) -> cv2.Mat:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        cl = clahe.apply(l)
        return cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)

    def extract_embedding(self, img: cv2.Mat) -> list[float]:
        faces = self.app.get(img)
        if len(faces) == 0:
            return [0.0] * 512
        norm = np.linalg.norm(faces[0].embedding)
        if norm == 0:
            return [0.0] * 512
        return (faces[0].embedding / norm).tolist()

    def detect_all_faces(self, img: cv2.Mat, min_face_size: int = 80) -> list[dict]:
        faces = self.app.get(img)
        if not faces:
            return []
        results = []
        for face in faces:
            bbox = face.bbox.astype(np.int32)
            fw = bbox[2] - bbox[0]
            fh = bbox[3] - bbox[1]
            if fw < min_face_size or fh < min_face_size:
                continue
            norm = np.linalg.norm(face.embedding)
            embedding = (face.embedding / norm).tolist() if norm > 0 else [0.0] * 512
            results.append({
                "embedding": embedding,
                "face": face,
                "det_score": float(face.det_score),
                "bbox": bbox,
            })
        return results

    def estimate_blur(self, img: cv2.Mat, threshold: float = 40.0) -> dict:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        is_blurry = lap_var < threshold
        return {"is_blurry": is_blurry, "laplacian_variance": lap_var, "threshold": threshold}

    def get_face_quality(self, img: cv2.Mat, angle: str = "frontal") -> dict:
        if angle != "right" and angle != "left" and angle != "down":
            blur = self.estimate_blur(img)
            if blur["is_blurry"]:
                return {"valid": False, "error": "MOTION_BLUR", "score": blur["laplacian_variance"]}
        faces = self.app.get(img)
        if len(faces) == 0:
            return {"valid": False, "error": "NO_FACE_DETECTED", "score": 0.0}
        if len(faces) > 1:
            return {"valid": False, "error": "MULTIPLE_FACES", "count": len(faces), "score": 0.0}
        face = faces[0]
        det_score = float(face.det_score)
        if det_score < 0.5:
            return {"valid": False, "error": "LOW_QUALITY", "score": det_score}
        return {"valid": True, "score": det_score}

    def detect_face_once(self, img: cv2.Mat) -> dict:
        faces = self.app.get(img)
        if len(faces) == 0:
            return {
                "valid": False, "error": "NO_FACE_DETECTED", "score": 0.0,
                "embedding": [0.0] * 512, "face": None
            }
        if len(faces) > 1:
            return {
                "valid": False, "error": "MULTIPLE_FACES", "count": len(faces), "score": 0.0,
                "embedding": [0.0] * 512, "face": None
            }
        face = faces[0]
        det_score = float(face.det_score)
        if det_score < 0.5:
            return {
                "valid": False, "error": "LOW_QUALITY", "score": det_score,
                "embedding": [0.0] * 512, "face": face
            }
        norm = np.linalg.norm(face.embedding)
        embedding = (face.embedding / norm).tolist() if norm > 0 else [0.0] * 512
        return {
            "valid": True, "score": det_score,
            "embedding": embedding, "face": face
        }

    def liveness_score(self, img: cv2.Mat) -> float:
        result = self.detailed_liveness_check(img)
        return result["liveness_score"]

    def detailed_liveness_check(self, img: cv2.Mat) -> dict:
        faces = self.app.get(img)
        if len(faces) == 0:
            return {"liveness_score": 0.0, "is_live": False, "breakdown": {}, "error": "NO_FACE_DETECTED"}
        return self.liveness_from_face(img, faces[0])

    def liveness_from_face(self, img: cv2.Mat, face) -> dict:
        insightface_score = None
        if self._spoof_available and self._spoof_model is not None:
            try:
                spoof_score = self._spoof_model.predict(img, face)
                if isinstance(spoof_score, (list, tuple, np.ndarray)):
                    spoof_score = float(spoof_score[0]) if len(spoof_score) > 0 else 0.0
                else:
                    spoof_score = float(spoof_score)
                insightface_score = 1.0 - min(max(spoof_score, 0.0), 1.0)
            except Exception:
                pass
        # Note: Do NOT fallback to face.det_score as a liveness score!
        # det_score is merely detection confidence (>0.95 even for high-res photos on a phone).
        # When no specialized anti-spoofing model is loaded, insightface_score remains None.
        h, w = img.shape[:2]
        bbox = face.bbox.astype(np.int32)
        x1, y1, x2, y2 = max(0, bbox[0]), max(0, bbox[1]), min(w, bbox[2]), min(h, bbox[3])
        face_roi = img[y1:y2, x1:x2]
        if face_roi.size == 0:
            cv_result = {}
        else:
            cv_result = {}
            cv_result.update(self._cv_analyzer.analyze_lbp(face_roi))
            cv_result.update(self._cv_analyzer.analyze_color_histogram(face_roi))
            cv_result.update(self._cv_analyzer.analyze_noise(face_roi))
            cv_result.update(self._cv_analyzer.analyze_fft(face_roi))
            cv_result.update(self._cv_analyzer.analyze_multi_scale(face_roi))
            cv_result.update(self._cv_analyzer.analyze_bounding_box(face.bbox, w, h))
            cv_result.update(self._cv_analyzer.analyze_screen_bezel(img, face.bbox))
            cv_result.update(self._cv_analyzer.analyze_specular_glare(face_roi))
        return self._cv_analyzer.aggregate(cv_result, insightface_score=insightface_score)


def get_model() -> FaceModel:
    global _model
    if _model is None:
        _model = FaceModel()
    return _model


def extract_embedding(img: cv2.Mat) -> list[float]:
    return get_model().extract_embedding(img)


def check_liveness(img: cv2.Mat) -> dict:
    return get_model().detailed_liveness_check(img)


def check_face_quality(img: cv2.Mat, angle: str = "frontal") -> dict:
    return get_model().get_face_quality(img, angle)


def detect_face_once(img: cv2.Mat) -> dict:
    return get_model().detect_face_once(img)


def liveness_from_face(img: cv2.Mat, face) -> dict:
    return get_model().liveness_from_face(img, face)


def enhance_illumination(img: cv2.Mat) -> cv2.Mat:
    return FaceModel.enhance_illumination(img)


def detect_all_faces(img: cv2.Mat, min_face_size: int = 80) -> list[dict]:
    return get_model().detect_all_faces(img, min_face_size=min_face_size)


def estimate_blur(img: cv2.Mat, threshold: float = 100.0) -> dict:
    return get_model().estimate_blur(img, threshold)


def check_motion_blur(img: cv2.Mat, threshold: float = 50.0) -> bool:
    return get_model().estimate_blur(img, threshold)["is_blurry"]