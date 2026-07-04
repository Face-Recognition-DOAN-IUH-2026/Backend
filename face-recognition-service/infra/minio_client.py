from __future__ import annotations

import logging
from io import BytesIO

from minio import Minio
from minio.error import S3Error

from infra.config import settings

logger = logging.getLogger(__name__)


class MinioStorage:
    def __init__(self) -> None:
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        self.bucket = settings.minio_bucket
        try:
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
        except S3Error as exc:
            if exc.code in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                logger.info("Bucket %s already exists, continuing", self.bucket)
            else:
                raise

    def upload_image(
        self, object_name: str, data: bytes, content_type: str = "image/jpeg"
    ) -> None:
        self.client.put_object(
            self.bucket,
            object_name,
            BytesIO(data),
            length=len(data),
            content_type=content_type,
        )

    def get_image(self, object_name: str) -> bytes:
        response = self.client.get_object(self.bucket, object_name)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def delete_image(self, object_name: str) -> None:
        self.client.remove_object(self.bucket, object_name)
