from __future__ import annotations

import logging
import threading
import urllib.parse
import uuid as _uuid

import numpy as np
import psycopg
from jose import jwt

from core.embedding import l2_normalize
from infra.config import settings
from infra.crypto import encrypt_data
from infra.milvus_client import MilvusClient
from infra.minio_client import MinioStorage
from worker.celery_app import celery_app
from worker.tasks_pipeline import (
    check_face_quality,
    detect_face_once,
    extract_embedding_placeholder,
    liveness_from_face,
    resize_if_necessary,
    run_liveness_analysis,
    safe_read_image_from_bytes,
)

logger = logging.getLogger(__name__)

_milvus: MilvusClient | None = None
_storage: MinioStorage | None = None
_pg_connection_cache: dict[int, psycopg.Connection] = {}
_pg_lock = threading.Lock()

# =============================================================================
# THREAD-LOCAL CONNECTION POOL - Reuse connections per thread
# =============================================================================
def _get_pg_connection() -> psycopg.Connection:
    """Get or create a thread-local PostgreSQL connection (autocommit mode)."""
    thread_id = threading.current_thread().ident
    if thread_id not in _pg_connection_cache or _pg_connection_cache[thread_id].closed:
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"),
            user=parsed.username,
            password=parsed.password,
            autocommit=True,
        )
        _pg_connection_cache[thread_id] = conn
        logger.debug("Created new PG connection for thread %s", thread_id)
    else:
        try:
            _pg_connection_cache[thread_id].execute("SELECT 1")
        except Exception:
            _pg_connection_cache[thread_id].close()
            parsed = urllib.parse.urlparse(settings.postgres_url)
            conn = psycopg.connect(
                host=parsed.hostname,
                port=parsed.port or 5432,
                dbname=parsed.path.lstrip("/"),
                user=parsed.username,
                password=parsed.password,
                autocommit=True,
            )
            _pg_connection_cache[thread_id] = conn
            logger.debug("Recreated stale PG connection for thread %s", thread_id)
    return _pg_connection_cache[thread_id]

# =============================================================================
# TEMP FRAME STORAGE - Upload to MinIO, pass key instead of base64 via Redis
# =============================================================================
def _upload_temp_frame(frame_bytes: bytes, task_id: str | None = None) -> str:
    """Upload frame bytes to MinIO temp bucket, return object key."""
    if task_id is None:
        task_id = str(_uuid.uuid4())
    object_key = f"temp_frames/{task_id}.jpg"
    _get_storage().upload_image(object_key, frame_bytes)
    logger.debug("Uploaded temp frame to MinIO: %s", object_key)
    return object_key


def _get_temp_frame(object_key: str) -> bytes:
    """Download temp frame from Redis cache first, then fall back to MinIO.

    Some uploads may become visible in MinIO slightly after the task starts.
    To reduce transient `NoSuchKey` failures, we retry briefly when MinIO reports missing key.
    """
    import time
    try:
        from infra.redis_cache import redis_client as _rc
        cached = _rc.get(f"temp_frame:{object_key}")
        if cached:
            _rc.delete(f"temp_frame:{object_key}")
            return cached
    except Exception:
        pass

    last_error = None
    # Retry quickly for transient propagation delays.
    for attempt in range(8):
        try:
            return _get_storage().get_image(object_key)
        except Exception as exc:
            last_error = exc
            is_missing = "NoSuchKey" in str(exc) or "not found" in str(exc).lower()
            if is_missing and attempt < 7:
                logger.warning(
                    "Temp frame missing in MinIO (attempt %s/8). object_key=%s. error=%s",
                    attempt + 1,
                    object_key,
                    str(exc),
                )
                time.sleep(0.5)
                continue
            raise

    raise last_error  # type: ignore[misc]


def _delete_temp_frame(object_key: str) -> None:
    """Delete temp frame from MinIO after processing."""
    try:
        _get_storage().delete_image(object_key)
        logger.debug("Deleted temp frame: %s", object_key)
    except Exception:
        logger.warning("Failed to delete temp frame: %s", object_key)


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
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT id::text, email, full_name, role, created_at FROM users WHERE id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        cur.close()
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


