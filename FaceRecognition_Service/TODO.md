# FaceRecognition Platform - TODO

## Step 1: Project Skeleton
- [x] Create directory structure (api, worker, core, infra, tests, docs)
- [x] Add pyproject/requirements + base config
- [x] Add .env.example

## Step 2: Core Models (Clean Architecture)
- [x] Define Pydantic schemas and domain models
- [x] Define interfaces for repositories and services

## Step 3: Milvus Integration
- [x] Create Milvus client wrapper
- [x] Create EmbeddingRepository implementation (create collection, upsert, search)

## Step 4: Celery Tasks + Inference Pipeline
- [x] Configure Celery (Redis broker)
- [x] Implement tasks: enroll, verify, identify, liveness, delete
- [x] Implement OpenCV safe image loading + resize + memory cleanup

## Step 5: API Routers (FastAPI async)
- [x] Implement auth (JWT access/refresh) + RBAC dependencies
- [x] Implement endpoints for enroll/verify/identify/liveness/delete
- [x] Enqueue Celery jobs and return job_id
- [x] Implement cooldown policy using Redis

## Step 6: Privacy by Design
- [x] Configure object storage client (MinIO)
- [x] Store encrypted raw images (or local encrypted fallback)
- [x] Ensure delete cascades to Postgres + Milvus + storage

## Step 7: DevOps
- [x] Add Dockerfiles (api, worker)
- [x] Add docker-compose.yml (api, worker, postgres, redis, milvus, minio)

## Step 8: Tests
- [x] Pytest setup
- [x] Unit tests for cooldown + repositories (mock) + auth token utilities
- [x] Ensure coverage >= 80%

## Step 9: Documentation
- [x] README.md with architecture, env config, swagger link
- [x] Code samples for React Native / Flutter multipart upload
