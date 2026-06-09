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
| postgres | postgres | 5432 | PostgreSQL database |
| redis | redis | 6379 | Redis (Celery broker) |
| minio | minio | 9000/9001 | Object storage |
| milvus | milvus | 19530/9091 | Vector database |
| face-recognition-api | face-recognition-api | 8000 | FastAPI application |
| worker | face-recognition-worker | - | Celery worker |
| gateway | api-gateway | 80 | Nginx API Gateway |

## Quick Start

1. Copy `.env.example` to `FaceRecognition_Service/.env`:
```bash
cp FaceRecognition_Service/.env.example FaceRecognition_Service/.env
```

2. Start all services:
```bash
docker compose up -d
```

3. Access:
- API Gateway: http://localhost
- API Docs: http://localhost/docs
- MinIO Console: http://localhost:9001

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

## Environment Variables

See `.env.example` for all required variables.

Key variables:
- `CORS_ORIGINS` - Comma-separated list of allowed origins (default: "*")
- `JWT_*` - JWT configuration
- `POSTGRES_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `MILVUS_HOST` - Milvus server host
- `MINIO_*` - MinIO configuration

## Development

### Run locally (without Docker)
```bash
cd FaceRecognition_Service
poetry install
poetry run uvicorn api.app:create_app --factory --reload
```

### Run tests
```bash
cd FaceRecognition_Service
poetry install --with dev
pytest tests/ -v
```

## Network

All services run on the `face-network` bridge network.

## Frontend Integration

The frontend (in a separate repo: `Frontend_web`) connects to this backend via the API Gateway at `http://localhost/api/`.

For production, update the `NEXT_PUBLIC_API_URL` environment variable in the frontend to point to the deployed gateway URL.