def _get_patron_id_by_user_id(user_id: str) -> str | None:
    try:
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT u.email FROM users u WHERE u.id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            return None
        email = row[0]
        cur.execute(
            "SELECT id::text FROM patrons WHERE email = %s LIMIT 1",
            (email,),
        )
        patron_row = cur.fetchone()
        cur.close()
        if patron_row:
            return patron_row[0]
        return None
    except Exception as exc:
        logger.warning("Failed to get patron_id for user_id %s: %s", user_id, exc)
        return None


def _process_from_minio(object_key: str):
    """Download frame from MinIO, decode, resize and return (raw_bytes, img)."""
    raw_data = _get_temp_frame(object_key)
    img = safe_read_image_from_bytes(raw_data)
    img = resize_if_necessary(
        img,
        max_w=settings.max_image_width,
        max_h=settings.max_image_height,
        max_pixels=settings.max_image_pixels,
    )
    return raw_data, img


def _resolve_image(object_key: str | None = None, image_data: str | None = None):
    """Get (raw_bytes, img) from either MinIO key or base64-encoded data."""
    if image_data:
        import base64 as _b64
        raw = _b64.b64decode(image_data)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(
            img,
            max_w=settings.max_image_width,
            max_h=settings.max_image_height,
            max_pixels=settings.max_image_pixels,
        )
        return raw, img
    return _process_from_minio(object_key)  # type: ignore[arg-type]


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def enroll_task(
    self,
    user_id: str,
    object_key: str | None = None,
    image_data: str | None = None,
    angle: str = "frontal",
) -> dict:
    angle = angle or "frontal"
    logger.info("Enrolling user %s (angle=%s)", user_id, angle)
    try:
        patron_id = _get_patron_id_by_user_id(user_id) or user_id
        raw_data, img = _resolve_image(object_key, image_data)

        quality = check_face_quality(img)
        if not quality.get("valid"):
            if object_key:
                _delete_temp_frame(object_key)
            return {
                "status": "error",
                "error": quality.get("error"),
                "score": quality.get("score"),
                "count": quality.get("count"),
            }

        # Only run liveness for frontal to reduce friction (per existing enroll_face logic)
        if angle == "frontal":
            liveness = run_liveness_analysis(img)
            if not liveness.get("is_live", False):
                if object_key:
                    _delete_temp_frame(object_key)
                logger.warning(
                    "Enroll: liveness check failed for patron_id %s (angle=%s), score=%.4f",
                    patron_id,
                    angle,
                    liveness.get("liveness_score", 0),
                )
                return {
                    "status": "error",
                    "error": "LIVENESS_FAILED",
                    "liveness_score": liveness.get("liveness_score"),
                }

        vec = extract_embedding_placeholder(img)
        vec_arr = np.array(vec, dtype=np.float32)
        vec_sum = float(np.sum(np.abs(vec_arr)))
        if vec_sum < 0.1:
            if object_key:
                _delete_temp_frame(object_key)
            logger.error(
                "Enroll: extracted embedding is near-zero for patron_id %s (angle=%s), sum=%.6f",
                patron_id,
                angle,
                vec_sum,
            )
            return {"status": "error", "error": "FACE_DETECTION_FAILED", "score": 0.0}

        norm_vec = l2_normalize(vec)
        logger.info(
            "Enroll embedding stats (angle=%s): min=%.4f, max=%.4f, sum_abs=%.4f, norm=%.4f",
            angle,
            float(np.min(vec_arr)),
            float(np.max(vec_arr)),
            vec_sum,
            float(np.linalg.norm(vec_arr)),
        )

        _get_milvus().upsert_embeddings(user_id=patron_id, embedding=norm_vec)
        encrypted = encrypt_data(raw_data)
        _get_storage().upload_image(f"enrollments/{patron_id}.jpg", encrypted)

        if object_key:
            _delete_temp_frame(object_key)

        return {
            "status": "success",
            "patron_id": patron_id,
            "user_id": user_id,
            "angle": angle,
            "quality_score": quality.get("score"),
        }
    except Exception as exc:
        # NOTE: Do NOT delete temp frame here.
        # When Celery retries, the next attempt still needs to read the same MinIO key.
        logger.exception("Enroll failed for %s (angle=%s)", user_id, angle)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def verify_task(self, user_id: str, object_key: str | None = None, image_data: str | None = None) -> dict:
    logger.info("Verifying user %s", user_id)
    try:
        patron_id = _get_patron_id_by_user_id(user_id) or user_id
        _, img = _resolve_image(object_key, image_data)
        vec = extract_embedding_placeholder(img)
        vec_arr = np.array(vec, dtype=np.float32)
        vec_sum = float(np.sum(np.abs(vec_arr)))
        if vec_sum < 0.1:
            logger.error("Verify: extracted embedding is near-zero, sum=%.6f", vec_sum)
            return {"status": "error", "error": "FACE_DETECTION_FAILED", "score": 0.0}
        norm_vec = l2_normalize(vec)
        norm_vec_arr = np.array(norm_vec, dtype=np.float32)
        logger.info("Verify query embedding: min=%.4f, max=%.4f, sum_abs=%.4f",
                    float(np.min(vec_arr)), float(np.max(vec_arr)), vec_sum)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(patron_id)
        if not enrolled_emb:
            return {"status": "success", "verified": False, "score": 0.0, "error": "Face not enrolled"}
        enrolled_arr = np.array(enrolled_emb, dtype=np.float32)
        best_score = float(np.dot(norm_vec_arr, enrolled_arr))
        score = best_score
        logger.info("Verify best score for patron_id %s (user_id %s): %.4f",
                    patron_id, user_id, best_score)
        logger.info("Verify score for patron_id %s (user_id %s): %.4f (query_norm=%.4f, enrolled_norm=%.4f)",
                    patron_id, user_id, score,
                    float(np.linalg.norm(vec_arr)),
                    float(np.linalg.norm(enrolled_arr)))
        if object_key: _delete_temp_frame(object_key)
        return {"status": "success", "verified": score > 0.6, "score": score}
    except Exception as exc:
        logger.exception("Verify failed for %s", user_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def identify_task(self, object_key: str | None = None, image_data: str | None = None) -> dict:
    logger.info("Identifying face")
    try:
        _, img = _resolve_image(object_key, image_data)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        results = _get_milvus().search(embedding=norm_vec, top_k=5)
        matches = []
        for h in results:
            pid = h["user_id"]
            user = _get_user_info(pid) or {"id": pid}
            matches.append({
                "user_id": pid,
                "score": float(h["score"]),
                "email": user.get("email"),
                "full_name": user.get("full_name"),
                "role": user.get("role"),
                "created_at": user.get("created_at"),
            })
        if object_key: _delete_temp_frame(object_key)
        return {"status": "success", "matches": matches}
    except Exception as exc:
        if object_key: _delete_temp_frame(object_key)
        logger.exception("Identify failed")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=1, default_retry_delay=5)
