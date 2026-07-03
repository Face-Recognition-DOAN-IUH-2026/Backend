from __future__ import annotations

import logging
import urllib.parse
import uuid as _uuid

import httpx
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
    check_motion_blur,
    detect_all_faces,
    detect_face_once,
    enhance_illumination,
    extract_embedding_placeholder,
    liveness_from_face,
    resize_if_necessary,
    run_liveness_analysis,
    safe_read_image_from_bytes,
)

logger = logging.getLogger(__name__)

_milvus: MilvusClient | None = None
_storage: MinioStorage | None = None

# =============================================================================
# USER-SERVICE API CLIENT - HTTP calls instead of direct DB queries
# =============================================================================
_USER_SERVICE_URL = settings.user_service_url
_ACCESS_SERVICE_URL = settings.access_service_url

def _get_service_auth_headers() -> dict:
    """Get Authorization headers with service JWT token."""
    from core.service_token import get_auth_headers
    return get_auth_headers(
        service_name="face-recognition-service",
        scopes=["users:read", "users:write", "access:read", "access:write"],
        secret=settings.jwt_access_secret,
    )

def _call_user_service(method: str, path: str, **kwargs) -> dict | None:
    try:
        headers = kwargs.pop("headers", {})
        headers.update(_get_service_auth_headers())
        with httpx.Client(base_url=_USER_SERVICE_URL, timeout=5.0) as client:
            resp = client.request(method, path, headers=headers, **kwargs)
            if resp.status_code == 200:
                return resp.json()
        return None
    except Exception as exc:
        logger.warning("user-service call failed %s %s: %s", method, path, exc)
        return None


def _get_user_via_api(user_id: str) -> dict | None:
    try:
        from infra.redis_cache import redis_client as _rc
        cache_key = f"user:{user_id}"
        cached = _rc.get(cache_key)
        if cached:
            import json
            return json.loads(cached)
    except Exception:
        pass
    result = _call_user_service("GET", f"/internal/users/{user_id}")
    if result:
        try:
            from infra.redis_cache import redis_client as _rc
            import json
            _rc.setex(cache_key, 30, json.dumps(result))
        except Exception:
            pass
        return result

    return None


def _call_access_service(method: str, path: str, **kwargs) -> dict | None:
    try:
        headers = kwargs.pop("headers", {})
        headers.update(_get_service_auth_headers())
        with httpx.Client(base_url=_ACCESS_SERVICE_URL, timeout=5.0) as client:
            resp = client.request(method, path, headers=headers, **kwargs)
            if resp.status_code < 300:
                return resp.json()
            logger.warning("access-service returned %s for %s %s", resp.status_code, method, path)
        return None
    except Exception as exc:
        logger.warning("access-service call failed %s %s: %s", method, path, exc)
        return None


def _get_access_status(patron_id: str) -> dict | None:
    return _call_access_service("GET", f"/internal/access/patrons/{patron_id}/status")


# =============================================================================
# PG CONNECTION - Create per-call, always close after use
# =============================================================================
def _get_pg_connection() -> psycopg.Connection:
    """Create a fresh PostgreSQL connection (autocommit mode)."""
    parsed = urllib.parse.urlparse(settings.postgres_url)
    return psycopg.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
        autocommit=True,
    )


def _close_pg_connection(conn: psycopg.Connection | None) -> None:
    """Close PG connection safely."""
    if conn is not None and not conn.closed:
        try:
            conn.close()
        except Exception:
            pass

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
        data = _get_user_via_api(user_id)
        if data:
            return {
                "id": str(data["id"]),
                "email": data["email"],
                "full_name": data.get("full_name") or data.get("fullName"),
                "role": data["role"],
                "created_at": str(data.get("created_at") or data.get("createdAt")) if data.get("created_at") or data.get("createdAt") else None,
            }
        return None
    except Exception as exc:
        logger.warning("Failed to get user info for %s: %s", user_id, exc)
        return None


def _get_patron_id_by_user_id(user_id: str) -> str | None:
    """After merging patrons into users, user_id IS the patron_id (same UUID)."""
    return user_id


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

        _get_milvus().delete_by_user_id_and_angle(user_id=patron_id, angle=angle)
        _get_milvus().insert_embedding(user_id=patron_id, angle=angle, embedding=norm_vec)
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


