# Face Recognition Platform

Microservices face recognition platform built with FastAPI, Celery, Milvus, and PostgreSQL.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│  FastAPI     │────▶│   Celery     │────▶│  Milvus  │
│  (api/)      │     │  (worker/)   │     │ (vector) │
└─────────────┘     └──────────────┘     └──────────┘
       │                    │
       ▼                    ▼
  ┌─────────┐        ┌──────────┐
  │ Postgres │        │  Redis   │
  │ (users)  │        │ (broker) │
  └─────────┘        └──────────┘
       │
       ▼
  ┌──────────┐
  │  MinIO   │
  │ (images) │
  └──────────┘
```

## Quick Start

1. Copy `.env.example` to `.env` and adjust values.

2. Start all services:
```bash
docker compose up -d
```

3. API docs available at `http://localhost:8000/docs`

## Database migrations

Face API and Celery workers never create or alter tables during startup. Alembic is the only schema-change mechanism.

```powershell
poetry run alembic upgrade head
poetry run alembic current
```

The baseline migration supports both a fresh database and an existing unversioned `patron_faces` table. Back up an existing database before the first migration. A downgrade of the baseline drops `patron_faces`, so it must not be used as an automatic production rollback.

At the repository root, `docker compose up` uses the dedicated `face-recognition-migrate` service and gates Face API/worker startup on successful migration completion. To run the same container step explicitly:

```powershell
docker compose run --rm face-recognition-migrate
```

## Kubernetes rollout

Create `face-recognition-secrets` using the cluster's secret-management mechanism. The required key names are documented in `../k8s/face-recognition-secrets.example.yaml`; do not apply or commit a populated copy.

Deploy in this order:

```powershell
kubectl apply -f ../k8s/face-recognition.yaml
kubectl wait --for=condition=complete job/face-recognition-migration-202609020001 --timeout=180s
kubectl logs job/face-recognition-migration-202609020001
kubectl apply -f ../k8s/face-recognition-workloads.yaml
kubectl rollout status deployment/face-recognition-api
kubectl rollout status deployment/face-recognition-worker
```

If the migration Job fails, do not apply the workload manifest. Inspect the Job logs, correct the migration/configuration, and verify schema compatibility before retrying. Each future migration release must use a new immutable Job name so Kubernetes executes it exactly once.

The API image, worker image, and migration Job must use the same immutable image tag in a release.

## Production verification

From `Backend/`:

```powershell
.\scripts\verify-production-readiness.ps1
```

Use `-RunMigration` only when `POSTGRES_URL` points to a disposable verification database.

## API Endpoints

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

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |

## Project Structure

```
├── api/            FastAPI application
│   ├── app.py
│   ├── dependencies.py
│   └── routers/
├── core/           Domain models & interfaces
│   ├── embedding.py
│   ├── repositories.py
│   ├── schemas.py
│   └── security.py
├── infra/          Implementations
│   ├── config.py
│   ├── cooldown.py
│   ├── crypto.py
│   ├── database.py
│   ├── embedding_repository.py
│   ├── milvus_client.py
│   ├── minio_client.py
│   ├── models.py
│   └── user_repository.py
├── worker/         Celery background tasks
│   ├── celery_app.py
│   ├── tasks.py
│   └── tasks_pipeline.py
└── tests/
```

## Mobile Integration

### React Native
```typescript
const formData = new FormData();
formData.append('file', {
  uri: imageUri,
  type: 'image/jpeg',
  name: 'face.jpg',
});
formData.append('consent_given', 'true');
formData.append('target_user_id', userId);

const response = await fetch(`${API_URL}/face/verify`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
  },
  body: formData,
});
const { job_id } = await response.json();
```

### Flutter
```dart
final request = http.MultipartRequest(
  'POST',
  Uri.parse('$apiUrl/face/enroll'),
);
request.headers['Authorization'] = 'Bearer $token';
request.files.add(await http.MultipartFile.fromPath('file', imagePath));
request.fields['consent_given'] = 'true';

final response = await request.send();
final body = await response.stream.bytesToString();
final jobId = jsonDecode(body)['job_id'];
```
