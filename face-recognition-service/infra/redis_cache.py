from __future__ import annotations

import logging

import redis as _redis

from infra.config import settings

logger = logging.getLogger(__name__)

redis_client: _redis.Redis = _redis.from_url(settings.redis_url, decode_responses=False)
