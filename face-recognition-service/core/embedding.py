from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass(frozen=True)
class FaceEmbedding:
    user_id: str
    vector: list[float]


def l2_normalize(vec: Sequence[float], eps: float = 1e-12) -> list[float]:
    vec_arr = np.array(vec, dtype=np.float32)
    norm = float(np.linalg.norm(vec_arr))
    if norm < eps:
        return [0.0] * len(vec)
    return (vec_arr / norm).tolist()

