# Build sidecar binary for current platform
param(
    [string]$Target = ""
)

# Function to get Rust target triple
function Get-RustTarget {
    if (Get-Command rustc -ErrorAction SilentlyContinue) {
        $output = rustc -vV
        foreach ($line in $output) {
            if ($line -match "^host: (.*)") {
                return $matches[1]
            }
        }
    }
    # Fallback based on OS
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "ARM64") {
        return "aarch64-pc-windows-msvc"
    }
    return "x86_64-pc-windows-msvc"
}

# Function to map Rust target to pkg target
function Get-PkgTarget {
    param([string]$RustTarget)
    
    if ($RustTarget -match "aarch64-apple-darwin") {
        return "node18-macos-arm64"
    }
    if ($RustTarget -match "x86_64-apple-darwin") {
        return "node18-macos-x64"
    }
    if ($RustTarget -match "aarch64-pc-windows-msvc") {
        return "node18-win-arm64"
    }
    if ($RustTarget -match "x86_64-pc-windows-msvc") {
        return "node18-win-x64"
    }
    if ($RustTarget -match "aarch64-unknown-linux-gnu") {
        return "node18-linux-arm64"
    }
    if ($RustTarget -match "x86_64-unknown-linux-gnu") {
        return "node18-linux-x64"
    }
    
    Write-Host "Warning: Unknown target $RustTarget, defaulting to node18-win-x64" -ForegroundColor Yellow
    return "node18-win-x64"
}

# Function to get output filename
function Get-OutputFilename {
    param([string]$RustTarget)
    
    $ext = if ($RustTarget -match "windows") { ".exe" } else { "" }
    return "valera-sidecar-${RustTarget}${ext}"
}

# Determine targets
if ([string]::IsNullOrEmpty($Target)) {
    $RustTarget = Get-RustTarget
} else {
    $RustTarget = $Target
}

$PkgTarget = Get-PkgTarget -RustTarget $RustTarget
$OutputFilename = Get-OutputFilename -RustTarget $RustTarget
$OutputPath = Join-Path "src-tauri\bin" $OutputFilename

Write-Host "Building sidecar for target: $RustTarget" -ForegroundColor Cyan
Write-Host "Using pkg target: $PkgTarget" -ForegroundColor Cyan
Write-Host "Output: $OutputPath" -ForegroundColor Cyan

# Ensure bin directory exists
$BinDir = "src-tauri\bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}

# Build bundled.js
Write-Host "Bundling sidecar code..." -ForegroundColor Yellow
npm run copy:sidecar-prompts
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

npx esbuild src/sidecar/main.ts --bundle --platform=node --format=cjs --outfile=dist-sidecar/bundled.js --external:better-sqlite3 --external:sharp --external:electron --external:playwright --external:playwright-core --external:chromium-bidi
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

# Build binary with pkg
Write-Host "Building binary with pkg..." -ForegroundColor Yellow
pkg dist-sidecar/bundled.js --target $PkgTarget --output $OutputPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error building sidecar binary" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Sidecar binary built successfully: $OutputPath" -ForegroundColor Green
