#!/usr/bin/env bash
# =============================================================================
# Deploy / cập nhật Backend lên server.
# Cách dùng:
#   ./deploy-backend.sh            # deploy nhánh main
#   ./deploy-backend.sh develop   # deploy nhánh khác
#
# Rollback (quay về commit cũ):
#   cd /opt/iuh-backend && git reset --hard <sha> && \
#     docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# =============================================================================
set -euo pipefail

DIR="${BACKEND_DIR:-/opt/iuh-backend}"
BRANCH="${1:-main}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

cd "$DIR"

[ -f .env ]         || { echo "LỖI: thiếu $DIR/.env — xem runbook Phase 5"; exit 1; }
[ -f Caddyfile ]    || { echo "LỖI: thiếu $DIR/Caddyfile"; exit 1; }

echo "== 1/5 git pull branch=$BRANCH =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "   HEAD: $(git log -1 --oneline)"

echo "== 2/5 validate compose config =="
$COMPOSE config -q

echo "== 3/5 build images (lần đầu 10–20 phút trên ARM) =="
$COMPOSE build

echo "== 4/5 khởi động / cập nhật container =="
$COMPOSE up -d --remove-orphans

echo "== 5/5 trạng thái =="
$COMPOSE ps

echo ""
echo "✅ Deploy xong. Kiểm tra log: $COMPOSE logs -f gateway caddy"
