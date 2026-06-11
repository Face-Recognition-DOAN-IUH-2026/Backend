from __future__ import annotations

from typing import Any

from pymilvus import MilvusClient as _MilvusClient


class MilvusClient:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        collection_name: str,
        dim: int,
        metric_type: str = "COSINE",
    ) -> None:
        self.host = host
        self.port = port
        self.collection_name = collection_name
        self.dim = dim
        self.metric_type = metric_type

        self.client = _MilvusClient(uri=f"http://{host}:{port}")
        self._get_or_create_collection()

    def _get_or_create_collection(self) -> None:
        if self.client.has_collection(self.collection_name):
            return
        self.client.create_collection(
            collection_name=self.collection_name,
            dimension=self.dim,
            primary_field_name="user_id",
            id_type="string",
            max_length=128,
            vector_field_name="embedding",
            metric_type=self.metric_type,
        )

    def upsert_embeddings(self, *, user_id: str, embedding: list[float]) -> None:
        self.client.upsert(
            self.collection_name,
            {"user_id": user_id, "embedding": embedding},
        )

    def get_embedding_by_user_id(self, user_id: str) -> list[float] | None:
        results = self.client.query(
            self.collection_name,
            filter=f'user_id == "{user_id}"',
            output_fields=["embedding"],
        )
        if not results:
            return None
        return results[0].get("embedding")

    def search(self, *, embedding: list[float], top_k: int = 1) -> list[dict[str, Any]]:
        results = self.client.search(
            collection_name=self.collection_name,
            data=[embedding],
            anns_field="embedding",
            search_params={"metric_type": self.metric_type, "params": {"nprobe": 16}},
            limit=top_k,
            output_fields=["user_id"],
        )
        if not results:
            return []
        hits = []
        for r in results[0]:
            hits.append({"user_id": r["entity"]["user_id"], "score": float(r["distance"])})
        return hits

    def delete_by_user_id(self, *, user_id: str) -> None:
        self.client.delete(self.collection_name, f'user_id == "{user_id}"')
