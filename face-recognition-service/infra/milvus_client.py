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

    def _get_or_create_collection(self) -> Collection:
        if utility.has_collection(self.collection_name):
            collection = Collection(self.collection_name)
            fields = {f.name: f for f in collection.schema.fields}
            # Drop & recreate if collection has the new compound-PK schema
            if "id" in fields:
                __import__("logging").getLogger(__name__).warning(
                    "Dropping collection '%s' with compound PK schema and recreating with user_id PK",
                    self.collection_name,
                )
                collection.release()
                utility.drop_collection(self.collection_name)
                collection = self._create_collection()
                collection.load()
                return collection
            collection.load()
            return collection

        collection = self._create_collection()
        collection.load()
        return collection

    def _create_collection(self) -> Collection:
        fields = [
            FieldSchema(name="user_id", dtype=DataType.VARCHAR, max_length=128, is_primary=True),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.dim),
        ]
        schema = CollectionSchema(fields=fields, description="face embeddings")
        return Collection(
            name=self.collection_name,
            schema=schema,
            using="default",
            metric_type=self.metric_type,
        )

    def upsert_embeddings(self, *, user_id: str, embedding: list[float]) -> None:
        # Milvus uses insert/upsert depending on primary key and indexes.
        self.collection.insert([[user_id], [embedding]])
        self.collection.flush()

    def get_embedding_by_user_id(self, user_id: str) -> list[float] | None:
        results = self.collection.query(
            expr=f'user_id == "{user_id}"',
            output_fields=["embedding"],
            limit=1,
        )
        if not results:
            return None
        return results[0].get("embedding")

    def search(self, *, embedding: list[float], top_k: int = 1) -> list[dict[str, Any]]:
        # Ensure an index exists in real deployments; for MVP use default.
        collection = self.collection
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

    def delete_by_user_id(self, *, user_id: str) -> None:
        collection = self.collection
        collection.delete(f"user_id == '{user_id}'")
        collection.flush()