def _rollback_enrolled_angles(patron_id: str, enrolled_angles: list[str]) -> None:
    """Rollback all successfully enrolled angles (delete from Milvus, MinIO, DB)."""
    for angle in enrolled_angles:
        try:
            _get_milvus().delete_by_user_id_and_angle(user_id=patron_id, angle=angle)
        except Exception as exc:
            logger.warning("Rollback: failed to delete Milvus for angle=%s: %s", angle, exc)
        try:
            _get_storage().delete_image(f"enrollments/{patron_id}_{angle}.jpg")
        except Exception as exc:
            logger.warning("Rollback: failed to delete MinIO for angle=%s: %s", angle, exc)
        conn = None
        try:
            conn = _get_pg_connection()
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM patron_faces WHERE patron_id = %s AND angle = %s",
                (patron_id, angle),
            )
            cur.close()
        except Exception as exc:
            logger.warning("Rollback: failed to delete patron_faces for angle=%s: %s", angle, exc)
        finally:
            _close_pg_connection(conn)


@celery_app.task(bind=True, max_retries=0)
def batch_enroll_task(self, user_id: str, object_keys: list[str] | None = None) -> dict:
    """Enroll user with 4 angles. Atomic all-or-nothing: if any angle fails, rollback all."""
    angles = ["frontal", "right", "left", "down"]
    if not object_keys or len(object_keys) != len(angles):
        return {"status": "error", "error": "Expected 4 object_keys for frontal/right/left/down"}
    results = []
    enrolled_angles: list[str] = []
    patron_id = _get_patron_id_by_user_id(user_id) or user_id
    for idx, angle in enumerate(angles):
        try:
            _, img = _resolve_image(object_keys[idx], None)
            quality = check_face_quality(img, angle)
            if not quality.get("valid"):
                results.append({"angle": angle, "status": "error", "error": quality.get("error")})
                continue
            if angle == "frontal":
                liveness = run_liveness_analysis(img)
                if not liveness.get("is_live", False):
                    results.append({"angle": angle, "status": "error", "error": "LIVENESS_FAILED", "liveness_score": liveness.get("liveness_score")})
                    continue
            vec = extract_embedding_placeholder(img)
            vec_arr = np.array(vec, dtype=np.float32)
            vec_sum = float(np.sum(np.abs(vec_arr)))
            if vec_sum < 0.1:
                results.append({"angle": angle, "status": "error", "error": "FACE_DETECTION_FAILED"})
                continue
            norm_vec = l2_normalize(vec)
            _get_milvus().delete_by_user_id_and_angle(user_id=patron_id, angle=angle)
            _get_milvus().insert_embedding(user_id=patron_id, angle=angle, embedding=norm_vec)
            raw_data, _ = _resolve_image(object_keys[idx], None)
            encrypted = encrypt_data(raw_data)
            _get_storage().upload_image(f"enrollments/{patron_id}_{angle}.jpg", encrypted)
            conn = None
            try:
                conn = _get_pg_connection()
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO patron_faces (id, patron_id, angle, milvus_id, image_url, is_active) VALUES (%s, %s, %s, %s, %s, true)",
                    (str(_uuid.uuid4()), patron_id, angle, "", f"enrollments/{patron_id}_{angle}.jpg"),
                )
                conn.commit()
                cur.close()
            finally:
                _close_pg_connection(conn)
            enrolled_angles.append(angle)
            results.append({"angle": angle, "status": "success", "quality_score": quality.get("score")})
        except Exception as exc:
            logger.exception("Batch enroll failed for angle=%s", angle)
            results.append({"angle": angle, "status": "error", "error": str(exc)})
        finally:
            try:
                _delete_temp_frame(object_keys[idx])
            except Exception:
                pass
    errors = [r for r in results if r["status"] != "success"]
    if errors:
        # Atomic rollback: delete all successfully enrolled angles
        if enrolled_angles:
            logger.warning("Batch enroll failed, rolling back %s enrolled angles: %s", len(enrolled_angles), enrolled_angles)
            _rollback_enrolled_angles(patron_id, enrolled_angles)
        return {"status": "error", "error": f"{len(errors)} angle(s) failed, all rolled back", "results": results}
    return {"status": "success", "results": results}


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
        return {"status": "success", "verified": score > settings.face_match_threshold, "score": score}
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
        # Do NOT delete temp frame here — retry still needs the same MinIO key.
        logger.exception("Identify failed")
        raise self.retry(exc=exc)


