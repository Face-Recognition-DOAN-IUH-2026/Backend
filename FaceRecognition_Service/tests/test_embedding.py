from __future__ import annotations

import pytest

from core.embedding import FaceEmbedding, l2_normalize


def test_l2_normalize_zero_vector():
    vec = [0.0, 0.0, 0.0]
    result = l2_normalize(vec)
    assert all(v == 0.0 for v in result)
    assert len(result) == 3


def test_l2_normalize_nonzero():
    vec = [3.0, 4.0]
    result = l2_normalize(vec)
    expected = [0.6, 0.8]
    for a, b in zip(result, expected):
        assert abs(a - b) < 1e-12


def test_l2_normalize_unit_length():
    vec = [1.0, 2.0, 3.0, 4.0]
    result = l2_normalize(vec)
    norm_sq = sum(x * x for x in result)
    assert abs(norm_sq - 1.0) < 1e-12


def test_face_embedding_dataclass():
    emb = FaceEmbedding(user_id="u1", vector=[0.1, 0.2])
    assert emb.user_id == "u1"
    assert emb.vector == [0.1, 0.2]


def test_face_embedding_immutable():
    emb = FaceEmbedding(user_id="u1", vector=[0.1, 0.2])
    with pytest.raises(AttributeError):
        emb.user_id = "u2"
