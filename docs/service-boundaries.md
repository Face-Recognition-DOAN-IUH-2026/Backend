# Service Boundaries

This project currently uses one Postgres container for local development, but each service must still behave as the owner of its own data.

## Ownership Matrix

| Service | Owns | Must Not Own |
| --- | --- | --- |
| `user-service` | users, staff/admin/patron identity, auth | borrow records, access logs, schedule assignments |
| `borrow-service` | books, book copies, borrow records | users, access state/logs, staff schedules |
| `access-service` | access logs, patron access states, realtime access events | users, books, borrow records, staff schedules |
| `schedule-service` | library zones, shifts, schedule templates, assignments, attendance, audit logs | users, borrow records, access logs |
| `face-recognition-service` | face embeddings, enrollment, recognition jobs, Milvus/MinIO face assets | user identity, borrow records, source-of-truth access state |

## Allowed Integration Paths

- `borrow-service -> user-service`: patron lookup by MSSV/id.
- `borrow-service -> access-service`: patron inside/outside status.
- `schedule-service -> user-service`: staff/admin lookup and validation.
- `access-service -> user-service`: enrich access logs/active lists with patron profile.
- `face-recognition-service -> access-service`: submit recognition events.
- `face-recognition-service -> user-service`: user lookup and face-login token/profile flow.

## Rules

1. Do not add foreign keys to tables owned by another service.
2. Store cross-service identifiers as plain UUID/string values.
3. Do not query another service's table directly from application code.
4. If a service is down, fail with a clear `503` instead of guessing state.
5. Keep gateway behavior as routing/proxy only; business rules belong inside owner services.

## Legacy Notes

Some Python files remain in `borrow-service` and `face-recognition-service` for compatibility or migration history.
The runtime owner for borrow behavior is the Node.js `borrow-service`.
Legacy access routes in `face-recognition-service` should be treated as deprecated while gateway `/api/access/*` routes to `access-service`.
