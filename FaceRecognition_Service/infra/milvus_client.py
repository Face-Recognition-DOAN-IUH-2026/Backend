from __future__ import annotations

from typing import Any

from pymilvus import Collection, CollectionSchema, DataType, FieldSchema, connections, utility


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

        connections.connect(alias="default", host=self.host, port=self.port)
        self.collection = self._get_or_create_collection()
        self._ensure_collection_loaded()

    def _ensure_collection_loaded(self) -> None:
        try:
            self.collection.load()
        except Exception:
            pass

    def _get_or_create_collection(self) -> Collection:
        if utility.has_collection(self.collection_name):
            collection = Collection(self.collection_name)
            if not collection.indexes:
                collection.create_index(field_name="embedding", index_params={"metric_type": self.metric_type})
            try:
                collection.load()
            except Exception:
                pass
            return collection

        fields = [
            FieldSchema(name="user_id", dtype=DataType.VARCHAR, max_length=128, is_primary=True),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.dim),
        ]
        schema = CollectionSchema(fields=fields, description="face embeddings")
        collection = Collection(
            name=self.collection_name,
            schema=schema,
            using="default",
            metric_type=self.metric_type,
        )
        collection.create_index(field_name="embedding", index_params={"metric_type": self.metric_type})
        collection.load()
        return collection

    def upsert_embeddings(self, *, user_id: str, embedding: list[float]) -> None:
        self.collection.insert([[user_id], [embedding]])
        self.collection.flush()
        try:
            self.collection.load()
        except Exception:
            pass

    def search(self, *, embedding: list[float], top_k: int = 1) -> list[dict[str, Any]]:
        collection = self.collection
        try:
            collection.load()
        except Exception:
            pass
        search_params = {"metric_type": self.metric_type, "params": {"nprobe": 16}}

        res = collection.search(
            data=[embedding],
            anns_field="embedding",
            param=search_params,
            limit=top_k,
            output_fields=["user_id"],
        )

        hits = []
        for r in res[0]:
            hits.append({"user_id": r.entity.get("user_id"), "score": float(r.score)})
        return hits

    def get_embedding_by_user_id(self, user_id: str) -> list[float] | None:
        try:
            self.collection.load()
        except Exception:
            pass
        results = self.collection.query(
            expr=f"user_id == '{user_id}'",
            output_fields=["embedding"],
            limit=1,
        )
        if results:
            return results[0].get("embedding")
        return None

    def delete_by_user_id(self, *, user_id: str) -> None:
        collection = self.collection
        collection.delete(f"user_id == '{user_id}'")
        collection.flush()