def _sync_face_login(raw_bytes: bytes) -> dict:
    """Passwordless face login — search Milvus across ALL users, return JWT tokens.

    This is a synchronous function (NOT a Celery task) so FastAPI can call it
    directly via run_in_threadpool, eliminating async polling.
    """
    object_key = _upload_temp_frame(raw_bytes, str(_uuid.uuid4()))
    try:
        img = safe_read_image_from_bytes(raw_bytes)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)

        img = enhance_illumination(img)

        face_data = detect_face_once(img)
        if not face_data.get("valid"):
            return {"status": "error", "error": "Không phát hiện khuôn mặt", "detail": face_data.get("error")}

        vec = face_data["embedding"]
        norm_vec = l2_normalize(vec)

        results = _get_milvus().search(embedding=norm_vec, top_k=10)
        best = _resolve_best_match(results, settings.face_match_threshold)
        if not best:
            top_score = max((r["score"] for r in results), default=0.0)
            return {
                "status": "error",
                "error": "Khuôn mặt không khớp với tài khoản nào",
                "detail": f"top_score={round(top_score, 4)}, threshold={settings.face_match_threshold}, candidates={len(results)}",
            }

        matched_user_id = best["user_id"]
        score = round(best["score"], 4)

        user_data = _get_user_via_api(matched_user_id)
        if not user_data:
            return {"status": "error", "error": "Không tìm thấy thông tin tài khoản"}

        user_id = str(user_data["id"])
        user_email = user_data["email"]
        user_role = user_data["role"]
        user_full_name = user_data.get("full_name") or user_data.get("fullName")
        user_student_code = user_data.get("student_code") or user_data.get("studentCode")

        try:
            import redis as _redis
            r = _redis.Redis.from_url(settings.redis_url)
            lockout_key = f"face_login_lockout:{user_id}"
            locked = r.get(lockout_key)
            if locked:
                ttl = r.ttl(lockout_key)
                r.close()
                return {"status": "error", "error": f"Đăng nhập khuôn mặt tạm thời bị khóa ({ttl}s). Vui lòng dùng mật khẩu."}
            r.close()
        except Exception:
            pass

        liveness = run_liveness_analysis(img)
        is_live = liveness.get("is_live", False)
        if not is_live:
            logger.warning("Spoof attempt detected for user %s (%s)", user_email, user_id)
            try:
                import redis as _redis
                r = _redis.Redis.from_url(settings.redis_url)
                fail_key = f"face_login_fail:{user_id}"
                fail_count = r.incr(fail_key)
                if fail_count == 1:
                    r.expire(fail_key, 900)
                r.close()
            except Exception:
                pass
            return {"status": "error", "error": "Phát hiện giả mạo. Vui lòng dùng mật khẩu hoặc thử lại."}

        import datetime as dt
        access_token = jwt.encode(
            {
                "sub": user_id,
                "email": user_email,
                "full_name": user_full_name,
                "student_code": user_student_code,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=settings.jwt_access_expires_minutes),
                "roles": [user_role],
                "typ": "access",
                "iat": dt.datetime.now(dt.UTC),
            },
            settings.jwt_access_secret,
            algorithm="HS256",
        )
        refresh_token = jwt.encode(
            {
                "sub": user_id,
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "exp": dt.datetime.now(dt.UTC) + dt.timedelta(days=settings.jwt_refresh_expires_days),
                "roles": [user_role],
                "typ": "refresh",
                "iat": dt.datetime.now(dt.UTC),
            },
            settings.jwt_refresh_secret,
            algorithm="HS256",
        )

        try:
            import redis as _redis
            r = _redis.Redis.from_url(settings.redis_url)
            r.delete(f"face_login_fail:{user_id}")
            r.close()
        except Exception:
            pass

        return {
            "status": "success",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "score": score,
        }
    except Exception as exc:
        logger.exception("Face login failed")
        return {"status": "error", "error": str(exc)}
    finally:
        try:
            _delete_temp_frame(object_key)
        except Exception:
            pass


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def liveness_task(self, object_key: str | None = None, image_data: str | None = None) -> dict:
    logger.info("Running liveness check")
    try:
        _, img = _resolve_image(object_key, image_data)
        result = run_liveness_analysis(img)
        if object_key: _delete_temp_frame(object_key)
        return {"status": "success", **result}
    except Exception as exc:
        # Do NOT delete temp frame here — retry still needs the same MinIO key.
        logger.exception("Liveness check failed")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def process_image_task(
    self,
    object_key: str,
    camera_id: str = "unknown",
    process_type: str = "face_recognition",
    user_id: str | None = None,
    target_user_id: str | None = None,
) -> dict:
    """Unified image processing endpoint for SSE-based result delivery.

    Routes to the appropriate processing pipeline based on process_type,
    then publishes the result to access-service for real-time SSE broadcast.
    """
    logger.info("Processing image: type=%s, camera=%s, user=%s", process_type, camera_id, user_id)
    try:
        _, img = _resolve_image(object_key, None)

        if process_type == "verify":
            if not target_user_id:
                return {"status": "error", "error": "target_user_id required for verify"}
            vec = extract_embedding_placeholder(img)
            norm_vec = l2_normalize(vec)
            patron_id = _get_patron_id_by_user_id(target_user_id) or target_user_id
            enrolled_emb = _get_milvus().get_embedding_by_user_id(patron_id)
            if not enrolled_emb:
                result = {"verified": False, "score": 0.0, "error": "Face not enrolled"}
            else:
                enrolled_arr = np.array(enrolled_emb, dtype=np.float32)
                score = float(np.dot(np.array(norm_vec, dtype=np.float32), enrolled_arr))
                result = {"verified": score > settings.face_match_threshold, "score": score}

        elif process_type == "identify":
            vec = extract_embedding_placeholder(img)
            norm_vec = l2_normalize(vec)
            search_results = _get_milvus().search(embedding=norm_vec, top_k=5)
            matches = []
            for h in search_results:
                pid = h["user_id"]
                user = _get_user_info(pid) or {"id": pid}
                matches.append({
                    "user_id": pid,
                    "score": float(h["score"]),
                    "email": user.get("email"),
                    "full_name": user.get("full_name"),
                    "role": user.get("role"),
                })
            result = {"matches": matches}

        elif process_type == "liveness_check":
            result = run_liveness_analysis(img)

        else:
            # face_recognition: identify + liveness in one pass
            vec = extract_embedding_placeholder(img)
            norm_vec = l2_normalize(vec)
            search_results = _get_milvus().search(embedding=norm_vec, top_k=5)
            best = _resolve_best_match(search_results, settings.face_match_threshold)
            liveness = run_liveness_analysis(img)
            if best:
                patron_id = best["user_id"]
                user = _get_user_via_api(patron_id)
                access_status = "granted" if liveness.get("is_live", False) else "spoof"
                _publish_camera_event({
                    "camera_id": camera_id,
                    "status": access_status,
                    "patron_id": patron_id,
                    "student_code": (user or {}).get("student_code"),
                    "full_name": (user or {}).get("full_name"),
                    "score": best["score"],
                    "is_live": liveness.get("is_live"),
                    "liveness_score": liveness.get("liveness_score"),
                })
            else:
                _publish_camera_event({
                    "camera_id": camera_id,
                    "status": "no_match",
                    "score": max((r["score"] for r in search_results), default=0.0),
                })
            result = {
                "matches": [
                    {"user_id": h["user_id"], "score": float(h["score"])}
                    for h in search_results
                ],
                **liveness,
            }

        if object_key:
            _delete_temp_frame(object_key)

        return {"status": "success", "process_type": process_type, "result": result}

    except Exception as exc:
        logger.exception("process_image_task failed: type=%s", process_type)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=10)
