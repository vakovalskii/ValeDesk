#!/bin/bash

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build_asr_sidecar.sh: asr-sidecar is macOS-only (Swift/CoreML)."
  exit 1
fi

# Detect host target triple (match scripts/build_sidecar.sh naming).
if command -v rustc >/dev/null 2>&1; then
  TARGET=$(rustc -vV | sed -n 's|host: ||p')
else
  ARCH=$(uname -m)
  if [ "$ARCH" = "arm64" ]; then
    TARGET="aarch64-apple-darwin"
  else
    TARGET="x86_64-apple-darwin"
  fi
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="${ROOT_DIR}/sidecars/asr-swift"
BIN_DIR="${ROOT_DIR}/src-tauri/bin"
BIN_NAME="asr-sidecar-${TARGET}"
BIN_PATH="${BIN_DIR}/${BIN_NAME}"

echo "Building asr-sidecar for target: ${TARGET}"
echo "Sidecar dir: ${SIDECAR_DIR}"
echo "Output: ${BIN_PATH}"

mkdir -p "${BIN_DIR}"

pushd "${SIDECAR_DIR}" >/dev/null
swift build -c release
popd >/dev/null

cp "${SIDECAR_DIR}/.build/release/asr-sidecar" "${BIN_PATH}"
chmod +x "${BIN_PATH}"

echo "asr-sidecar built successfully: ${BIN_PATH}"

