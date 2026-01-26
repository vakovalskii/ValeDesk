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
    # Fallback logic if needed (e.g. for simple Windows cases)
    return "x86_64-pc-windows-msvc"
}

$Target = Get-RustTarget
$BinDir = "src-tauri\bin"
$BinName = "local-desk-sidecar-${Target}.exe"
$BinPath = Join-Path $BinDir $BinName

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}

# Create a dummy executable (empty file is often enough for existence check, 
# but writing a minimal batch script renamed to exe might be safer if it tries to execute,
# though on Windows execution of .exe with text content fails. 
# Tauri just checks existence mostly.
# Let's write text file but named .exe.
"Mock sidecar" | Set-Content $BinPath

Write-Host "Created mock sidecar at $BinPath"
