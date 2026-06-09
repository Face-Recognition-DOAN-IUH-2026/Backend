from __future__ import annotations

import cv2
import numpy as np


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

    def extract_embedding(self, img: cv2.Mat) -> list[float]:
        faces = self.app.get(img)
        if len(faces) == 0:
            return [0.0] * 512
        norm = np.linalg.norm(faces[0].embedding)
        if norm == 0:
            return [0.0] * 512
        return (faces[0].embedding / norm).tolist()

    def get_face_quality(self, img: cv2.Mat) -> dict:
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

    def liveness_score(self, img: cv2.Mat) -> float:
        faces = self.app.get(img)
        if len(faces) == 0:
            return 0.0
        face = faces[0]
        
        if self._spoof_available and self._spoof_model is not None:
            try:
                spoof_score = self._spoof_model.predict(img, face)
                if isinstance(spoof_score, (list, tuple, np.ndarray)):
                    spoof_score = float(spoof_score[0]) if len(spoof_score) > 0 else 0.0
                else:
                    spoof_score = float(spoof_score)
                return 1.0 - min(max(spoof_score, 0.0), 1.0)
            except Exception:
                pass
        
        return float(face.det_score)


def get_model() -> FaceModel:
    global _model
    if _model is None:
        _model = FaceModel()
    return _model


def extract_embedding(img: cv2.Mat) -> list[float]:
    return get_model().extract_embedding(img)


def check_liveness(img: cv2.Mat) -> dict:
    score = get_model().liveness_score(img)
    return {"liveness_score": score, "is_live": score > 0.5}


def check_face_quality(img: cv2.Mat) -> dict:
    return get_model().get_face_quality(img)