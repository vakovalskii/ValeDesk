#!/bin/bash

# Detect host target triple
if command -v rustc >/dev/null 2>&1; then
    TARGET=$(rustc -vV | sed -n 's|host: ||p')
else
    # Fallback for when rustc is not immediately available (should not happen in this env)
    ARCH=$(uname -m)
    OS=$(uname -s)
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            TARGET="aarch64-apple-darwin"
        else
            TARGET="x86_64-apple-darwin"
        fi
    elif [ "$OS" = "Linux" ]; then
        TARGET="x86_64-unknown-linux-gnu"
    else
        echo "Unsupported OS fallback. Please install rustc."
        exit 1
    fi
fi

BIN_DIR="src-tauri/bin"
BIN_NAME="local-desk-sidecar-${TARGET}"
BIN_PATH="${BIN_DIR}/${BIN_NAME}"

mkdir -p "$BIN_DIR"

# Create a dummy script
echo "#!/bin/sh" > "$BIN_PATH"
echo "echo 'This is a mock sidecar for Tauri CLI validation.'" >> "$BIN_PATH"
echo "exit 1" >> "$BIN_PATH"

chmod +x "$BIN_PATH"

echo "Created mock sidecar at $BIN_PATH"
