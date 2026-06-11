from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("recover_milvus")

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from infra.config import settings
from infra.milvus_client import MilvusClient
from infra.minio_client import MinioStorage
from infra.crypto import decrypt_data

from core.embedding import l2_normalize

ENGINE = create_engine(settings.postgres_url)


def get_all_patron_faces():
    with Session(ENGINE) as session:
        rs = session.execute(
            text("SELECT patron_id, milvus_id FROM patron_faces WHERE is_active = true")
        )
        return [{"patron_id": str(r[0]), "milvus_id": str(r[1]) if r[1] else None} for r in rs]


def get_milvus_ids(client: MilvusClient) -> set[str]:
    results = client.collection.query(expr="", output_fields=["user_id"], limit=10000)
    return {r["user_id"] for r in results}


def get_embedding_from_milvus(client: MilvusClient, user_id: str) -> list[float] | None:
    return client.get_embedding_by_user_id(user_id)


def re_enroll_patron(patron_id: str, client: MilvusClient, storage: MinioStorage) -> bool:
    raw = None
    for prefix in ("patrons", "enrollments"):
        try:
            raw = storage.get_image(f"{prefix}/{patron_id}.jpg")
            logger.info("Found image at %s/%s.jpg", prefix, patron_id)
            break
        except Exception:
            continue
    if raw is None:
        logger.warning("No image found for patron %s in MinIO, skipping", patron_id)
        return False
    decrypted = raw
    try:
        decrypted = decrypt_data(raw)
    except Exception:
        logger.info("Decryption failed for %s, trying raw bytes", patron_id)
    from worker.tasks_pipeline import extract_embedding_placeholder, safe_read_image_from_bytes
    try:
        img = safe_read_image_from_bytes(decrypted)
    except Exception:
        if decrypted is not raw:
            try:
                img = safe_read_image_from_bytes(raw)
            except Exception:
                logger.warning("Cannot decode image for patron %s (both encrypted and raw)", patron_id)
                return False
        else:
            logger.warning("Cannot decode image for patron %s", patron_id)
            return False
    if img is None:
        logger.warning("Failed to decode image for patron %s", patron_id)
        return False
    vec = extract_embedding_placeholder(img)
    vec_sum = float(np.sum(np.abs(np.array(vec, dtype=np.float32))))
    if vec_sum < 0.1:
        logger.warning("Near-zero embedding for patron %s (sum=%.4f), skipping", patron_id, vec_sum)
        return False
    norm_vec = l2_normalize(vec)
    client.upsert_embeddings(user_id=patron_id, embedding=norm_vec)
    logger.info("Recovered embedding for patron %s", patron_id)
    return True


def main():
    parser = argparse.ArgumentParser(description="Recover missing Milvus embeddings from MinIO image backups")
    parser.add_argument("--dry-run", action="store_true", help="Only report missing embeddings, do not recover")
    args = parser.parse_args()

    client = MilvusClient(
        host=settings.milvus_host,
        port=settings.milvus_port,
        collection_name=settings.milvus_collection,
        dim=512,
    )
    storage = MinioStorage()

    faces = get_all_patron_faces()
    milvus_ids = get_milvus_ids(client)

    logger.info("Patron faces in DB: %d", len(faces))
    logger.info("Embeddings in Milvus: %d", len(milvus_ids))

    missing = [f for f in faces if f["patron_id"] not in milvus_ids]
    orphan = milvus_ids - {f["patron_id"] for f in faces}

    if orphan:
        logger.warning("Orphan embeddings (in Milvus, no patron_face record): %s", sorted(orphan))

    if not missing:
        logger.info("All patron faces are synced to Milvus. Nothing to recover.")
        return

    logger.info("Missing embeddings (%d): %s", len(missing), [f["patron_id"] for f in missing])

    if args.dry_run:
        logger.info("Dry-run mode. Use --no-dry-run to recover.")
        return

    recovered = 0
    for face in missing:
        pid = face["patron_id"]
        logger.info("Recovering %s...", pid)
        if re_enroll_patron(pid, client, storage):
            recovered += 1

    logger.info("Recovered %d / %d missing embeddings", recovered, len(missing))


if __name__ == "__main__":
    main()
