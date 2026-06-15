from __future__ import annotations

import logging
import time
from typing import Any

from pymilvus import CollectionSchema, DataType, FieldSchema, MilvusClient as _MilvusClient
from pymilvus.exceptions import MilvusException
from pymilvus.milvus_client.index import IndexParams

logger = logging.getLogger(__name__)


def _with_retry(fn, max_retries=4, base_delay=1.0):
    for attempt in range(max_retries):
        try:
            return fn()
        except MilvusException as e:
            if "Timestamp lag too large" in str(e) and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                logger.warning("Milvus timestamp lag, retrying in %.1fs (attempt %d/%d)", delay, attempt + 1, max_retries)
                time.sleep(delay)
                continue
            raise


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
        self._ensure_index()

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
            consistency_level="Bounded",
        )
        self._create_index()

    def _create_index(self) -> None:
        index_params = IndexParams()
        index_params.add_index(
            field_name="embedding",
            metric_type=self.metric_type,
            index_type="IVF_FLAT",
            params={"nlist": 128},
        )
        self.client.create_index(
            collection_name=self.collection_name,
            index_params=index_params,
        )
        self.client.load_collection(self.collection_name)

    def _ensure_index(self) -> None:
        try:
            info = self.client.describe_index(self.collection_name, "embedding")
            mt = info.get("metric_type", "")
            if mt and mt.upper() != self.metric_type.upper():
                self.client.release_collection(self.collection_name)
                self.client.drop_index(self.collection_name, "embedding")
                logger.info("Dropped index with mismatched metric_type=%s, recreating with %s", mt, self.metric_type)
                self._create_index()
        except Exception:
            logger.warning("No existing index found, creating...")
            self._create_index()

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
        def _query():
            return self.client.query(
                self.collection_name,
                filter=f'user_id == "{user_id}"',
                output_fields=["id", "angle", "embedding"],
            )
        results = _with_retry(_query)
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
        def _search():
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
        return _with_retry(_search)

    def delete_by_user_id(self, *, user_id: str) -> None:
        def _delete():
            self.client.delete(self.collection_name, filter=f'user_id == "{user_id}"')
        _with_retry(_delete)

    def delete_by_user_id_and_angle(self, *, user_id: str, angle: str) -> None:
        def _delete():
            self.client.delete(self.collection_name, filter=f'user_id == "{user_id}" and angle == "{angle}"')
        _with_retry(_delete)
