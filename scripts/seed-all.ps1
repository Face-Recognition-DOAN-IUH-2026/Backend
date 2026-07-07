# Seed all databases
# Usage: cd Backend && powershell -ExecutionPolicy Bypass -File scripts/seed-all.ps1

$ErrorActionPreference = "Stop"
$BackendDir = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Database Seed Script" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Seeding user-service..." -ForegroundColor Yellow
Set-Location "$BackendDir\user-service"
npm run seed
Write-Host ""

Write-Host "[2/3] Seeding borrow-service..." -ForegroundColor Yellow
Set-Location "$BackendDir\borrow-service"
npm run seed
Write-Host ""

Write-Host "[3/3] Seeding schedule-service..." -ForegroundColor Yellow
Set-Location "$BackendDir\schedule-service"
npm run seed
Write-Host ""

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  All seeds completed successfully!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Admin login: admin@example.com / admin123"
Write-Host "Staff login: staff1@example.com / admin123"
Write-Host "Patron login: patron01@example.com / patron123"
