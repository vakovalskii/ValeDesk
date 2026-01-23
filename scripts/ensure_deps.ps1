# Function to check if a command exists
function Test-CommandExists {
    param ($Command)
    try {
        $null = Get-Command $Command -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# Function to prompt for installation
function Prompt-Install {
    param (
        [string]$Tool,
        [string]$InstallCmd,
        [string]$CheckCmd
    )

    Write-Host "level=warning event=missing_tool tool=$Tool msg=""$Tool not found""" -ForegroundColor Yellow
    $response = Read-Host "Do you want to install $Tool? [y/N]"
    if ($response -match "^[Yy]$") {
        Write-Host "Installing $Tool..."
        Invoke-Expression $InstallCmd
        
        # Verify installation
        if (Test-CommandExists $CheckCmd) {
            Write-Host "$Tool installed successfully." -ForegroundColor Green
        } else {
             # Special handling for Rust env update in current session might be tricky in PS, 
             # usually requires checking PATH update or advising restart
             Write-Host "Installed $Tool. You may need to restart your terminal or refresh environment variables." -ForegroundColor Yellow
        }
    } else {
        Write-Host "Aborted. $Tool is required." -ForegroundColor Red
        exit 1
    }
}

# Check for Cargo (Rust)
if (-not (Test-CommandExists "cargo")) {
    Prompt-Install "cargo" "winget install Rustlang.Rustup" "cargo"
}

# Check for Node.js and NPM
if ((-not (Test-CommandExists "node")) -or (-not (Test-CommandExists "npm"))) {
    Prompt-Install "node" "winget install OpenJS.NodeJS" "node"
}

Write-Host "All base dependencies (cargo, node, npm) are present." -ForegroundColor Green
