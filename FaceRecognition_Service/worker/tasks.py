from __future__ import annotations

import base64
import logging
import urllib.parse

import psycopg

from core.embedding import l2_normalize
from infra.config import settings
from infra.crypto import encrypt_data
from infra.milvus_client import MilvusClient
from infra.minio_client import MinioStorage
from worker.celery_app import celery_app
from worker.tasks_pipeline import (
    check_face_quality,
    extract_embedding_placeholder,
    resize_if_necessary,
    run_liveness_placeholder,
    safe_read_image_from_bytes,
)

logger = logging.getLogger(__name__)

_milvus: MilvusClient | None = None
_storage: MinioStorage | None = None


def _get_milvus() -> MilvusClient:
    global _milvus
    if _milvus is None:
        _milvus = MilvusClient(
            host=settings.milvus_host,
            port=settings.milvus_port,
            collection_name=settings.milvus_collection,
            dim=512,
        )
    return _milvus


def _get_storage() -> MinioStorage:
    global _storage
    if _storage is None:
        _storage = MinioStorage()
    return _storage


def _get_user_info(user_id: str) -> dict | None:
    try:
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"),
            user=parsed.username,
            password=parsed.password,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT id::text, email, full_name, role, created_at FROM users WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            return {
                "id": row[0],
                "email": row[1],
                "full_name": row[2],
                "role": row[3],
                "created_at": str(row[4]) if row[4] else None,
            }
        return None
    except Exception as exc:
        logger.warning("Failed to get user info for %s: %s", user_id, exc)
        return None


def _decode_image(image_b64: str) -> bytes:
    return base64.b64decode(image_b64)


def _process_image(image_b64: str):
    data = _decode_image(image_b64)
    img = safe_read_image_from_bytes(data)
    img = resize_if_necessary(
        img,
        max_w=settings.max_image_width,
        max_h=settings.max_image_height,
        max_pixels=settings.max_image_pixels,
    )
    return data, img


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def enroll_task(self, user_id: str, image_b64: str) -> dict:
    logger.info("Enrolling user %s", user_id)
    try:
        raw_data, img = _process_image(image_b64)
        quality = check_face_quality(img)
        if not quality.get("valid"):
            return {
                "status": "error",
                "error": quality.get("error"),
                "score": quality.get("score"),
                "count": quality.get("count"),
            }
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        _get_milvus().upsert_embeddings(user_id=user_id, embedding=norm_vec)
        encrypted = encrypt_data(raw_data)
        _get_storage().upload_image(f"enrollments/{user_id}.jpg", encrypted)
        return {"status": "success", "user_id": user_id, "quality_score": quality.get("score")}
    except Exception as exc:
        logger.exception("Enroll failed for %s", user_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def verify_task(self, user_id: str, image_b64: str) -> dict:
    logger.info("Verifying user %s", user_id)
    try:
        _, img = _process_image(image_b64)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(user_id)
        if enrolled_emb is None:
            return {"status": "success", "verified": False, "score": 0.0, "error": "User not enrolled"}
        score = float(sum(n * e for n, e in zip(norm_vec, enrolled_emb)))
        return {"status": "success", "verified": score > 0.6, "score": score}
    except Exception as exc:
        logger.exception("Verify failed for %s", user_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def identify_task(self, image_b64: str) -> dict:
    logger.info("Identifying face")
    try:
        _, img = _process_image(image_b64)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        results = _get_milvus().search(embedding=norm_vec, top_k=3)
        matches = []
        for h in results:
            uid = h["user_id"]
            user = _get_user_info(uid) or {"id": uid}
            matches.append({
                "user_id": uid,
                "score": float(h["score"]),
                "email": user.get("email"),
                "full_name": user.get("full_name"),
                "role": user.get("role"),
                "created_at": user.get("created_at"),
            })
        return {"status": "success", "matches": matches}
    except Exception as exc:
        logger.exception("Identify failed")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def liveness_task(self, image_b64: str) -> dict:
    logger.info("Running liveness check")
    try:
        _, img = _process_image(image_b64)
        result = run_liveness_placeholder(img)
        return {"status": "success", **result}
    except Exception as exc:
        logger.exception("Liveness check failed")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def delete_user_task(self, user_id: str) -> dict:
    logger.info("Deleting user %s embeddings and images", user_id)
    try:
        _get_milvus().delete_by_user_id(user_id=user_id)
        try:
            _get_storage().delete_image(f"enrollments/{user_id}.jpg")
        except Exception:
            logger.warning("No image found for user %s, skipping", user_id)
        return {"status": "success", "user_id": user_id}
    except Exception as exc:
        logger.exception("Delete failed for %s", user_id)
        raise self.retry(exc=exc)