def delete_user_task(self, user_id: str) -> dict:
    """Delete face embeddings, enrollment images, and PG records for a user.

    Handles both single-angle (enrollments/{id}.jpg) and
    multi-angle (enrollments/{id}_{angle}.jpg) storage patterns.
    """
    logger.info("Deleting user %s embeddings, images, and PG records", user_id)
    try:
        angles = ["", "_frontal", "_right", "_left", "_down"]
        for suffix in angles:
            try:
                _get_storage().delete_image(f"enrollments/{user_id}{suffix}.jpg")
            except Exception:
                pass
        _get_milvus().delete_by_user_id(user_id=user_id)

        # Cleanup patron_faces PG rows
        try:
            conn = _get_pg_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM patron_faces WHERE patron_id = %s", (user_id,))
                    logger.info("Deleted %s patron_faces PG rows for %s", cur.rowcount, user_id)
                conn.commit()
            finally:
                _close_pg_connection(conn)
        except Exception as pg_err:
            logger.warning("Failed to delete patron_faces PG rows for %s: %s", user_id, pg_err)

        return {"status": "success", "user_id": user_id}
    except Exception as exc:
        logger.exception("Delete failed for %s", user_id)
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
        _get_milvus().delete_by_user_id_and_angle(user_id=patron_id, angle=angle)
        milvus_id = str(_get_milvus().insert_embedding(user_id=patron_id, angle=angle, embedding=norm_vec))
        encrypted = encrypt_data(raw_data)
        image_url = f"patrons/{patron_id}_{angle}.jpg"
        _get_storage().upload_image(image_url, encrypted)

        # Insert PatronFaceModel record (append, not upsert)
        conn = None
        try:
            conn = _get_pg_connection()
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO patron_faces (id, patron_id, angle, milvus_id, image_url, is_active) VALUES (%s, %s, %s, %s, %s, true)",
                (str(_uuid.uuid4()), patron_id, angle, milvus_id, image_url),
            )
            conn.commit()
            cur.close()
        finally:
            _close_pg_connection(conn)
        _delete_temp_frame(object_key)
        return {"status": "success", "patron_id": patron_id, "angle": angle, "quality_score": face_result.get("score")}
    except Exception as exc:
        # Do NOT delete temp frame on retry; retry still needs the same MinIO key.
        logger.exception("Enroll face failed for %s (angle=%s)", patron_id, angle)
        raise self.retry(exc=exc)


