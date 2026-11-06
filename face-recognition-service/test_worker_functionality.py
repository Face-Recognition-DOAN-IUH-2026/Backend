"""
Test script cho cac chuc nang lien quan den Celery worker.
Test truc tiep qua Celery + Redis (khong can thiep qua HTTP API).
Chay: python test_worker_functionality.py
"""
from __future__ import annotations

import os as _os
import sys
import time
import uuid as _uuid
from pathlib import Path

# Load .env truoc khi import pydantic settings
from dotenv import load_dotenv

env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)

# ==================== CAU HINH ====================
# Chay trong container Docker, dung ten service Docker.
# Luu temp frame vao Redis db 0 (giong worker), result backend vao db 1 (xem Backend/.env)
REDIS_TEMP_DB = "redis://:iuh2026redis@redis:6379/0"
REDIS_RESULT_DB = "redis://:iuh2026redis@redis:6379/1"

# Override Celery broker/backend (phai set TRUOC khi import celery_app)
_os.environ["CELERY_BROKER_URL"] = "amqp://guest:guest@rabbitmq:5672//"
_os.environ["CELERY_RESULT_BACKEND"] = REDIS_RESULT_DB
_os.environ["REDIS_URL"] = REDIS_RESULT_DB

import cv2
import numpy as np
import redis as redis_lib
from worker.celery_app import celery_app

results: list[dict] = []


def log_test(name, passed, detail=""):
    status = "PASS" if passed else "FAIL"
    results.append({"name": name, "passed": passed, "detail": detail})
    print(f"[{status}] {name} {detail}")


# --- TEST 1: Redis result backend connectivity ---
def test_redis_result_backend():
    try:
        r = redis_lib.Redis.from_url(REDIS_RESULT_DB)
        r.ping()
        test_key = f"worker_test:{_uuid.uuid4()}"
        r.setex(test_key, 10, "ok")
        val = r.get(test_key)
        r.delete(test_key)
        ok = val == b"ok"
        log_test("Redis result backend connectivity", ok, f"-> PING OK, readback={val}")
    except Exception as e:
        log_test("Redis result backend connectivity", False, f"-> {e}")


# --- TEST 2: Worker registered (Celery inspect) ---
def test_worker_registered():
    try:
        inspect = celery_app.control.inspect(timeout=10)
        stats = inspect.stats()
        ok = stats is not None and len(stats) > 0
        worker_names = list(stats.keys()) if stats else []
        log_test("Worker registered (Celery inspect)", ok, f"-> workers={worker_names}")
    except Exception as e:
        log_test("Worker registered (Celery inspect)", False, f"-> {e}")


# --- TEST 3: Worker tasks registered ---
def test_worker_tasks():
    try:
        inspect = celery_app.control.inspect(timeout=10)
        registered = inspect.registered()
        ok = registered is not None and len(registered) > 0
        all_tasks = []
        for worker, tasks in (registered or {}).items():
            all_tasks.extend(tasks)
        face_tasks = [t for t in all_tasks if any(k in t.lower() for k in
                    ("face", "enroll", "verify", "identify", "process", "liveness", "delete"))]
        log_test("Worker tasks registered", ok, f"-> {len(all_tasks)} tasks, face-related={len(face_tasks)}")
    except Exception as e:
        log_test("Worker tasks registered", False, f"-> {e}")


# --- TEST 4: Liveness task (direct Celery) ---
def test_liveness_direct():
    try:
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        img[:] = (128, 128, 128)
        cv2.circle(img, (50, 50), 30, (255, 255, 255), -1)
        _, buf = cv2.imencode(".jpg", img)
        raw = buf.tobytes()

        # Luu vao Redis db 0 (giong worker doc tu day)
        r_temp = redis_lib.Redis.from_url(REDIS_TEMP_DB)
        object_key = f"temp_frames/test_{_uuid.uuid4()}.jpg"
        r_temp.setex(f"temp_frame:{object_key}", 120, raw)

        # Gui task truc tiep qua Celery
        task = celery_app.send_task(
            "worker.tasks.liveness_task",
            kwargs={"object_key": object_key},
        )

        task_result = celery_app.AsyncResult(task.id)
        final_status = None
        final_result = None
        for _ in range(30):
            time.sleep(1)
            final_status = task_result.status
            if final_status in ("SUCCESS", "FAILURE"):
                final_result = task_result.result
                break

        ok = final_status == "SUCCESS"
        log_test("Liveness task (direct Celery)", ok, f"-> status={final_status} result={final_result}")

        # Cleanup
        try:
            r_temp.delete(f"temp_frame:{object_key}")
        except Exception:
            pass
    except Exception as e:
        log_test("Liveness task (direct Celery)", False, f"-> {e}")


# --- TEST 5: Identify task (direct Celery) ---
def test_identify_direct():
    try:
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        img[:] = (128, 128, 128)
        cv2.circle(img, (50, 50), 30, (255, 255, 255), -1)
        _, buf = cv2.imencode(".jpg", img)
        raw = buf.tobytes()

        r_temp = redis_lib.Redis.from_url(REDIS_TEMP_DB)
        object_key = f"temp_frames/test_{_uuid.uuid4()}.jpg"
        r_temp.setex(f"temp_frame:{object_key}", 120, raw)

        task = celery_app.send_task(
            "worker.tasks.identify_task",
            kwargs={"object_key": object_key},
        )

        task_result = celery_app.AsyncResult(task.id)
        final_status = None
        final_result = None
        for _ in range(30):
            time.sleep(1)
            final_status = task_result.status
            if final_status in ("SUCCESS", "FAILURE"):
                final_result = task_result.result
                break

        ok = final_status == "SUCCESS"
        log_test("Identify task (direct Celery)", ok, f"-> status={final_status} result={final_result}")

        try:
            r_temp.delete(f"temp_frame:{object_key}")
        except Exception:
            pass
    except Exception as e:
        log_test("Identify task (direct Celery)", False, f"-> {e}")


# --- CHINH ---
if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    print("=" * 60)
    print("BAT DAU TEST CAC CHUC NANG LIEN QUAN DEN WORKER")
    print("=" * 60)

    test_redis_result_backend()
    test_worker_registered()
    test_worker_tasks()
    test_liveness_direct()
    test_identify_direct()

    print("=" * 60)
    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"KET QUA: {passed}/{total} test thanh cong")
    for r in results:
        mark = "PASS" if r["passed"] else "FAIL"
        print(f"  [{mark}] {r['name']}")
    print("=" * 60)

    sys.exit(0 if passed == total else 1)
