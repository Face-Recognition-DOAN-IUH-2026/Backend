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