def face_login_task(self, email: str, object_key: str) -> dict:
    logger.info("Face login for %s", email)
    try:
        user_info = None
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT id::text, email, role FROM users WHERE email = %s",
            (email,),
        )
        row = cur.fetchone()
        cur.close()
        if row:
            user_info = {"id": row[0], "email": row[1], "role": row[2]}
        if not user_info:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "User not found"}

        _, img = _process_from_minio(object_key)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        norm_vec_arr = np.array(norm_vec, dtype=np.float32)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(user_info["id"])
        if not enrolled_emb:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face not enrolled. Please enroll first."}
        enrolled_arr = np.array(enrolled_emb, dtype=np.float32)
        score = float(np.dot(norm_vec_arr, enrolled_arr))
        if score < 0.6:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face does not match", "score": score}

        liveness = run_liveness_analysis(img)
        is_live = liveness.get("is_live", False)
        if not is_live:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Liveness check failed", "liveness_score": liveness.get("liveness_score")}

        import datetime as dt
        access_token = jwt.encode(
            {
                "sub": user_info["id"],
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=settings.jwt_access_expires_minutes),
                "roles": [user_info["role"]],
                "typ": "access",
                "iat": dt.datetime.now(dt.UTC),
            },
            settings.jwt_access_secret,
            algorithm="HS256",
        )
        refresh_token = jwt.encode(
            {
                "sub": user_info["id"],
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "exp": dt.datetime.now(dt.UTC) + dt.timedelta(days=settings.jwt_refresh_expires_days),
                "roles": [user_info["role"]],
                "typ": "refresh",
                "iat": dt.datetime.now(dt.UTC),
            },
            settings.jwt_refresh_secret,
            algorithm="HS256",
        )
        _delete_temp_frame(object_key)
        return {
            "status": "success",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "score": score,
        }
    except Exception as exc:
        _delete_temp_frame(object_key)
        logger.exception("Face login failed for %s", email)
        return {"status": "error", "error": str(exc)}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def liveness_task(self, object_key: str | None = None, image_data: str | None = None) -> dict:
    logger.info("Running liveness check")
    try:
        _, img = _resolve_image(object_key, image_data)
        result = run_liveness_analysis(img)
        if object_key: _delete_temp_frame(object_key)
        return {"status": "success", **result}
    except Exception as exc:
        if object_key: _delete_temp_frame(object_key)
        logger.exception("Liveness check failed")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def delete_user_task(self, user_id: str) -> dict:
    logger.info("Deleting user %s embeddings and images", user_id)
    try:
        try:
            _get_storage().delete_image(f"enrollments/{user_id}.jpg")
        except Exception:
            logger.warning("No image found for user %s, skipping", user_id)
        _get_milvus().delete_by_user_id(user_id=user_id)
        return {"status": "success", "user_id": user_id}
    except Exception as exc:
        logger.exception("Delete failed for %s", user_id)
        raise self.retry(exc=exc)

