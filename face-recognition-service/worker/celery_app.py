from __future__ import annotations

from celery import Celery

from infra.config import settings


result_backend = settings.celery_result_backend or settings.redis_url

celery_app = Celery(
    "face_recognition",
    broker=settings.celery_broker_url,
    backend=result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_soft_time_limit=300,
    task_time_limit=360,
    worker_max_tasks_per_child=1000,
    result_expires=86400,
)