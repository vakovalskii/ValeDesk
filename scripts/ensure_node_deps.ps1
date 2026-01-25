# Ensure Node.js dependencies are installed
if (-not (Test-Path package-lock.json)) {
    Write-Host "level=error event=missing_file file=package-lock.json msg=package-lock.json is required for npm ci" 2>&1
    exit 1
}

if (-not (Test-Path node_modules)) {
    Write-Host "level=info event=install deps=npm msg=node_modules not found; running npm ci"
    npm ci
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    
    Write-Host "level=info event=rebuild module=better-sqlite3 msg=rebuilding native module for current Node.js"
    npm rebuild better-sqlite3
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