@celery_app.task(bind=True, max_retries=3, default_retry_delay=5)
def full_delete_patron_task(self, patron_id: str) -> dict:
    """Delete patron from all 3 databases: MinIO → Milvus → PostgreSQL.
    Order ensures least orphan data if a step fails and retry is needed.
    """
    logger.info("Fully deleting patron %s from all databases", patron_id)
    try:
        try:
            _get_storage().delete_image(f"patrons/{patron_id}.jpg")
            _get_storage().delete_image(f"enrollments/{patron_id}.jpg")
        except Exception:
            logger.warning("No images found for patron %s, skipping MinIO cleanup", patron_id)
        _get_milvus().delete_by_user_id(user_id=patron_id)
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE access_logs SET patron_id = NULL WHERE patron_id = %s",
            (patron_id,),
        )
        cur.execute(
            "DELETE FROM patron_faces WHERE patron_id = %s",
            (patron_id,),
        )
        cur.execute(
            "DELETE FROM patrons WHERE id = %s",
            (patron_id,),
        )
        conn.commit()
        cur.close()
        logger.info("Full deletion completed for patron %s", patron_id)
        return {"status": "success", "patron_id": patron_id}
    except Exception as exc:
        logger.exception("Full deletion failed for patron %s", patron_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, name="enroll_face", max_retries=2, default_retry_delay=5)
