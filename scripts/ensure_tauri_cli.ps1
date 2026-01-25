# Ensure cargo-tauri is installed
if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
    Write-Host "level=info event=install tool=cargo-tauri cmd=`"cargo install tauri-cli --locked`" msg=`"cargo-tauri not found; installing tauri-cli`""
    cargo install tauri-cli --locked
    if ($LASTEXITCODE -ne 0) {
        Write-Host "level=error event=install_failed tool=cargo-tauri msg=`"Failed to install cargo-tauri`"" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

if (-not (Get-Command cargo-tauri -ErrorAction SilentlyContinue)) {
    $cargoBin = if ($env:CARGO_HOME) { "$env:CARGO_HOME\bin" } else { "$env:USERPROFILE\.cargo\bin" }
    Write-Host "level=error event=install_failed tool=cargo-tauri msg=`"cargo-tauri still not found after install; ensure $cargoBin is in PATH`"" -ForegroundColor Red 2>&1
    exit 1
}
