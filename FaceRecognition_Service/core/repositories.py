from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class EmbeddingSearchResult:
    user_id: str
    score: float


class EmbeddingRepository(Protocol):
    async def upsert_embedding(self, user_id: str, embedding: list[float]) -> None: ...

    async def search_1n(
        self, embedding: list[float], top_k: int = 1, metric: str = "cosine"
    ) -> list[EmbeddingSearchResult]: ...

    async def delete_user_embeddings(self, user_id: str) -> None: ...


class UserRepository(Protocol):
    async def create_user(self, email: str, password_hash: str, role: str) -> str: ...

    async def get_user_by_email(self, email: str): ...

    async def get_user_by_id(self, user_id: str): ...

    async def delete_user(self, user_id: str) -> None: ...


class AuditLogRepository(Protocol):
    async def insert_event(self, *, user_id: str | None, event_type: str, metadata: dict) -> None: ...

