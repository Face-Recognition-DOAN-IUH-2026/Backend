from __future__ import annotations

from typing import Any

from pymilvus import CollectionSchema, DataType, FieldSchema, MilvusClient as _MilvusClient


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
        schema = CollectionSchema(
            [
                FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
                FieldSchema(name="user_id", dtype=DataType.VARCHAR, max_length=128),
                FieldSchema(name="angle", dtype=DataType.VARCHAR, max_length=50),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.dim),
            ]
        )
        self.client.create_collection(
            collection_name=self.collection_name,
            schema=schema,
        )
        self.client.create_index(
            collection_name=self.collection_name,
            index_params={
                "field_name": "embedding",
                "metric_type": self.metric_type,
                "index_type": "IVF_FLAT",
                "params": {"nprobe": 16},
            },
        )

    def insert_embedding(self, *, user_id: str, angle: str, embedding: list[float]) -> int:
        data = [{"user_id": user_id, "angle": angle, "embedding": embedding}]
        result = self.client.insert(self.collection_name, data)
        # pymilvus's return type varies by version/config.
        # Sometimes it returns a dict-like object without `primary_keys`.
        if not result:
            return 0
        if hasattr(result, "primary_keys"):
            return result.primary_keys[0] if result.primary_keys else 0
        # Fallback: try common dict keys
        if isinstance(result, dict):
            for key in ("primary_keys", "primary_key", "ids", "id"):
                v = result.get(key)
                if isinstance(v, (list, tuple)) and v:
                    return int(v[0])
                if isinstance(v, (int, str)):
                    return int(v)
        return 0

    def get_embeddings_by_user_id(self, user_id: str) -> list[dict[str, Any]]:
        results = self.client.query(
            self.collection_name,
            filter=f'user_id == "{user_id}"',
            output_fields=["id", "angle", "embedding"],
        )
        return results or []

    # Compatibility helpers (older code expects this name)
    def get_embedding_by_user_id(self, user_id: str) -> list[float] | None:
        """Return one embedding vector for a user.

        Existing code (worker/tasks.py) expects a single embedding vector.
        We pick the first stored angle embedding.
        """
        rows = self.get_embeddings_by_user_id(user_id)
        if not rows:
            return None
        # rows[i]["embedding"] is expected to be a list[float]
        return rows[0].get("embedding")


    def search(self, *, embedding: list[float], top_k: int = 5) -> list[dict[str, Any]]:
        results = self.client.search(
            collection_name=self.collection_name,
            data=[embedding],
            anns_field="embedding",
            search_params={"metric_type": self.metric_type, "params": {"nprobe": 16}},
            limit=top_k,
            output_fields=["user_id", "angle"],
        )
        if not results:
            return []
        hits = []
        for r in results[0]:
            hits.append({
                "user_id": r["entity"]["user_id"],
                "angle": r["entity"].get("angle", ""),
                "score": float(r["distance"]),
            })
        return hits

    def delete_by_user_id(self, *, user_id: str) -> None:
        self.client.delete(self.collection_name, f'user_id == "{user_id}"')
