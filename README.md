# Face Recognition Platform - Backend

Microservices backend for face recognition, built with FastAPI, Celery, Milvus, and PostgreSQL.

## Architecture

```
Backend/
├── api-gateway/
│   └── nginx.conf          # API Gateway (Nginx) - routes /api/* to FastAPI
├── FaceRecognition_Service/
│   ├── api/                # FastAPI application
│   ├── core/               # Domain models & interfaces
│   ├── infra/              # Implementations (DB, Milvus, MinIO, Redis)
│   ├── worker/             # Celery background tasks
│   └── tests/
├── docker-compose.yml       # Root compose - starts ALL backend services
└── .env.example
```

## Services

| Service | Container Name | Port | Description |
|---------|----------------|------|-------------|
| postgres | backend-postgres-1 | 5432 | PostgreSQL database |
| redis | backend-redis-1 | 6379 | Redis (Celery broker) |
| minio | backend-minio-1 | 9000/9001 | Object storage |
| milvus | backend-milvus-1 | 19530/9091 | Vector database |
| face-recognition-api | face-recognition-api | 8000 | FastAPI application |
| worker | backend-worker-* | - | Celery worker (3 replicas) |
| gateway | api-gateway | 80 | Nginx API Gateway |
| user-service | user-service | 3001 | User management service |

---

## Installation

### Prerequisites

- Docker Desktop (latest version)
- 8GB+ RAM recommended (for Milvus and worker containers)
- ~10GB free disk space

### Step 1: Setup Environment

Copy `.env.example` to `.env` in Backend root:

```bash
cd D:/IUH/test/Backend
copy .env.example .env
```

Or create `.env` manually with required variables:

```env
# PostgreSQL
POSTGRES_DB=face_recognition
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# JWT
JWT_SECRET=your-secret-key-min-32-chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# Services
REDIS_URL=redis://redis:6379/0
POSTGRES_URL=postgresql://postgres:postgres@postgres:5432/face_recognition
MILVUS_HOST=milvus
MILVUS_PORT=19530

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=face-recognition

# CORS
CORS_ORIGINS=*

# Face Recognition
INSIGHTFACE_MODEL=buffalo_l
```

### Step 2: Build TypeScript Services

Before running Docker, build the TypeScript services:

```bash
cd D:/IUH/test/Backend

# Build user-service
cd user-service
npm install
npm run build

# Build api-gateway
cd ../api-gateway
npm install
npm run build

# Return to Backend root
cd ..
```

### Step 3: Start Services

```bash
cd D:/IUH/test/Backend
docker-compose up -d --build
```

### Step 4: Verify

```bash
docker-compose ps
```

All services should show `Up` or `Healthy` status.

### Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| API Gateway | http://localhost | - |
| API Docs | http://localhost/docs | - |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| MinIO API | http://localhost:9000 | minioadmin / minioadmin |

---

## Common Errors & Fixes

### 1. "dist folder not found" / Build fails for user-service or api-gateway

**Cause:** TypeScript not compiled before Docker build.

**Fix:**
```bash
cd D:/IUH/test/Backend/user-service
npm install
npm run build

cd ../api-gateway
npm install
npm run build
```

### 2. Containers stuck in "starting" state

**Cause:** Dependencies not healthy yet (postgres, redis, minio, milvus).

**Fix:** Wait for dependent services to become healthy:
```bash
docker-compose ps  # Check health status
docker-compose logs <service-name>  # View logs
```

### 3. Worker containers keep restarting

**Cause:** Usually due to missing model files or Redis connection issues.

**Fix:**
```bash
docker-compose logs worker
# Check for "Connection refused" or model download errors

# Restart workers after other services are healthy
docker-compose restart worker
```

### 4. Port conflicts

**Error:** `Bind for 0.0.0.0:80 failed: port is already allocated`

**Fix:** Stop other services using port 80:
```powershell
# Find and stop the process using port 80
netstat -ano | findstr :80
taskkill /PID <pid> /F
```

Or change the gateway port in `docker-compose.yml`:
```yaml
gateway:
  ports:
    - "8080:80"  # Change to 8080:80
```

### 5. Milvus container unhealthy

**Cause:** Insufficient memory or etcd issues.

**Fix:**
```bash
docker-compose down
docker volume prune  # Remove old volumes (WARNING: deletes data)
docker-compose up -d
```

### 6. "Cannot find module 'dotenv'" errors during local development

**Fix:**
```bash
cd D:/IUH/test/Backend/user-service
npm install dotenv

cd ../api-gateway
npm install dotenv
```

### 7. Redis connection refused

**Cause:** Redis not ready when worker starts.

**Fix:**
```bash
docker-compose restart worker
```

---

## Development

### Run locally (without Docker)

```bash
cd D:/IUH/test/Backend/FaceRecognition_Service
poetry install
poetry run uvicorn api.app:create_app --factory --reload
```

### Run tests

```bash
cd D:/IUH/test/Backend/FaceRecognition_Service
poetry install --with dev
pytest tests/ -v
```

### View logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f face-recognition-api
docker-compose logs -f worker

# Last 100 lines
docker-compose logs --tail=100 worker
```

### Stop services

```bash
docker-compose down

# Stop and remove volumes (WARNING: deletes all data)
docker-compose down -v
```

### Rebuild specific service

```bash
docker-compose up -d --build face-recognition-api
```

---

## API Endpoints

All API calls go through the gateway at `http://localhost/api/`

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login, returns JWT tokens |
| POST | `/auth/refresh` | Refresh access token |

### Face Recognition
| Method | Path | Description |
|--------|------|-------------|
| POST | `/face/enroll` | Enroll face (multipart) |
| POST | `/face/verify` | Verify face against user |
| POST | `/face/identify` | Identify unknown face |
| POST | `/face/liveness` | Passive liveness check |
| DELETE | `/face/{user_id}` | Delete face data (admin) |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks/{task_id}` | Poll Celery task status |

### Users (Admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users` | List all users |
| GET | `/users/me` | Current user info |
| DELETE | `/users/{user_id}` | Delete user (admin) |

---

## Environment Variables

See `.env.example` for all required variables.

Key variables:
- `CORS_ORIGINS` - Comma-separated list of allowed origins (default: "*")
- `JWT_*` - JWT configuration
- `POSTGRES_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MILVUS_HOST` - Milvus server host
- `MINIO_*` - MinIO configuration

---

## Network

All services run on the `face-network` bridge network.

## Frontend Integration

The frontend (in `Frontend_Web_Test/`) connects to this backend via the API Gateway at `http://localhost/api/`.

For production, update the `NEXT_PUBLIC_API_URL` environment variable in the frontend to point to the deployed gateway URL.