def enroll_face(self, patron_id: str, object_key: str, angle: str = "frontal") -> dict:
    angle = angle or "frontal"
    logger.info("Enrolling face for patron %s (angle=%s)", patron_id, angle)
    try:
        raw_data = _get_temp_frame(object_key)
        img = safe_read_image_from_bytes(raw_data)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        face_result = detect_face_once(img)
        if not face_result.get("valid"):
            _delete_temp_frame(object_key)
            return {"status": "error", "error": face_result.get("error", "No face detected")}

        # Skip liveness for non-frontal angles to reduce user friction
        if angle == "frontal":
            liveness = liveness_from_face(img, face_result["face"])
            if not liveness.get("is_live", False):
                _delete_temp_frame(object_key)
                logger.warning("Enroll face: liveness check failed for patron_id %s, score=%.4f", patron_id, liveness.get("liveness_score", 0))
                return {
                    "status": "error",
                    "error": "LIVENESS_FAILED",
                    "liveness_score": liveness.get("liveness_score"),
                }

        norm_vec = l2_normalize(face_result["embedding"])
        milvus_id = str(_get_milvus().insert_embedding(user_id=patron_id, angle=angle, embedding=norm_vec))
        encrypted = encrypt_data(raw_data)
        image_url = f"patrons/{patron_id}_{angle}.jpg"
        _get_storage().upload_image(image_url, encrypted)

        # Insert PatronFaceModel record (append, not upsert)
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO patron_faces (id, patron_id, angle, milvus_id, image_url, is_active) VALUES (%s, %s, %s, %s, %s, true)",
            (str(_uuid.uuid4()), patron_id, angle, milvus_id, image_url),
        )
        conn.commit()
        cur.close()
        _delete_temp_frame(object_key)
        return {"status": "success", "patron_id": patron_id, "angle": angle, "quality_score": face_result.get("score")}
    except Exception as exc:
        # Do NOT delete temp frame on retry; retry still needs the same MinIO key.
        logger.exception("Enroll face failed for %s (angle=%s)", patron_id, angle)
        raise self.retry(exc=exc)


def _resolve_best_match(results: list[dict], threshold: float) -> dict | None:
    from collections import Counter
    counts: Counter[str] = Counter()
    scores: dict[str, float] = {}
    for r in results:
        pid = r["user_id"]
        counts[pid] += 1
        scores[pid] = max(scores.get(pid, 0), r["score"])
    best_pid = max(scores, key=lambda pid: (scores[pid], counts[pid]))
    if scores[best_pid] >= threshold and counts[best_pid] >= 2:
        return {"user_id": best_pid, "score": scores[best_pid], "votes": counts[best_pid]}
    if scores.get(best_pid, 0) >= threshold:
        return {"user_id": best_pid, "score": scores[best_pid], "votes": 1}
    return None


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def identify_patron(self, object_key: str) -> dict:
    logger.info("Identifying patron from camera frame")
    try:
        raw = _get_temp_frame(object_key)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        results = _get_milvus().search(embedding=norm_vec, top_k=3)
        best = _resolve_best_match(results, settings.face_match_threshold)
        if not best:
            _delete_temp_frame(object_key)
            return {"status": "no_match"}
        patron_id = best["user_id"]
        score = round(best["score"], 4)

        # Lookup patron info from Postgres
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT full_name, student_code, membership_expiry, status FROM patrons WHERE id = %s",
            (patron_id,),
        )
        row = cur.fetchone()
        cur.close()

        if not row:
            _get_milvus().delete_by_user_id(user_id=patron_id)
            logger.warning("Orphaned embedding cleaned up for %s", patron_id)
            _delete_temp_frame(object_key)
            return {"status": "no_match"}

        full_name, student_code, membership_expiry, status = row

        # Check membership
        from datetime import date
        is_expired = membership_expiry and membership_expiry < date.today()
        if is_expired or status != "active":
            _delete_temp_frame(object_key)
            return {"status": "expired", "patron_id": patron_id, "full_name": full_name, "student_code": student_code}

        _delete_temp_frame(object_key)
        return {
            "status": "matched",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
            "votes": best["votes"],
        }
    except Exception as exc:
        _delete_temp_frame(object_key)
        logger.exception("Identify patron failed")
        return {"status": "error", "error": str(exc)}


def _is_patron_inside(patron_id: str) -> bool:
    """Check if patron currently has an active entry (inside library).
    Uses current_status column from patrons table for fast reads.
    Auto-expires after max_entry_hours to prevent stuck 'inside' status.
    """
    try:
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT current_status = 'inside' AND last_entry_at > NOW() - INTERVAL '%s hours' FROM patrons WHERE id = %s",
            (settings.max_entry_hours, patron_id),
        )
        row = cur.fetchone()
        cur.close()
        return bool(row and row[0])
    except Exception as e:
        logger.warning("Failed to check patron inside status for %s: %s", patron_id, e)
        return False