def _resolve_best_match(results: list[dict], threshold: float) -> dict | None:
    from collections import Counter
    if not results:
        return None
    counts: Counter[str] = Counter()
    scores: dict[str, float] = {}
    for r in results:
        pid = r["user_id"]
        counts[pid] += 1
        scores[pid] = max(scores.get(pid, 0.0), r["score"])
    best_pid = max(scores, key=lambda pid: (counts[pid], scores[pid]))
    if scores[best_pid] >= threshold:
        return {"user_id": best_pid, "score": scores[best_pid], "votes": counts[best_pid]}
    return None


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def identify_patron(self, object_key: str) -> dict:
    logger.info("Identifying patron from camera frame")
    try:
        raw = _get_temp_frame(object_key)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)

        # Enhance illumination (CLAHE) to handle backlight / low light
        img = enhance_illumination(img)

        # Filter motion-blurred frames before embedding extraction
        if check_motion_blur(img):
            logger.info("Frame too blurry for identification, skipping")
            _delete_temp_frame(object_key)
            return {"status": "low_quality"}

        all_faces = detect_all_faces(img, min_face_size=settings.min_face_size)
        if not all_faces:
            _delete_temp_frame(object_key)
            return {"status": "no_match"}

        matches = []
        for face_data in all_faces:
            norm_vec = l2_normalize(face_data["embedding"])
            results = _get_milvus().search(embedding=norm_vec, top_k=3)
            best = _resolve_best_match(results, settings.face_match_threshold)
            if not best:
                continue

            patron_id = best["user_id"]
            score = round(best["score"], 4)

            user_data = _get_user_via_api(patron_id)
            if not user_data:
                _get_milvus().delete_by_user_id(user_id=patron_id)
                logger.warning("Orphaned embedding cleaned up for %s", patron_id)
                continue

            from datetime import date
            full_name = user_data.get("full_name") or user_data.get("fullName") or ""
            student_code = user_data.get("student_code") or user_data.get("studentCode") or ""
            membership_expiry_raw = user_data.get("membership_expiry") or user_data.get("membershipExpiry")
            membership_expiry = None
            if membership_expiry_raw:
                membership_expiry = (
                    membership_expiry_raw
                    if isinstance(membership_expiry_raw, date)
                    else date.fromisoformat(str(membership_expiry_raw)[:10])
                )
            status = user_data.get("status")
            is_expired = membership_expiry and membership_expiry < date.today()
            if is_expired or status != "active":
                matches.append({
                    "status": "expired",
                    "patron_id": patron_id,
                    "full_name": full_name,
                    "student_code": student_code,
                    "score": score,
                })
                continue

            matches.append({
                "status": "matched",
                "patron_id": patron_id,
                "full_name": full_name,
                "student_code": student_code,
                "score": score,
                "votes": best["votes"],
            })

        _delete_temp_frame(object_key)

        if not matches:
            return {"status": "no_match"}

        return {"status": "success", "matches": matches}
    except Exception as exc:
        _delete_temp_frame(object_key)
        logger.exception("Identify patron failed")
        return {"status": "error", "error": str(exc)}


def _is_patron_inside(patron_id: str) -> bool:
    """Check if patron currently has an active entry (inside library).
    Reads current status from access-service, which owns access state.
    Auto-expires after max_entry_hours to prevent stuck 'inside' status.
    """
    try:
        access_data = _get_access_status(patron_id)
        if not access_data:
            return False

        current_status = access_data.get("current_status") or access_data.get("currentStatus")
        if current_status != "inside":
            return False

        last_entry_raw = access_data.get("last_entry_at") or access_data.get("lastEntryAt")
        if not last_entry_raw:
            return True

        from datetime import datetime, timezone
        last_entry_at = (
            last_entry_raw
            if isinstance(last_entry_raw, datetime)
            else datetime.fromisoformat(str(last_entry_raw).replace("Z", "+00:00"))
        )
        if last_entry_at.tzinfo is None:
            last_entry_at = last_entry_at.replace(tzinfo=timezone.utc)
        max_age_seconds = settings.max_entry_hours * 3600
        return (datetime.now(timezone.utc) - last_entry_at).total_seconds() < max_age_seconds
    except Exception as e:
        logger.warning("Failed to check patron inside status for %s: %s", patron_id, e)
        return False


