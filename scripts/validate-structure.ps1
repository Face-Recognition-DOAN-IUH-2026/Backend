# validate-structure.ps1
# Checks that no ad-hoc test/helper scripts exist outside tools/ directories.
# Run from Backend root: powershell -ExecutionPolicy Bypass -File scripts/validate-structure.ps1

$violations = @()

# Find .js files that look like test scripts outside allowed directories
$jsFiles = Get-ChildItem -Path "." -Recurse -Include "*.js" -File | Where-Object {
    $rel = $_.FullName.Replace((Get-Location).Path + "\", "")
    $rel -notmatch "node_modules" -and
    $rel -notmatch "dist" -and
    $rel -notmatch "coverage" -and
    $rel -notmatch "tools[/\\]" -and
    $rel -notmatch "__tests__" -and
    $rel -notmatch "\.config\." -and
    $rel -notmatch "jest\.config" -and
    $rel -notmatch "tsconfig" -and
    $rel -notmatch "package\.json" -and
    $rel -notmatch "src[/\\]" -and
    $rel -notmatch "migrations[/\\]" -and
    $rel -notmatch "scripts[/\\]" -and
    # Only flag files that look like ad-hoc test/helper scripts
    ($rel -match "test[_-]" -or $rel -match "temp[_-]" -or $rel -match "activate")
}

foreach ($f in $jsFiles) {
    $rel = $f.FullName.Replace((Get-Location).Path + "\", "")
    $violations += $rel
}

# Find .py files that look like test scripts outside allowed directories
$pyFiles = Get-ChildItem -Path "." -Recurse -Include "*.py" -File | Where-Object {
    $rel = $_.FullName.Replace((Get-Location).Path + "\", "")
    $rel -notmatch "node_modules" -and
    $rel -notmatch "tools[/\\]" -and
    $rel -notmatch "__pycache__" -and
    $rel -notmatch "\.venv" -and
    $rel -notmatch "src[/\\]" -and
    $rel -notmatch "api[/\\]" -and
    $rel -notmatch "core[/\\]" -and
    $rel -notmatch "infra[/\\]" -and
    $rel -notmatch "worker[/\\]" -and
    $rel -notmatch "scripts[/\\]" -and
    $rel -notmatch "tests[/\\]" -and
    # Only flag files that look like ad-hoc test scripts
    ($rel -match "^test[_-]" -or $rel -match "test_camera" -or $rel -match "test_borrow")
}

foreach ($f in $pyFiles) {
    $rel = $f.FullName.Replace((Get-Location).Path + "\", "")
    $violations += $rel
}

if ($violations.Count -gt 0) {
    Write-Host "ERROR: Ad-hoc test scripts found outside tools/ directory:" -ForegroundColor Red
    $violations | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "Move them to the tools/ directory under their respective service." -ForegroundColor Red
    exit 1
} else {
    Write-Host "OK: No misplaced ad-hoc scripts found." -ForegroundColor Green
    exit 0
}
