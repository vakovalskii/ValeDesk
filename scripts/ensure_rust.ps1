# Check Rust version
param(
    [string]$MinRustVersion = "1.74.0"
)
$MIN_RUST_VERSION = $MinRustVersion

Write-Host "Checking Rust version..."

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "❌ ERROR: Rust is not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Rust: winget install Rustlang.Rustup"
    Write-Host ""
    exit 1
}

$rustVersionOutput = rustc --version
if ($rustVersionOutput -match 'rustc (\d+\.\d+\.\d+)') {
    $RUST_VERSION = $matches[1]
} else {
    Write-Host "❌ ERROR: Could not parse Rust version" -ForegroundColor Red
    exit 1
}

$rustParts = $RUST_VERSION -split '\.'
$RUST_MAJOR = [int]$rustParts[0]
$RUST_MINOR = [int]$rustParts[1]
$RUST_PATCH = [int]$rustParts[2]

$minParts = $MIN_RUST_VERSION -split '\.'
$MIN_MAJOR = [int]$minParts[0]
$MIN_MINOR = [int]$minParts[1]
$MIN_PATCH = [int]$minParts[2]

if ($RUST_MAJOR -lt $MIN_MAJOR -or 
    ($RUST_MAJOR -eq $MIN_MAJOR -and $RUST_MINOR -lt $MIN_MINOR) -or 
    ($RUST_MAJOR -eq $MIN_MAJOR -and $RUST_MINOR -eq $MIN_MINOR -and $RUST_PATCH -lt $MIN_PATCH)) {
    Write-Host ""
    $errorMsg = "ERROR: Rust version $RUST_VERSION is too old (minimum: $MIN_RUST_VERSION)"
    Write-Host $errorMsg -ForegroundColor Red
    Write-Host ""
    Write-Host "Update Rust: rustup update stable"
    Write-Host ""
    exit 1
}

$successMsg = "Rust $RUST_VERSION (minimum: $MIN_RUST_VERSION)"
Write-Host $successMsg -ForegroundColor Green