def _publish_camera_event(data: dict) -> None:
    try:
        camera_id = data.get("camera_id", "unknown")
        status_val = data.get("status", "unknown")
        throttle_key = f"cam_throttle:{camera_id}:{status_val}"

        r = _get_redis_throttle()
        if r is None:
            from infra.redis_pubsub import publish as _pub
            _pub("camera:events", data)
            return

        try:
            import redis as _redis
            throttle_set = r.set(throttle_key, "1", nx=True, ex=1)
            if not throttle_set:
                logger.debug("Throttled event %s for camera %s", status_val, camera_id)
                return
        finally:
            r.close()

        from infra.redis_pubsub import publish as _pub
        _pub("camera:events", data)
        logger.info("Camera event published: status=%s, camera_id=%s", status_val, camera_id)
    except Exception as e:
        logger.error("Failed to publish camera event: %s - data=%s", e, data)


def _get_redis_throttle():
    try:
        from infra.config import settings
        import redis as _redis
        return _redis.Redis.from_url(settings.celery_broker_url)
    except Exception as e:
        logger.warning("Redis throttle unavailable: %s", e)
        return None

@celery_app.task(bind=True, name="process_camera_frame", max_retries=1, default_retry_delay=5)
def process_camera_frame(self, camera_id: str, object_key: str) -> dict:
    logger.info("Processing camera frame from %s", camera_id)
    try:
        raw = _get_temp_frame(object_key)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)

        # Step 0: Person presence check
        if settings.enable_person_detection:
            try:
                from worker.human_detector import has_person_in_frame
                if not has_person_in_frame(img):
                    logger.info("No person detected in frame from %s — skipping", camera_id)
                    result = {"camera_id": camera_id, "status": "no_match"}
                    _publish_camera_event(result)
                    _delete_temp_frame(object_key)
                    return result
            except Exception as pe:
                logger.warning("Person detection failed (will proceed anyway): %s", pe)

        # Step 1: Detect face once
        face_result = detect_face_once(img)
        if not face_result.get("valid") or face_result.get("face") is None:
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        face = face_result["face"]
        norm_vec = l2_normalize(face_result["embedding"])
        results = _get_milvus().search(embedding=norm_vec, top_k=5)
        best = _resolve_best_match(results, settings.face_match_threshold)
        if not best:
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        patron_id = best["user_id"]
        score = round(best["score"], 4)

        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT full_name, student_code, membership_expiry, status FROM patrons WHERE id = %s",
            (patron_id,),
        )
        row = cur.fetchone()
        cur.close()

        if not row:
            _get_milvus().delete_by_user_id(user_id=patron_id)
            logger.warning("Orphaned embedding cleaned up for %s from camera %s", patron_id, camera_id)
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        full_name, student_code, membership_expiry, status = row
        from datetime import date
        is_expired = membership_expiry and membership_expiry < date.today()
        if is_expired or status != "active":
            result = {"camera_id": camera_id, "status": "expired", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        # Step 2: Liveness
        liveness = liveness_from_face(img, face)
        if not liveness.get("is_live", False):
            result = {
                "camera_id": camera_id, "status": "spoof",
                "patron_id": patron_id, "full_name": full_name, "student_code": student_code,
                "score": score, "liveness_score": liveness.get("liveness_score"),
            }
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        # Step 3: Determine access type
        if camera_id == settings.entry_cam_id:
            access_type = "entry"
            if _is_patron_inside(patron_id):
                logger.info("Wrong direction at entry for %s (%s) — already inside", full_name, student_code)
                result = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type}
                _publish_camera_event(result)
                _delete_temp_frame(object_key)
                return result
        elif camera_id == settings.exit_cam_id:
            access_type = "exit"
            if not _is_patron_inside(patron_id):
                logger.info("Wrong direction at exit for %s (%s) — not inside library", full_name, student_code)
                result = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type}
                _publish_camera_event(result)
                _delete_temp_frame(object_key)
                return result
        else:
            logger.warning("Unknown camera_id: %s — skipping frame", camera_id)
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result

        # Step 4: Create access log
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT EXTRACT(EPOCH FROM (NOW() - access_time)) FROM access_logs WHERE patron_id = %s AND access_type = %s AND status = 'success' ORDER BY access_time DESC LIMIT 1",
            (patron_id, access_type),
        )
        row = cur.fetchone()
        if row and row[0] < settings.access_cooldown_seconds:
            cur.close()
            logger.info("Skipping duplicate %s for %s (%s) — last %s was %.0fs ago", access_type, full_name, student_code, access_type, row[0])
            result = {"camera_id": camera_id, "status": "no_match", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score}
            _publish_camera_event(result)
            _delete_temp_frame(object_key)
            return result
        log_id = str(_uuid.uuid4())
        cur.execute(
            """INSERT INTO access_logs (id, patron_id, access_type, verify_method, confidence, camera_id, status, access_time)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())""",
            (log_id, patron_id, access_type, "face", score, camera_id, "success"),
        )
        if access_type == "entry":
            cur.execute(
                "UPDATE patrons SET current_status = 'inside', last_entry_at = NOW(), last_entry_camera = %s, updated_at = NOW() WHERE id = %s",
                (camera_id, patron_id),
            )
        else:
            cur.execute(
                "UPDATE patrons SET current_status = 'outside', updated_at = NOW() WHERE id = %s",
                (patron_id,),
            )
        conn.commit()
        cur.close()

        logger.info("Access %s: %s (%s) at %s", access_type, full_name, student_code, camera_id)
        result = {
            "camera_id": camera_id,
            "status": "granted",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
            "access_type": access_type,
            "is_live": True,
        }
        _publish_camera_event(result)
        _delete_temp_frame(object_key)
        return result
    except Exception as exc:
        logger.exception("Camera frame processing failed")
        result = {"camera_id": camera_id, "status": "error", "error": str(exc)}
        _publish_camera_event(result)
        _delete_temp_frame(object_key)
        return result