def _publish_camera_event(data: dict) -> None:
    try:
        camera_id = data.get("camera_id", "unknown")
        status_val = data.get("status", "unknown")
        patron_id = data.get("patron_id")
        if status_val == "granted" and patron_id:
            throttle_key = f"cam_throttle:{camera_id}:{status_val}:{patron_id}"
        else:
            throttle_key = f"cam_throttle:{camera_id}:{status_val}"

        from datetime import datetime, timezone
        data.setdefault("event_id", str(_uuid.uuid4()))
        data.setdefault("event_type", "camera_event")
        data.setdefault("occurred_at", datetime.now(timezone.utc).isoformat())
        data.setdefault("source", "face-recognition-service")
        if data.get("status") == "unknown":
            data["status"] = "no_match"

        r = _get_redis_throttle()
        if r is None:
            _call_access_service("POST", "/internal/access/recognition-events", json=data)
            return

        try:
            import redis as _redis
            throttle_set = r.set(throttle_key, "1", nx=True, ex=1)
            if not throttle_set:
                logger.debug("Throttled event %s for camera %s", status_val, camera_id)
                return
        finally:
            r.close()

        _call_access_service("POST", "/internal/access/recognition-events", json=data)
        logger.debug("Camera event submitted: status=%s, camera_id=%s", status_val, camera_id)
    except Exception as e:
        logger.error("Failed to submit camera event: %s", e)


def _get_redis_throttle():
    try:
        from infra.config import settings
        import redis as _redis
        return _redis.Redis.from_url(settings.redis_url)
    except Exception as e:
        logger.warning("Redis throttle unavailable: %s", e)
        return None

def _upload_evidence_frame(raw_bytes: bytes, log_id: str, prefix: str = "") -> None:
    """Upload frame evidence to MinIO for audit purposes.
    Called only for granted/spoof/expired events (lazy upload).
    """
    try:
        object_key = f"access_logs/{prefix}{log_id}.jpg"
        _get_storage().upload_image(object_key, raw_bytes)
        logger.debug("Uploaded evidence frame: %s", object_key)
    except Exception as e:
        logger.warning("Failed to upload evidence frame: %s", e)


def _check_redis_cooldown(patron_id: str, access_type: str) -> bool:
    """Check Redis cooldown — returns True if still in cooldown (skip)."""
    try:
        import redis as _redis
        r = _redis.Redis.from_url(settings.redis_url)
        try:
            key = f"cooldown:{access_type}:{patron_id}"
            if r.get(key):
                return True
            r.setex(key, settings.access_cooldown_seconds, "1")
            return False
        finally:
            r.close()
    except Exception:
        return False


def _scale_bbox_landmarks(
    bbox: list | None,
    landmarks: list | None,
    scale_x: float,
    scale_y: float,
) -> tuple[list | None, list | None]:
    """Scale bbox and landmarks from resized frame to original frame coordinates."""
    if bbox is not None and (scale_x != 1.0 or scale_y != 1.0):
        bbox = [round(b * scale_x if i % 2 == 0 else b * scale_y) for i, b in enumerate(bbox)]
    if landmarks is not None and (scale_x != 1.0 or scale_y != 1.0):
        landmarks = [[round(x * scale_x), round(y * scale_y)] for x, y in landmarks]
    return bbox, landmarks


