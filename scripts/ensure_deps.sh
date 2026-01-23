#!/bin/bash

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to prompt for installation
prompt_install() {
    local tool="$1"
    local install_cmd="$2"
    
    echo "level=warning event=missing_tool tool=$tool msg=\"$tool not found\""
    read -p "Do you want to install $tool? [y/N] " response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "Installing $tool..."
        eval "$install_cmd"
        if [ $? -eq 0 ]; then
            echo "$tool installed successfully."
            # Reload shell context if necessary (limited in subshell, but useful attempt)
            if [ "$tool" == "cargo" ]; then
                source "$HOME/.cargo/env" 2>/dev/null
            fi
        else
            echo "Failed to install $tool."
            exit 1
        fi
    else
        echo "Aborted. $tool is required."
        exit 1
    fi
}

# Check for Cargo (Rust)
if ! command_exists cargo; then
    prompt_install "cargo" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
fi

# Check for Node.js and NPM
if ! command_exists node || ! command_exists npm; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
         if command_exists brew; then
            prompt_install "node" "brew install node"
         else
            echo "level=error event=missing_tool tool=node msg=\"node/npm not found and brew is missing. Please install Node.js manually.\""
            exit 1
         fi
    else
        echo "level=error event=missing_tool tool=node msg=\"node/npm not found. Please install Node.js manually for your OS.\""
        exit 1
    fi
fi

echo "All base dependencies (cargo, node, npm) are present."
