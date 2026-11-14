from __future__ import annotations

import httpx

_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Returns a shared, persistent httpx.AsyncClient singleton.

    Reuses underlying TCP connection pool and SSL state across requests,
    significantly reducing latency on internal service-to-service calls.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0),
            limits=httpx.Limits(max_keepalive_connections=50, max_connections=200),
        )
    return _client


async def close_http_client() -> None:
    """Closes the shared httpx.AsyncClient on application shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None
