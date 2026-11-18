param(
    [string]$TargetHost = "http://localhost:80",
    [string]$Duration = "60s",
    [int[]]$Stages = @(50, 150, 300),
    [switch]$AllowProduction
)

$ErrorActionPreference = "Stop"

# Safety guard: prevent accidental stress testing against live AWS production
if (-not $AllowProduction -and ($TargetHost -match "iuhlib-api\.duckdns\.org|amazonaws\.com")) {
    Write-Error "ABORTED: Refusing to run load test against production host '$TargetHost' without -AllowProduction."
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$reportDir = Join-Path $scriptDir "reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

Write-Output "=== Capturing baseline Docker container stats ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>&1 | Tee-Object -FilePath (Join-Path $reportDir "docker_stats_before.txt")

foreach ($vu in $Stages) {
    $spawnRate = [Math]::Max(5, [Math]::Floor($vu / 5))
    $prefix = Join-Path $reportDir "load_${vu}vu"
    $htmlOut = Join-Path $reportDir "load_${vu}vu.html"
    Write-Output "`n=== Running Locust Stage: ${vu} VUs (spawn=${spawnRate}/s, duration=${Duration}) ==="
    python -m locust -f (Join-Path $scriptDir "locustfile.py") `
        --host $TargetHost `
        --headless `
        -u $vu `
        -r $spawnRate `
        -t $Duration `
        --csv $prefix `
        --html $htmlOut
}

Write-Output "`n=== Capturing post-test Docker container stats ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>&1 | Tee-Object -FilePath (Join-Path $reportDir "docker_stats_after.txt")
Write-Output "`nLoad test complete. Reports saved to: $reportDir"
