from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class FaceEmbedding:
    # Store as list[float] for easy JSON/celery transport.
    # For Milvus, we'll convert to list[float] -> list[list[float]] as needed.
    user_id: str
    vector: list[float]


def l2_normalize(vec: Sequence[float], eps: float = 1e-12) -> list[float]:
    norm = sum(x * x for x in vec) ** 0.5
    if norm < eps:
        return [0.0 for _ in vec]
    return [float(x) / norm for x in vec]

