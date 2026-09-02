param(
    [string]$PythonExecutable = ".venv\Scripts\python.exe",
    [string]$ComposeEnvFile = ".env.example",
    [switch]$RunMigration
)

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent $PSScriptRoot
$faceRoot = Join-Path $backendRoot "face-recognition-service"
$composeEnvPath = if ([System.IO.Path]::IsPathRooted($ComposeEnvFile)) {
    $ComposeEnvFile
} else {
    Join-Path $backendRoot $ComposeEnvFile
}
$pythonPath = if ([System.IO.Path]::IsPathRooted($PythonExecutable)) {
    $PythonExecutable
} else {
    Join-Path $faceRoot $PythonExecutable
}

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Python executable not found: $pythonPath"
}
if (-not (Test-Path -LiteralPath $composeEnvPath)) {
    throw "Compose environment file not found: $composeEnvPath"
}

Push-Location $faceRoot
try {
    & $pythonPath -m pytest
    if ($LASTEXITCODE -ne 0) { throw "pytest failed" }

    & $pythonPath -m ruff check .
    if ($LASTEXITCODE -ne 0) { throw "ruff failed" }

    if ($RunMigration) {
        & $pythonPath -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed" }
    } else {
        Write-Warning "Migration execution skipped. Re-run with -RunMigration against a disposable database."
    }
} finally {
    Pop-Location
}

Push-Location $backendRoot
try {
    docker compose --env-file $composeEnvPath config --quiet
    if ($LASTEXITCODE -ne 0) { throw "docker compose config validation failed" }

    kubectl apply --dry-run=client -f k8s/face-recognition.yaml
    if ($LASTEXITCODE -ne 0) { throw "Kubernetes migration manifest validation failed" }

    kubectl apply --dry-run=client -f k8s/face-recognition-workloads.yaml
    if ($LASTEXITCODE -ne 0) { throw "Kubernetes workload manifest validation failed" }
} finally {
    Pop-Location
}
