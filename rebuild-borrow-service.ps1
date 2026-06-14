# Rebuild & Restart Borrow Service
# Run from Backend/ directory

Write-Host "=== Rebuilding borrow-service Docker image ===" -ForegroundColor Cyan

# Navigate to Backend directory
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# Stop current container
Write-Host "`n[1/4] Stopping borrow-service..." -ForegroundColor Yellow
docker-compose stop borrow-service

# Rebuild with no cache to ensure fresh install of dependencies
Write-Host "`n[2/4] Building Docker image (this may take a few minutes)..." -ForegroundColor Yellow
docker-compose build --no-cache borrow-service

# Remove old container and recreate
Write-Host "`n[3/4] Recreating container..." -ForegroundColor Yellow
docker-compose up -d --force-recreate borrow-service

# Wait for service to start
Start-Sleep -Seconds 5

# Check if container is running
Write-Host "`n[4/4] Verifying..." -ForegroundColor Yellow
$status = docker inspect borrow-service --format="{{.State.Status}}"
if ($status -eq "running") {
    Write-Host "`nContainer is running. Checking logs..." -ForegroundColor Green

    # Show recent logs
    docker logs borrow-service --tail 30 2>&1

    # Quick health check
    Write-Host "`n`nTesting endpoint..." -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:80/api/borrow/books" -Method GET -Headers @{Authorization = "Bearer test"} -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 401) {
            Write-Host "Endpoint reachable! (401 = auth required, service is up)" -ForegroundColor Green
        }
    } catch {
        Write-Host "Service may need more time to start, or check logs above" -ForegroundColor Yellow
    }
} else {
    Write-Host "Container status: $status" -ForegroundColor Red
    Write-Host "Check logs:" -ForegroundColor Red
    docker logs borrow-service 2>&1 | Select-Object -Last 50
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan