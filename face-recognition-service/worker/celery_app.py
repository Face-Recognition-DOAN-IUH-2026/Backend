from __future__ import annotations

from celery import Celery

from infra.config import settings


celery_app = Celery(
    "face_recognition",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_soft_time_limit=120,
    task_time_limit=180,
    worker_max_tasks_per_child=1000,
)