#!/bin/bash
# Seed all databases
# Usage: cd Backend && bash scripts/seed-all.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "  Database Seed Script"
echo "=========================================="
echo ""

echo "[1/3] Seeding user-service..."
cd "$BACKEND_DIR/user-service"
npm run seed
echo ""

echo "[2/3] Seeding borrow-service..."
cd "$BACKEND_DIR/borrow-service"
npm run seed
echo ""

echo "[3/3] Seeding schedule-service..."
cd "$BACKEND_DIR/schedule-service"
npm run seed
echo ""

echo "=========================================="
echo "  All seeds completed successfully!"
echo "=========================================="
echo ""
echo "Admin login: admin@example.com / admin123"
echo "Staff login: staff1@example.com / admin123"
echo "Patron login: patron01@example.com / patron123"
