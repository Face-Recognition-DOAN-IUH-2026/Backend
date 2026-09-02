"""Repository-wide pytest environment defaults.

These values keep test collection independent from a developer's untracked `.env` file.
"""

from __future__ import annotations

import os

TEST_ENVIRONMENT = {
    "ENV": "test",
    "JWT_ISSUER": "face-recognition",
    "JWT_AUDIENCE": "face-recognition-users",
    "JWT_ACCESS_SECRET": "test-access-secret-that-is-long-enough",
    "JWT_REFRESH_SECRET": "test-refresh-secret-that-is-long-enough",
    "SERVICE_JWT_SECRET": "test-service-secret-that-is-long-enough",
    "REDIS_URL": "redis://localhost:6379/0",
    "POSTGRES_URL": "postgresql+psycopg://postgres:test@localhost:5432/facedb",
    "MINIO_ENDPOINT": "localhost:9000",
    "MINIO_ACCESS_KEY": "test-minio-access",
    "MINIO_SECRET_KEY": "test-minio-secret-that-is-long-enough",
    "MINIO_BUCKET": "face-test",
    "MILVUS_HOST": "localhost",
    "DATA_ENCRYPTION_KEY": "test-encryption-key-that-is-long-enough",
    "CELERY_BROKER_URL": "amqp://test:test@localhost:5672",
    "RABBITMQ_URL": "amqp://test:test@localhost:5672",
}

for environment_name, environment_value in TEST_ENVIRONMENT.items():
    os.environ.setdefault(environment_name, environment_value)
