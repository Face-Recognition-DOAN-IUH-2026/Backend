from __future__ import annotations

import pytest

from infra.cooldown import CooldownService


@pytest.mark.asyncio
async def test_acquire_first_call_returns_true(mock_redis):
    cooldown = CooldownService()
    mock_redis.exists.return_value = 0
    result = await cooldown.acquire("test-key", cooldown_seconds=5)
    assert result is True
    mock_redis.setex.assert_called_once_with("cooldown:test-key", 5, "1")


@pytest.mark.asyncio
async def test_acquire_when_cooldown_active_returns_false(mock_redis):
    cooldown = CooldownService()
    mock_redis.exists.return_value = 1
    result = await cooldown.acquire("test-key", cooldown_seconds=5)
    assert result is False
    mock_redis.setex.assert_not_called()


@pytest.mark.asyncio
async def test_acquire_different_keys_independent(mock_redis):
    cooldown = CooldownService()
    mock_redis.exists.side_effect = [0, 1]
    result_a = await cooldown.acquire("key-a")
    assert result_a is True
    result_b = await cooldown.acquire("key-b")
    assert result_b is False
