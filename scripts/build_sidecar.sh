#!/bin/bash

# Build sidecar binary for current platform

# Detect host target triple
if command -v rustc >/dev/null 2>&1; then
    TARGET=$(rustc -vV | sed -n 's|host: ||p')
else
    # Fallback for when rustc is not immediately available
    ARCH=$(uname -m)
    OS=$(uname -s)
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            TARGET="aarch64-apple-darwin"
        else
            TARGET="x86_64-apple-darwin"
        fi
    elif [ "$OS" = "Linux" ]; then
        if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            TARGET="aarch64-unknown-linux-gnu"
        else
            TARGET="x86_64-unknown-linux-gnu"
        fi
    else
        echo "Unsupported OS. Please install rustc."
        exit 1
    fi
fi

# Map Rust target to pkg target
case "$TARGET" in
    aarch64-apple-darwin)
        PKG_TARGET="node18-macos-arm64"
        ;;
    x86_64-apple-darwin)
        PKG_TARGET="node18-macos-x64"
        ;;
    aarch64-unknown-linux-gnu)
        PKG_TARGET="node18-linux-arm64"
        ;;
    x86_64-unknown-linux-gnu)
        PKG_TARGET="node18-linux-x64"
        ;;
    *)
        echo "Warning: Unknown target $TARGET, defaulting to node18-linux-x64"
        PKG_TARGET="node18-linux-x64"
        ;;
esac

BIN_DIR="src-tauri/bin"
BIN_NAME="valera-sidecar-${TARGET}"
BIN_PATH="${BIN_DIR}/${BIN_NAME}"

echo "Building sidecar for target: $TARGET"
echo "Using pkg target: $PKG_TARGET"
echo "Output: $BIN_PATH"

mkdir -p "$BIN_DIR"

# Build bundled.js
echo "Bundling sidecar code..."
npm run copy:sidecar-prompts || exit 1

npx esbuild src/sidecar/main.ts --bundle --platform=node --format=cjs --outfile=dist-sidecar/bundled.js --external:better-sqlite3 --external:sharp --external:electron --external:playwright --external:playwright-core --external:chromium-bidi || exit 1

# Build binary with pkg
echo "Building binary with pkg..."
pkg dist-sidecar/bundled.js --target "$PKG_TARGET" --output "$BIN_PATH" || exit 1

echo "Sidecar binary built successfully: $BIN_PATH"
