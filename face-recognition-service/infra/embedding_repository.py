from __future__ import annotations

from typing import Literal

from core.embedding import l2_normalize
from core.repositories import EmbeddingRepository, EmbeddingSearchResult
from infra.milvus_client import MilvusClient


class MilvusEmbeddingRepository(EmbeddingRepository):
    def __init__(self, milvus: MilvusClient) -> None:
        self.milvus = milvus

    async def upsert_embedding(self, user_id: str, embedding: list[float]) -> None:
        vec = l2_normalize(embedding)
        self.milvus.upsert_embeddings(user_id=user_id, embedding=vec)

    async def search_1n(
        self,
        embedding: list[float],
        top_k: int = 1,
        metric: Literal["cosine", "euclidean"] = "cosine",
    ) -> list[EmbeddingSearchResult]:
        vec = l2_normalize(embedding)
        hits = self.milvus.search(embedding=vec, top_k=top_k)
        return [EmbeddingSearchResult(user_id=h["user_id"], score=h["score"]) for h in hits]

    async def delete_user_embeddings(self, user_id: str) -> None:
        self.milvus.delete_by_user_id(user_id=user_id)
