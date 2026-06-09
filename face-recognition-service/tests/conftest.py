from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
def mock_milvus_client():
    with patch("infra.milvus_client.MilvusClient") as mock:
        instance = MagicMock()
        instance.search.return_value = [{"user_id": "test-user", "score": 0.95}]
        mock.return_value = instance
        yield instance


@pytest.fixture
def mock_redis():
    instance = AsyncMock()
    instance.exists.return_value = 0

    with patch("infra.cooldown.aioredis.from_url") as mock_from_url:
        mock_from_url.return_value = instance
        yield instance
