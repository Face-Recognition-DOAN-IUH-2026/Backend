#!/usr/bin/env bash
# =============================================================================
# Setup 1 lần cho server Ubuntu 22.04/24.04 (x86_64 hoặc arm64/ARM OCI)
# Cách dùng:  sudo bash setup-server.sh
# Cài: Docker Engine, log rotation, UFW firewall, swap 4GB
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "LỖI: Hãy chạy với sudo (sudo bash setup-server.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "== 1/5 Cài đặt gói cơ bản =="
apt-get update -y
apt-get install -y ca-certificates curl git ufw jq

echo "== 2/5 Cài Docker Engine =="
if command -v docker >/dev/null 2>&1; then
  echo "   Docker đã có: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
fi
# Cho user thường (ubuntu) dùng docker không cần sudo
if [ -n "${SUDO_USER:-}" ]; then
  usermod -aG docker "$SUDO_USER" || true
fi

echo "== 3/5 Log rotation cho container (tránh đầy ổ đĩa) =="
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
systemctl restart docker
systemctl enable docker >/dev/null 2>&1 || true

echo "== 4/5 Firewall (UFW) — chỉ mở 22/80/443 =="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "== 5/5 Tạo swap 4GB (chống OOM khi build Node/Python) =="
if ! grep -q '/swapfile' /etc/fstab; then
  fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo "   Đã tạo swap 4GB"
else
  echo "   Swap đã có"
fi

echo ""
echo "✅ Setup server xong."
echo "   - Đăng xuất/đăng nhập lại để dùng 'docker' không cần sudo (hoặc dùng sudo docker)."
echo "   - BƯỚC TIẾP THEO: xem runbook Phase 4 — clone repo về /opt/iuh-backend"
