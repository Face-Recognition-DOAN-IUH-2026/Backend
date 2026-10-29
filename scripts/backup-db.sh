#!/usr/bin/env bash
# =============================================================================
# Backup toàn bộ Postgres (mọi database của service) ra file .sql.gz
# Cách dùng:  sudo bash backup-db.sh
# Cron gợi ý (03:00 mỗi ngày):  0 3 * * * root bash /opt/iuh-backend/scripts/backup-db.sh
# Giữ file backup 7 ngày (đổi qua BACKUP_KEEP_DAYS).
# =============================================================================
set -euo pipefail

DIR="${BACKEND_DIR:-/opt/iuh-backend}"
OUT_DIR="${BACKUP_DIR:-/var/backups/iuhlib}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/pg-all-$TS.sql.gz"

cd "$DIR"

echo "==> Backup Postgres → $OUT"
$COMPOSE exec -T postgres sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}" --clean --if-exists' \
  | gzip >"$OUT"

# Đảm bảo file không rỗng (rollback an toàn)
gzip -t "$OUT"
[ "$(stat -c%s "$OUT")" -gt 1024 ] || { echo "LỖI: backup rỗng"; rm -f "$OUT"; exit 1; }

find "$OUT_DIR" -name 'pg-all-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "✅ Xong: $OUT ($(du -h "$OUT" | cut -f1))"
echo "   Restore: gunzip -c $OUT | docker compose -f $DIR/docker-compose.yml -f $DIR/docker-compose.prod.yml exec -T postgres psql -U postgres"
