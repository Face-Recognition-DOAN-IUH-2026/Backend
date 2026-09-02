from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from api.dependencies import require_role

router = APIRouter(prefix="/debug", tags=["diagnostics"])
logger = logging.getLogger(__name__)
AdminUser = Annotated[dict, Depends(require_role("admin"))]


async def collect_face_collection_diagnostics() -> dict:
    """Compare active PostgreSQL face records with Milvus identifiers."""
    from sqlalchemy import select

    from infra.database import async_session_factory
    from infra.milvus_client import get_milvus_client
    from infra.models import PatronFaceModel

    milvus = get_milvus_client()
    milvus_rows = milvus.client.query(
        milvus.collection_name,
        filter="",
        output_fields=["user_id"],
        limit=1000,
    )
    milvus_ids = {row["user_id"] for row in milvus_rows}

    async with async_session_factory() as session:
        result = await session.execute(
            select(PatronFaceModel).where(PatronFaceModel.is_active.is_(True))
        )
        faces = result.scalars().all()

    postgres_ids = {str(face.patron_id) for face in faces}
    return {
        "milvus_count": len(milvus_ids),
        "patron_faces_count": len(postgres_ids),
        "milvus_ids": sorted(milvus_ids),
        "pg_ids": sorted(postgres_ids),
        "missing_in_milvus": sorted(postgres_ids - milvus_ids),
        "orphan_in_milvus": sorted(milvus_ids - postgres_ids),
    }


@router.get("/face-collections")
async def get_face_collection_diagnostics(
    _current_user: AdminUser,
) -> dict:
    logger.info(
        "Face collection diagnostic accessed by admin_id=%s",
        _current_user.get("id", "unknown"),
    )
    return await collect_face_collection_diagnostics()
