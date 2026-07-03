# Microservice Architecture Rules

## 1. Edge And Gateway

- The public HTTP edge is the Express/Node.js API Gateway in `api-gateway`.
- Frontend and mobile clients call backend APIs through the gateway.
- Services should communicate on the Docker internal network unless a port is explicitly exposed for local debugging.
- Gateway routes requests only; it must not own business state.

## 2. Gateway Does Not Call Infrastructure Directly

- Wrong: Gateway -> PostgreSQL / Redis / Milvus / MinIO.
- Correct: Gateway -> Service -> Infrastructure.
- Gateway talks to services over HTTP.

## 3. Service-To-Service Communication

- Sync communication uses REST over the internal Docker network.
- Internal service calls use Service JWT (`Authorization: Bearer <token>`) with the shared `SERVICE_JWT_SECRET`.
- Async work currently uses RabbitMQ (with fanout exchanges) and Celery (Python).
- Services should not call each other through the public API Gateway.

## 4. Data Ownership

- `user-service` owns `users`, auth data, staff/admin/patron identity, and profile fields.
- `access-service` owns `access_logs`, patron inside/outside state, access stats, SSE, and WebSocket realtime.
- `face-recognition-service` owns face enrollment, embeddings, Milvus, MinIO evidence, and recognition jobs.
- `borrow-service` owns borrow/book data and asks `user-service` or `access-service` when it needs user/access state.
- `schedule-service` owns library zones, shifts, schedule assignments, attendance, and schedule audit logs.
- A service that needs data owned by another service should call that service's internal API instead of querying its tables directly.

## 5. Face And Access Boundary

- Face login only authenticates and returns tokens.
- Camera entry/exit and kiosk flows are responsible for recording physical access.
- Entry camera writes `entry` events only.
- Exit camera writes `exit` events only.
- Kiosk may auto-toggle entry/exit based on current user status.
- Face worker sends recognition/access results to `access-service` through `POST /internal/access/recognition-events`.
- `access-service` is the source of truth for access logs and patron inside/outside state.
- Legacy access routes in `face-recognition-service` are deprecated while gateway `/api/access/*` routes to `access-service`.

## 6. Service-to-Service JWT

- Service-to-service calls use header `Authorization: Bearer <service-token>`.
- Tokens are signed with `SERVICE_JWT_SECRET` (HS256) and include `sub`, `scope`, `typ: 'service'`, `iat`, `exp`.
- Use `getServiceToken()` from `shared/auth/serviceToken` (Node.js) or `get_service_token()` from `core.service_token` (Python).
- The secret must be identical across all services.

## 7. Shared State And Redis

- Redis is used for Celery broker/result backend, temporary camera frame cache, throttling/cooldowns, and pub/sub events.
- Each service owns its Redis keys and should use clear prefixes.
- Gateway rate limiting should remain at gateway/edge level and not require DB access.

## 8. Configuration

- Configuration must come from environment variables.
- Keep `.env.example` files complete enough for clone-and-run.
- Do not commit `.env`, `.env.local`, test output, build artifacts, or local cache folders.
- Docker Compose is the local integration source of truth.

## 9. Health And Readiness

- Each service should expose an alive endpoint.
- Services with dependencies should expose readiness checks when possible.
- Smoke checks after changes should include gateway `/healthz`, `/openapi.json`, auth login, face login, access stats, and borrow books.
- Run `node scripts/check-service-boundaries.js` before pushing service-boundary changes.

## 10. Validation And Shutdown

- Each service validates its own inputs.
- Services should handle shutdown signals and close DB/Redis/Milvus/MinIO clients cleanly.
