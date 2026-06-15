# Internal Service Contracts

This document defines the private REST contracts between backend services.
Public clients must continue to use the API gateway under `/api/*`.

## Authentication

All internal endpoints require:

```http
x-internal-api-key: ${INTERNAL_API_KEY}
```

Services must return `403` when the key is missing or invalid. Callers should treat `5xx`, timeout, and circuit-open states as `503 Service Unavailable` to the public API.

## user-service

`user-service` is the source of truth for users, staff, admin, and patrons.

### `GET /internal/users/:id`

Returns a single user summary.

```json
{
  "id": "uuid",
  "fullName": "Nguyen Van A",
  "email": "staff@example.com",
  "role": "staff",
  "status": "active",
  "studentCode": "22664321",
  "cardNumber": "LIB-001",
  "currentStatus": "outside",
  "lastEntryAt": null,
  "lastEntryCamera": null
}
```

Notes:
- `studentCode` and `cardNumber` may be `null` for staff/admin.
- `currentStatus` remains legacy compatibility data. New access state should be read from `access-service`.

### `GET /internal/staff`

Returns active and inactive staff/admin summaries.

Optional query:

```http
GET /internal/staff?ids=uuid1,uuid2
```

Response:

```json
[
  {
    "id": "uuid",
    "fullName": "Staff Name",
    "email": "staff@example.com",
    "role": "staff",
    "status": "active"
  }
]
```

## access-service

`access-service` owns access logs, active patron state, access stats, SSE, and WebSocket realtime.

### `POST /internal/access/recognition-events`

Used by face/camera workers to submit recognition results.

Request:

```json
{
  "event_id": "optional-uuid",
  "camera_id": "entry_gate",
  "access_type": "entry",
  "status": "granted",
  "patron_id": "uuid",
  "student_code": "22664321",
  "full_name": "Nguyen Van A",
  "score": 0.91,
  "bbox": null,
  "landmarks": null,
  "occurred_at": "2026-06-16T09:00:00.000Z",
  "source": "face-recognition-service",
  "image_url": null
}
```

Allowed `status` values:

```text
granted, no_match, spoof, expired, wrong_direction, already_granted, error
```

Compatibility aliases accepted by `access-service`:

```text
success -> granted
unknown -> no_match
```

Response:

```json
{
  "ok": true,
  "event": {
    "event_id": "uuid",
    "event_type": "camera_event",
    "camera_id": "entry_gate",
    "access_type": "entry",
    "status": "granted",
    "patron_id": "uuid",
    "student_code": "22664321",
    "full_name": "Nguyen Van A",
    "score": 0.91,
    "bbox": null,
    "landmarks": null,
    "occurred_at": "2026-06-16T09:00:00.000Z",
    "source": "face-recognition-service",
    "image_url": null
  }
}
```

Rules:
- `entry_gate` records only `entry`.
- `exit_gate` records only `exit`.
- `kiosk` may auto-toggle based on current state.
- Only `status=granted` with `patron_id` and `access_type` writes logs/state.
- All events may still be broadcast realtime for UI feedback.

### `GET /internal/access/patrons/:id/status`

Used by `borrow-service` to check whether a patron is inside.

Response:

```json
{
  "patron_id": "uuid",
  "current_status": "inside",
  "currentStatus": "inside",
  "last_entry_at": "2026-06-16T09:00:00.000Z",
  "lastEntryAt": "2026-06-16T09:00:00.000Z",
  "last_entry_camera": "entry_gate",
  "lastEntryCamera": "entry_gate"
}
```

### `POST /internal/access/patrons/:id/status`

Admin repair and migration only. Normal camera/access flows must use recognition events.

Request:

```json
{
  "current_status": "inside",
  "camera_id": "manual"
}
```

## Realtime Event Contract

Web uses SSE:

```http
GET /api/access/events
```

Mobile uses WebSocket:

```http
GET /api/access/ws?token=<jwt>
```

Both streams send the same `camera_event` payload from `AccessRealtimeEvent`.

Required fields:

```text
event_id, event_type, camera_id, status, occurred_at, source
```

Nullable fields:

```text
access_type, patron_id, student_code, full_name, score, bbox, landmarks, image_url
```

## Ownership Rules

- `user-service` owns user identity and staff/patron profile.
- `access-service` owns access logs and patron inside/outside state.
- `borrow-service` owns books, copies, and borrow records.
- `schedule-service` owns zones, shifts, schedules, attendance, and schedule audit logs.
- Cross-service reads must use internal REST, not shared table queries.
