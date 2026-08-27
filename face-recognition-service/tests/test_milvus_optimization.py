import pytest
from unittest.mock import MagicMock, patch


def test_milvus_singleton_instance():
    """Verify get_milvus_client returns a singleton cached instance."""
    from infra.milvus_client import get_milvus_client

    with patch("infra.milvus_client.MilvusClient") as MockMilvusClient:
        instance_a = get_milvus_client()
        instance_b = get_milvus_client()

        assert instance_a is instance_b
        # Should only have been initialized once
        assert MockMilvusClient.call_count <= 1


@pytest.mark.asyncio
async def test_check_has_face_single_point_query():
    """Verify _check_has_face queries single record instead of scanning full collection."""
    from api.routers.users import _check_has_face

    mock_mc = MagicMock()
    mock_mc.collection_name = "face_embeddings"
    mock_mc.client.query.return_value = [{"user_id": "test-uuid-123"}]

    with patch("api.routers.users.get_milvus_client", return_value=mock_mc):
        has_face = await _check_has_face("test-uuid-123")

        assert has_face is True
        mock_mc.client.query.assert_called_once()
        call_kwargs = mock_mc.client.query.call_args.kwargs
        assert call_kwargs.get("filter") == 'user_id == "test-uuid-123"'
        assert call_kwargs.get("limit") == 1
        assert "user_id" in call_kwargs.get("output_fields", [])


@pytest.mark.asyncio
async def test_batch_enrollment_status_filter():
    """Verify batch enrollment status check uses targeted user_id in [...] query."""
    from api.routers.patrons import check_batch_enrollment_status, BatchEnrollmentStatusRequest

    mock_mc = MagicMock()
    mock_mc.collection_name = "face_embeddings"
    mock_mc.client.query.return_value = [{"user_id": "uid-1"}]

    req = BatchEnrollmentStatusRequest(user_ids=["uid-1", "uid-2"])

    with patch("api.routers.patrons.get_milvus_client", return_value=mock_mc):
        res = await check_batch_enrollment_status(req)

        assert res["statuses"] == {"uid-1": True, "uid-2": False}
        mock_mc.client.query.assert_called_once()
        call_kwargs = mock_mc.client.query.call_args.kwargs
        assert 'user_id in' in call_kwargs.get("filter", "")
        assert '"uid-1"' in call_kwargs.get("filter", "")
        assert '"uid-2"' in call_kwargs.get("filter", "")


def test_redis_throttle_reuses_connection_pool():
    """Verify _get_redis_throttle reuses global pooled client."""
    from worker.tasks import _get_redis_throttle
    from infra.redis_cache import redis_client

    client = _get_redis_throttle()
    assert client is redis_client