@celery_app.task(bind=True, name="verify_face", max_retries=2, default_retry_delay=5)
def verify_face(self, patron_id: str, object_key: str) -> dict:
    logger.info("Verifying face for patron %s", patron_id)
    try:
        raw = _get_temp_frame(object_key)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(patron_id)
        if not enrolled_emb:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face not enrolled"}
        score = float(np.dot(np.array(norm_vec, dtype=np.float32), np.array(enrolled_emb, dtype=np.float32)))
        if score < settings.face_match_threshold:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face does not match", "score": score}
        liveness = run_liveness_analysis(img)
        if not liveness.get("is_live", False):
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Liveness check failed", "is_live": False}

        # Lookup patron info for access log
        conn = _get_pg_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT full_name, student_code FROM patrons WHERE id = %s",
            (patron_id,),
        )
        row = cur.fetchone()
        full_name = row[0] if row else "Unknown"
        student_code = row[1] if row else ""
        cur.close()

        # Determine entry/exit based on inside status
        access_type = "exit" if _is_patron_inside(patron_id) else "entry"

        # Create access log
        log_id = str(_uuid.uuid4())
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO access_logs (id, patron_id, access_type, verify_method, confidence, camera_id, status, access_time)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())""",
            (log_id, patron_id, access_type, "face", score, "kiosk", "success"),
        )
        if access_type == "entry":
            cur.execute(
                "UPDATE patrons SET current_status = 'inside', last_entry_at = NOW(), last_entry_camera = 'kiosk', updated_at = NOW() WHERE id = %s",
                (patron_id,),
            )
        else:
            cur.execute(
                "UPDATE patrons SET current_status = 'outside', updated_at = NOW() WHERE id = %s",
                (patron_id,),
            )
        conn.commit()
        cur.close()

        logger.info("Access %s: %s (%s) at kiosk", access_type, full_name, student_code)
        result = {
            "status": "granted",
            "camera_id": "kiosk",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
            "access_type": access_type,
            "is_live": True,
        }
        _publish_camera_event(result)
        _delete_temp_frame(object_key)
        return {
            "status": "success",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
            "access_type": access_type,
            "is_live": True,
            "liveness_score": liveness.get("liveness_score"),
        }
    except Exception as exc:
        _delete_temp_frame(object_key)
        logger.exception("Verify face failed for %s", patron_id)
        return {"status": "error", "error": str(exc)}
