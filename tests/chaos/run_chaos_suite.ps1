param(
    [string]$TargetHost = "http://localhost:80",
    [int]$PauseSeconds = 15,
    [switch]$AllowProduction
)

$ErrorActionPreference = "Stop"

if (-not $AllowProduction -and ($TargetHost -match "iuhlib-api\.duckdns\.org|amazonaws\.com")) {
    Write-Error "ABORTED: Refusing to run chaos tests against production host '$TargetHost'."
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-HealthEndpoint([string]$label) {
    try {
        $resp = Invoke-WebRequest -Uri "$TargetHost/health" -UseBasicParsing -TimeoutSec 10
        Write-Output "  [$label] /health -> HTTP $($resp.StatusCode)"
    } catch {
        Write-Warning "  [$label] /health failed: $($_.Exception.Message)"
    }
}

Write-Output "=== Chaos Case 1: Pause Redis ($PauseSeconds s) & verify Gateway/RBAC resilience ==="
docker pause redis 2>$null
Start-Sleep -Seconds 3
Test-HealthEndpoint "redis_paused"
Start-Sleep -Seconds $PauseSeconds
docker unpause redis 2>$null
Start-Sleep -Seconds 3
Test-HealthEndpoint "redis_recovered"

Write-Output "`n=== Chaos Case 2: Pause ChromaDB ($PauseSeconds s) & verify system resilience ==="
docker pause chromadb 2>$null
Start-Sleep -Seconds 3
Test-HealthEndpoint "chromadb_paused"
Start-Sleep -Seconds $PauseSeconds
docker unpause chromadb 2>$null
Start-Sleep -Seconds 3
Test-HealthEndpoint "chromadb_recovered"

Write-Output "`n=== Chaos Case 3: Malformed payloads & rate limiter probe ==="
python (Join-Path $scriptDir "malformed_payloads.py") --base-url $TargetHost
