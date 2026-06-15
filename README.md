# Face Recognition Platform - Backend

Microservices backend for a library face-recognition access system. The stack uses an Express/Node.js API Gateway, FastAPI face-recognition service, Celery workers, Redis, Milvus, MinIO, PostgreSQL, and Node.js services for users, borrow/return, access, and staff schedules.

## Architecture

```text
Backend/
├── api-gateway/                 # Express API Gateway, routes /api/* to services
├── user-service/                # Node.js user/auth service, owner of users
├── borrow-service/              # Node.js borrow/book service
├── access-service/              # Node.js access logs, active state, SSE/WS
├── schedule-service/            # Node.js staff schedule service
├── face-recognition-service/    # FastAPI API, Celery worker, face modules
├── docker-compose.yml           # Starts all backend services
└── .env.example
```

## Services

| Service | Container | Port | Description |
| --- | --- | --- | --- |
| postgres | backend-postgres-1 | 5432 | PostgreSQL database |
| redis | backend-redis-1 | 6379 | Redis cache and Celery broker |
| minio | backend-minio-1 | 9000/9001 | Object storage |
| milvus | backend-milvus-1 | 19530/9091 | Vector database |
| face-recognition-api | face-recognition-api | 8000 | FastAPI face, camera, kiosk APIs |
| worker | backend-worker-* | - | Celery worker |
| gateway | api-gateway | 80 | Express/Node.js API Gateway |
| user-service | user-service | 3001 | User/auth service |
| borrow-service | borrow-service | 8000 internal | Node.js borrow/book service |
| access-service | access-service | 3003 internal | Access logs, active state, SSE/WS |
| schedule-service | schedule-service | 3002 internal | Staff schedule service |

## Clone And Run

1. Copy environment files:

```powershell
cd D:\IUH\DOAN_TOTNGHIEP\Backend
copy .env.example .env
copy api-gateway\.env.example api-gateway\.env
copy user-service\.env.example user-service\.env
```

2. Start backend services:

```powershell
docker compose up -d --build
```

3. Verify:

```powershell
docker compose ps
curl http://localhost/healthz
curl http://localhost/openapi.json
```

Docker builds the TypeScript services during image build. For local development outside Docker, run `npm install && npm run build` in `api-gateway`, `user-service`, `borrow-service`, `access-service`, and `schedule-service`.

## Access Points

| Service | URL | Notes |
| --- | --- | --- |
| API Gateway | http://localhost | Public backend entry point |
| API Docs | http://localhost/docs | Face-recognition OpenAPI docs |
| OpenAPI JSON | http://localhost/openapi.json | Face-recognition OpenAPI schema |
| MinIO Console | http://localhost:9001 | `minioadmin / minioadmin` by default |

## Key API Smoke Tests

- `GET /healthz`
- `GET /openapi.json`
- `POST /auth/login`
- `POST /api/auth/face-login`
- `POST /api/face/enroll-batch`
- `GET /api/tasks/{job_id}`
- `GET /api/camera/status`
- `GET /api/access/stats`
- `GET /api/borrow/books`

## Access Flow Rules

- `POST /api/auth/face-login` only authenticates and returns tokens.
- Face login does not update `users.current_status`.
- Face login does not insert access logs.
- Entry camera only records `entry`.
- Exit camera only records `exit`.
- Kiosk may auto-toggle entry/exit from the current user status.
- `user-service` owns `users`.
- `access-service` owns access logs, active patron state, SSE, and WebSocket realtime.
- Face worker records physical access through `POST /internal/access/recognition-events`.

## Common Errors

### Build or clone setup fails

Run from the backend root:

```powershell
copy .env.example .env
docker compose up -d --build
```

For local TypeScript checks:

```powershell
cd api-gateway
npm install
npm run build

cd ..\user-service
npm install
npm run build
```

### Port 80 is already allocated

Find and stop the process using port 80, or change the gateway port mapping in `docker-compose.yml`.

```powershell
netstat -ano | findstr :80
taskkill /PID <pid> /F
```

### Worker keeps restarting

Wait until PostgreSQL, Redis, MinIO, and Milvus are healthy, then restart the worker:

```powershell
docker compose ps
docker compose logs worker
docker compose restart worker
```

### Milvus is unhealthy

Milvus needs enough memory and healthy dependencies. If this is a local demo reset and data can be removed:

```powershell
docker compose down
docker volume prune
docker compose up -d --build
```

## Local Tests

```powershell
cd api-gateway
npm install
npm run build

cd ..\user-service
npm install
npm run build

cd ..\borrow-service
npm install
npm run build

cd ..\access-service
npm install
npm run build

cd ..\schedule-service
npm install
npm run build

cd ..
node scripts\check-service-boundaries.js

cd ..\face-recognition-service
python -m py_compile worker\tasks.py

cd ..\borrow-service
pytest
```