def _process_single_face(
    camera_id: str,
    img,  # cv2.Mat — avoid runtime cv2 import
    face_data: dict,
    raw_bytes: bytes | None = None,
    orig_scale: tuple[float, float] | None = None,
) -> dict | None:
    """Process one detected face through the full access pipeline.

    Pipeline order (optimized):
      1. Embedding + Milvus search
      2. Stranger alert (unknown face)
      3. Redis cooldown check (before expensive operations)
      4. DB lookup + expiry check
      5. Direction check with grace period
      6. Liveness (7 classifiers)
      7. INSERT access_log + UPDATE patron status + lazy MinIO upload

    Returns an event dict if access is granted, or None otherwise.
    Non-granted statuses (spoof, expired, wrong_direction, unknown) published via SSE.
    """
    norm_vec = l2_normalize(face_data["embedding"])
    face = face_data["face"]
    bbox = face.bbox.tolist() if hasattr(face, "bbox") and face.bbox is not None else None
    landmarks = face.kps.tolist() if hasattr(face, "kps") and face.kps is not None else None
    if orig_scale:
        bbox, landmarks = _scale_bbox_landmarks(bbox, landmarks, orig_scale[0], orig_scale[1])
    results = _get_milvus().search(embedding=norm_vec, top_k=5)
    best = _resolve_best_match(results, settings.face_match_threshold)
    if not best:
        event = {
            "camera_id": camera_id, "status": "unknown",
            "bbox": bbox, "landmarks": landmarks,
        }
        _publish_camera_event(event)
        return None

    patron_id = best["user_id"]
    score = round(best["score"], 4)

    # Determine access type before DB (based on camera_id)
    if camera_id == settings.entry_cam_id:
        access_type = "entry"
    elif camera_id == settings.exit_cam_id:
        access_type = "exit"
    else:
        logger.warning("Unknown camera_id: %s — skipping frame", camera_id)
        return None

    # Phase 2: Redis cooldown check (O(1), before expensive ops)
    if _check_redis_cooldown(patron_id, access_type):
        logger.debug("Cooldown hit for %s %s on %s", patron_id, access_type, camera_id)
        return None

    # User lookup through user-service, which owns users.
    try:
        user_data = _get_user_via_api(patron_id)
        if not user_data:
            _get_milvus().delete_by_user_id(user_id=patron_id)
            logger.warning("Orphaned embedding cleaned up for %s from camera %s", patron_id, camera_id)
            return None

        from datetime import date, datetime, timezone
        full_name = user_data.get("full_name") or user_data.get("fullName") or ""
        student_code = user_data.get("student_code") or user_data.get("studentCode") or ""
        membership_expiry_raw = user_data.get("membership_expiry") or user_data.get("membershipExpiry")
        status = user_data.get("status")
        access_state = _get_access_status(patron_id) or {}
        current_status = access_state.get("current_status") or access_state.get("currentStatus") or "outside"
        last_entry_raw = access_state.get("last_entry_at") or access_state.get("lastEntryAt")

        membership_expiry = None
        if membership_expiry_raw:
            membership_expiry = (
                membership_expiry_raw
                if isinstance(membership_expiry_raw, date)
                else date.fromisoformat(str(membership_expiry_raw)[:10])
            )
        last_entry_at = None
        if last_entry_raw:
            last_entry_at = (
                last_entry_raw
                if isinstance(last_entry_raw, datetime)
                else datetime.fromisoformat(str(last_entry_raw).replace("Z", "+00:00"))
            )

        # Expiry check
        is_expired = membership_expiry and membership_expiry < date.today()
        if is_expired or status != "active":
            event = {"camera_id": camera_id, "status": "expired", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "bbox": bbox, "landmarks": landmarks}
            _publish_camera_event(event)
            if raw_bytes:
                _upload_evidence_frame(raw_bytes, patron_id, prefix="expired_")
            return None

        # Phase 5: Direction check with Grace Period
        if camera_id == settings.entry_cam_id:
            if current_status == "inside":
                if last_entry_at:
                    last_entry_ts = last_entry_at.replace(tzinfo=timezone.utc).timestamp()
                    is_recent = (datetime.now(timezone.utc).timestamp() - last_entry_ts) < settings.direction_grace_seconds
                else:
                    is_recent = False
                if is_recent:
                    logger.info("Grace period: %s (%s) still at entry — already_granted", full_name, student_code)
                    event = {"camera_id": camera_id, "status": "already_granted", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type, "bbox": bbox, "landmarks": landmarks}
                    _publish_camera_event(event)
                    return None
                else:
                    logger.info("Wrong direction at entry for %s (%s) — already inside", full_name, student_code)
                    event = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type, "bbox": bbox, "landmarks": landmarks}
                    _publish_camera_event(event)
                    if raw_bytes:
                        _upload_evidence_frame(raw_bytes, patron_id, prefix="wrong_dir_")
                    return None
        elif camera_id == settings.exit_cam_id:
            if current_status != "inside":
                logger.info("Wrong direction at exit for %s (%s) — not inside library", full_name, student_code)
                event = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type, "bbox": bbox, "landmarks": landmarks}
                _publish_camera_event(event)
                if raw_bytes:
                    _upload_evidence_frame(raw_bytes, patron_id, prefix="wrong_dir_")
                return None

        # Phase 2 (cont): Liveness check (expensive — after all fast checks passed)
        liveness = liveness_from_face(img, face)
        if not liveness.get("is_live", False):
            event = {
                "camera_id": camera_id, "status": "spoof",
                "patron_id": patron_id, "full_name": full_name, "student_code": student_code,
                "score": score, "liveness_score": liveness.get("liveness_score"),
                "bbox": bbox, "landmarks": landmarks,
            }
            _publish_camera_event(event)
            if raw_bytes:
                _upload_evidence_frame(raw_bytes, patron_id, prefix="spoof_")
            return None

        # All checks passed — write access log, then update user status through user-service.
        log_id = str(_uuid.uuid4())

        # Phase 4: Upload evidence to MinIO (lazy — only on grant)
        if raw_bytes:
            _upload_evidence_frame(raw_bytes, log_id)

        logger.info("Access %s: %s (%s) at %s", access_type, full_name, student_code, camera_id)
        event = {
            "camera_id": camera_id,
            "status": "granted",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
            "access_type": access_type,
            "is_live": True,
            "log_id": log_id,
            "bbox": bbox,
            "landmarks": landmarks,
        }
        return event

    except Exception:
        logger.exception("Failed to process face for camera %s", camera_id)
        return None


