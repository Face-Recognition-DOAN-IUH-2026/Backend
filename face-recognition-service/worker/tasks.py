from __future__ import annotations

import base64
import logging
import urllib.parse

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


def _get_patron_id_by_user_id(user_id: str) -> str | None:
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
            "SELECT u.email FROM users u WHERE u.id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return None
        email = row[0]
        cur.execute(
            "SELECT id::text FROM patrons WHERE email = %s LIMIT 1",
            (email,),
        )
        patron_row = cur.fetchone()
        cur.close()
        conn.close()
        if patron_row:
            return patron_row[0]
        return None
    except Exception as exc:
        logger.warning("Failed to get patron_id for user_id %s: %s", user_id, exc)
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
        patron_id = _get_patron_id_by_user_id(user_id) or user_id
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
        vec_sum = sum(abs(x) for x in vec)
        if vec_sum < 0.1:
            logger.error("Enroll: extracted embedding is near-zero for patron_id %s, sum=%.6f", patron_id, vec_sum)
            return {"status": "error", "error": "FACE_DETECTION_FAILED", "score": 0.0}
        norm_vec = l2_normalize(vec)
        logger.info("Enroll embedding stats: min=%.4f, max=%.4f, sum_abs=%.4f, norm=%.4f",
                    min(vec), max(vec), vec_sum, sum(x*x for x in vec)**0.5)
        _get_milvus().upsert_embeddings(user_id=patron_id, embedding=norm_vec)
        encrypted = encrypt_data(raw_data)
        _get_storage().upload_image(f"enrollments/{patron_id}.jpg", encrypted)
        return {"status": "success", "patron_id": patron_id, "user_id": user_id, "quality_score": quality.get("score")}
    except Exception as exc:
        logger.exception("Enroll failed for %s", user_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def verify_task(self, user_id: str, image_b64: str) -> dict:
    logger.info("Verifying user %s", user_id)
    try:
        patron_id = _get_patron_id_by_user_id(user_id) or user_id
        _, img = _process_image(image_b64)
        vec = extract_embedding_placeholder(img)
        vec_sum = sum(abs(x) for x in vec)
        if vec_sum < 0.1:
            logger.error("Verify: extracted embedding is near-zero, sum=%.6f", vec_sum)
            return {"status": "error", "error": "FACE_DETECTION_FAILED", "score": 0.0}
        norm_vec = l2_normalize(vec)
        logger.info("Verify query embedding: min=%.4f, max=%.4f, sum_abs=%.4f",
                    min(vec), max(vec), vec_sum)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(patron_id)
        if enrolled_emb is None:
            return {"status": "success", "verified": False, "score": 0.0, "error": "Face not enrolled"}
        enrolled_sum = sum(abs(x) for x in enrolled_emb)
        logger.info("Verify enrolled embedding: min=%.4f, max=%.4f, sum_abs=%.4f",
                    min(enrolled_emb), max(enrolled_emb), enrolled_sum)
        score = float(sum(n * e for n, e in zip(norm_vec, enrolled_emb)))
        logger.info("Verify score for patron_id %s (user_id %s): %.4f (query_norm=%.4f, enrolled_norm=%.4f)",
                    patron_id, user_id, score,
                    sum(x*x for x in vec)**0.5,
                    sum(x*x for x in enrolled_emb)**0.5)
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


@celery_app.task(bind=True, max_retries=1, default_retry_delay=5)
def face_login_task(self, email: str, image_b64: str) -> dict:
    logger.info("Face login for %s", email)
    try:
        user_info = None
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
            "SELECT id::text, email, role FROM users WHERE email = %s",
            (email,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            user_info = {"id": row[0], "email": row[1], "role": row[2]}
        if not user_info:
            return {"status": "error", "error": "User not found"}

        _, img = _process_image(image_b64)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        enrolled_emb = _get_milvus().get_embedding_by_user_id(user_info["id"])
        if enrolled_emb is None:
            return {"status": "error", "error": "Face not enrolled. Please enroll first."}
        score = float(sum(n * e for n, e in zip(norm_vec, enrolled_emb)))
        if score < 0.6:
            return {"status": "error", "error": "Face does not match", "score": score}

        liveness = run_liveness_analysis(img)
        is_live = liveness.get("is_live", False)
        if not is_live:
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
        return {
            "status": "success",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "score": score,
        }
    except Exception as exc:
        logger.exception("Face login failed for %s", email)
        return {"status": "error", "error": str(exc)}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def liveness_task(self, image_b64: str) -> dict:
    logger.info("Running liveness check")
    try:
        _, img = _process_image(image_b64)
        result = run_liveness_analysis(img)
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


@celery_app.task(bind=True, name="enroll_face", max_retries=2, default_retry_delay=5)
def enroll_face(self, patron_id: str, image_bytes: str) -> dict:
    logger.info("Enrolling face for patron %s", patron_id)
    try:
        raw_data = base64.b64decode(image_bytes)
        img = safe_read_image_from_bytes(raw_data)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        face_result = detect_face_once(img)
        if not face_result.get("valid"):
            return {"status": "error", "error": face_result.get("error", "No face detected")}
        norm_vec = l2_normalize(face_result["embedding"])
        _get_milvus().upsert_embeddings(user_id=patron_id, embedding=norm_vec)
        encrypted = encrypt_data(raw_data)
        _get_storage().upload_image(f"patrons/{patron_id}.jpg", encrypted)

        # Update PatronFaceModel in Postgres
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
        cur = conn.cursor()
        # Insert or update face record with milvus_id
        cur.execute(
            "SELECT id FROM patron_faces WHERE patron_id = %s AND is_active = true",
            (patron_id,),
        )
        exists = cur.fetchone()
        import uuid as _uuid
        if exists:
            cur.execute(
                "UPDATE patron_faces SET milvus_id = %s, updated_at = NOW() WHERE id = %s",
                (patron_id, exists[0]),
            )
        else:
            cur.execute(
                "INSERT INTO patron_faces (id, patron_id, milvus_id, is_active) VALUES (%s, %s, %s, true)",
                (str(_uuid.uuid4()), patron_id, patron_id),
            )
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success", "patron_id": patron_id, "quality_score": face_result.get("score")}
    except Exception as exc:
        logger.exception("Enroll face failed for %s", patron_id)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=5)
def identify_patron(self, image_bytes: str) -> dict:
    logger.info("Identifying patron from camera frame")
    try:
        raw = base64.b64decode(image_bytes)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        results = _get_milvus().search(embedding=norm_vec, top_k=1)
        if not results or results[0]["score"] < settings.face_match_threshold:
            return {"status": "no_match"}
        hit = results[0]
        patron_id = hit["user_id"]
        score = float(hit["score"])

        # Lookup patron info from Postgres
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT full_name, student_code, membership_expiry, status FROM patrons WHERE id = %s",
            (patron_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            _get_milvus().delete_by_user_id(user_id=patron_id)
            logger.warning("Orphaned embedding cleaned up for %s", patron_id)
            return {"status": "no_match"}

        full_name, student_code, membership_expiry, status = row

        # Check membership
        from datetime import date
        is_expired = membership_expiry and membership_expiry < date.today()
        if is_expired or status != "active":
            return {"status": "expired", "patron_id": patron_id, "full_name": full_name, "student_code": student_code}

        return {
            "status": "matched",
            "patron_id": patron_id,
            "full_name": full_name,
            "student_code": student_code,
            "score": score,
        }
    except Exception as exc:
        logger.exception("Identify patron failed")
        return {"status": "error", "error": str(exc)}


def _is_patron_inside(patron_id: str) -> bool:
    """Check if patron currently has an active entry (inside library).
    Auto-expires after max_entry_hours to prevent stuck 'inside' status.
    """
    try:
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT access_time FROM access_logs WHERE patron_id = %s AND access_type = 'entry' AND status = 'success' AND access_time > NOW() - INTERVAL '%s hours' ORDER BY access_time DESC LIMIT 1",
            (patron_id, settings.max_entry_hours),
        )
        entry = cur.fetchone()
        if not entry:
            cur.close(); conn.close()
            return False
        cur.execute(
            "SELECT COUNT(*) FROM access_logs WHERE patron_id = %s AND access_type = 'exit' AND status = 'success' AND access_time > %s",
            (patron_id, entry[0]),
        )
        count = cur.fetchone()[0]
        cur.close(); conn.close()
        return count == 0
    except Exception as e:
        logger.warning("Failed to check patron inside status for %s: %s", patron_id, e)
        return False


def _publish_camera_event(data: dict) -> None:
    try:
        from infra.redis_pubsub import publish as _pub
        _pub("camera:events", data)
        logger.info("Camera event published: status=%s, camera_id=%s", data.get("status"), data.get("camera_id"))
    except Exception as e:
        logger.error("Failed to publish camera event: %s - data=%s", e, data)


@celery_app.task(bind=True, name="process_camera_frame", max_retries=1, default_retry_delay=5)
def process_camera_frame(self, camera_id: str, image_bytes: str) -> dict:
    logger.info("Processing camera frame from %s", camera_id)
    try:
        raw = base64.b64decode(image_bytes)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)

        # Step 0: Person presence check — filter out non-human objects (mannequins, dolls)
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

        # Step 1: Detect face once - get embedding and face data
        face_result = detect_face_once(img)
        if not face_result.get("valid") or face_result.get("face") is None:
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        face = face_result["face"]
        norm_vec = l2_normalize(face_result["embedding"])
        results = _get_milvus().search(embedding=norm_vec, top_k=1)
        if not results or results[0]["score"] < settings.face_match_threshold:
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        hit = results[0]
        patron_id = hit["user_id"]
        score = float(hit["score"])

        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
        cur = conn.cursor()
        cur.execute(
            "SELECT full_name, student_code, membership_expiry, status FROM patrons WHERE id = %s",
            (patron_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            _get_milvus().delete_by_user_id(user_id=patron_id)
            logger.warning("Orphaned embedding cleaned up for %s from camera %s", patron_id, camera_id)
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        full_name, student_code, membership_expiry, status = row
        from datetime import date
        is_expired = membership_expiry and membership_expiry < date.today()
        if is_expired or status != "active":
            result = {"camera_id": camera_id, "status": "expired", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score}
            _publish_camera_event(result)
            return result

        # Step 2: Liveness (reuse face detection from step 1)
        liveness = liveness_from_face(img, face)
        if not liveness.get("is_live", False):
            result = {
                "camera_id": camera_id, "status": "spoof",
                "patron_id": patron_id, "full_name": full_name, "student_code": student_code,
                "score": score, "liveness_score": liveness.get("liveness_score"),
            }
            _publish_camera_event(result)
            return result

        # Step 3: Determine access type — exact camera ID match
        if camera_id == settings.entry_cam_id:
            access_type = "entry"
            if _is_patron_inside(patron_id):
                logger.info("Wrong direction at entry for %s (%s) — already inside", full_name, student_code)
                result = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type}
                _publish_camera_event(result)
                return result
        elif camera_id == settings.exit_cam_id:
            access_type = "exit"
            if not _is_patron_inside(patron_id):
                logger.info("Wrong direction at exit for %s (%s) — not inside library", full_name, student_code)
                result = {"camera_id": camera_id, "status": "wrong_direction", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score, "access_type": access_type}
                _publish_camera_event(result)
                return result
        else:
            logger.warning("Unknown camera_id: %s — skipping frame", camera_id)
            result = {"camera_id": camera_id, "status": "no_match"}
            _publish_camera_event(result)
            return result

        # Step 4: Create access log in DB (with duplicate check)
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
        cur = conn.cursor()
        # Check most recent access_log of same type
        cur.execute(
            "SELECT EXTRACT(EPOCH FROM (NOW() - access_time)) FROM access_logs WHERE patron_id = %s AND access_type = %s AND status = 'success' ORDER BY access_time DESC LIMIT 1",
            (patron_id, access_type),
        )
        row = cur.fetchone()
        if row and row[0] < settings.access_cooldown_seconds:
            cur.close(); conn.close()
            logger.info("Skipping duplicate %s for %s (%s) — last %s was %.0fs ago", access_type, full_name, student_code, access_type, row[0])
            result = {"camera_id": camera_id, "status": "no_match", "patron_id": patron_id, "full_name": full_name, "student_code": student_code, "score": score}
            _publish_camera_event(result)
            return result
        import uuid as _uuid
        log_id = str(_uuid.uuid4())
        cur.execute(
            """INSERT INTO access_logs (id, patron_id, access_type, verify_method, confidence, camera_id, status, access_time)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())""",
            (log_id, patron_id, access_type, "face", score, camera_id, "success"),
        )
        conn.commit()
        cur.close()
        conn.close()

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
        return result
    except Exception as exc:
        logger.exception("Camera frame processing failed")
        result = {"camera_id": camera_id, "status": "error", "error": str(exc)}
        _publish_camera_event(result)
        return result


@celery_app.task(bind=True, name="verify_face", max_retries=2, default_retry_delay=5)
def verify_face(self, patron_id: str, image_bytes: str) -> dict:
    logger.info("Verifying face for patron %s", patron_id)
    try:
        raw = base64.b64decode(image_bytes)
        img = safe_read_image_from_bytes(raw)
        img = resize_if_necessary(img, max_w=settings.max_image_width, max_h=settings.max_image_height, max_pixels=settings.max_image_pixels)
        vec = extract_embedding_placeholder(img)
        norm_vec = l2_normalize(vec)
        results = _get_milvus().search(embedding=norm_vec, top_k=1)
        if not results:
            return {"status": "error", "error": "No match found"}
        hit = results[0]
        if hit["user_id"] != patron_id or hit["score"] < settings.face_match_threshold:
            return {"status": "error", "error": "Face does not match", "score": float(hit["score"])}
        liveness = run_liveness_analysis(img)
        if not liveness.get("is_live", False):
            return {"status": "error", "error": "Liveness check failed", "is_live": False}

        # Lookup patron info for access log
        parsed = urllib.parse.urlparse(settings.postgres_url)
        conn = psycopg.connect(
            host=parsed.hostname, port=parsed.port or 5432,
            dbname=parsed.path.lstrip("/"), user=parsed.username, password=parsed.password,
        )
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
        import uuid as _uuid
        log_id = str(_uuid.uuid4())
        score = float(hit["score"])
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO access_logs (id, patron_id, access_type, verify_method, confidence, camera_id, status, access_time)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())""",
            (log_id, patron_id, access_type, "face", score, "kiosk", "success"),
        )
        conn.commit()
        cur.close()
        conn.close()

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
        logger.exception("Verify face failed for %s", patron_id)
        return {"status": "error", "error": str(exc)}