@celery_app.task(bind=True, name="process_camera_frame", max_retries=1, default_retry_delay=5)
def process_camera_frame(self, camera_id: str, object_key: str) -> dict:
    logger.info("Processing camera frame from %s", camera_id)
    # Decrement backpressure counter (Phase 3)
    try:
        import redis as _redis
        r = _redis.Redis.from_url(settings.redis_url)
        try:
            r.decr(f"camera_queue:{camera_id}")
        finally:
            r.close()
    except Exception:
        pass
    try:
        # Phase 4: Camera frames are Redis-only (no MinIO fallback)
        import time
        raw = None
        for attempt in range(3):
            try:
                from infra.redis_cache import redis_client as _rc
                cached = _rc.get(f"temp_frame:{object_key}")
                if cached:
                    _rc.delete(f"temp_frame:{object_key}")
                    raw = cached
                    break
            except Exception:
                pass
            if attempt < 2:
                time.sleep(0.3)
        if raw is None:
            raise FileNotFoundError(f"Camera frame {object_key} expired from Redis")
        img_original = safe_read_image_from_bytes(raw)
        orig_h, orig_w = img_original.shape[:2]
        img = resize_if_necessary(img_original, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)

        # Step 0: Person presence check
        if settings.enable_person_detection:
            try:
                from worker.human_detector import has_person_in_frame
                if not has_person_in_frame(img):
                    logger.info("No person detected in frame from %s — skipping", camera_id)
                    result = {"camera_id": camera_id, "status": "no_match"}
                    _publish_camera_event(result)
                    return result
            except Exception as pe:
                logger.warning("Person detection failed (will proceed anyway): %s", pe)

        # Step 1: Lightweight CLAHE on full frame for better detection
        img = enhance_illumination(img)

        # Step 2: Filter motion-blurred frames before detection
        if check_motion_blur(img):
            logger.info("Frame from %s too blurry — skipping", camera_id)
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        # Step 3: Detect all faces (filtered by min_face_size)
        resized_h, resized_w = img.shape[:2]
        all_faces = detect_all_faces(img, min_face_size=settings.min_face_size)
        if not all_faces:
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        # Step 4: Process each face independently (pass raw_bytes for lazy MinIO)
        scale_x = orig_w / resized_w if resized_w else 1.0
        scale_y = orig_h / resized_h if resized_h else 1.0
        granted_events = []
        for face_data in all_faces:
            event = _process_single_face(camera_id, img, face_data, raw_bytes=raw, orig_scale=(scale_x, scale_y))
            if event is not None:
                granted_events.append(event)

        # Publish granted events (non-granted statuses already published inside _process_single_face)
        for event in granted_events:
            _publish_camera_event(event)

        if not granted_events:
            return {"camera_id": camera_id, "status": "no_match"}

        return {
            "camera_id": camera_id,
            "status": "granted",
            "count": len(granted_events),
            "events": granted_events,
        }
    except Exception as exc:
        logger.exception("Camera frame processing failed")
        result = {"camera_id": camera_id, "status": "error", "error": str(exc)}
        _publish_camera_event(result)
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
        all_embeddings = _get_milvus().get_embeddings_by_user_id(patron_id)
        if not all_embeddings:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face not enrolled"}
        score = 0.0
        for row in all_embeddings:
            stored_emb = row.get("embedding")
            if stored_emb:
                s = float(np.dot(np.array(norm_vec, dtype=np.float32), np.array(stored_emb, dtype=np.float32)))
                if s > score:
                    score = s
        score = round(score, 4)
        if score < settings.face_match_threshold:
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Face does not match", "score": score}
        liveness = run_liveness_analysis(img)
        if not liveness.get("is_live", False):
            _delete_temp_frame(object_key)
            return {"status": "error", "error": "Liveness check failed", "is_live": False}

        # Lookup patron info through user-service; kiosk still owns its access decision.
        user_data = _get_user_via_api(patron_id) or {}
        full_name = user_data.get("full_name") or user_data.get("fullName") or "Unknown"
        student_code = user_data.get("student_code") or user_data.get("studentCode") or ""

        # Determine entry/exit based on inside status
        access_type = "exit" if _is_patron_inside(patron_id) else "entry"

        # Create access log
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
