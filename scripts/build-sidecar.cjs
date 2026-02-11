#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Detect platform and architecture for pkg target and Tauri sidecar naming
const platform = os.platform();
const arch = os.arch();

const PKG_TARGETS = {
  'darwin-arm64':  { pkg: 'node22-macos-arm64',  tauri: 'aarch64-apple-darwin' },
  'darwin-x64':    { pkg: 'node22-macos-x64',    tauri: 'x86_64-apple-darwin' },
  'win32-x64':     { pkg: 'node22-win-x64',      tauri: 'x86_64-pc-windows-msvc' },
  'linux-x64':     { pkg: 'node22-linux-x64',     tauri: 'x86_64-unknown-linux-gnu' },
  'linux-arm64':   { pkg: 'node22-linux-arm64',   tauri: 'aarch64-unknown-linux-gnu' },
};

const key = `${platform}-${arch}`;
const target = PKG_TARGETS[key];

if (!target) {
  console.error(`Unsupported platform/arch: ${key}`);
  console.error(`Supported: ${Object.keys(PKG_TARGETS).join(', ')}`);
  process.exit(1);
}

const ext = platform === 'win32' ? '.exe' : '';
const outputPath = path.join('src-tauri', 'bin', `valera-sidecar-${target.tauri}${ext}`);

// Ensure output directory exists
const binDir = path.join('src-tauri', 'bin');
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

console.log(`Platform: ${key}`);
console.log(`pkg target: ${target.pkg}`);
console.log(`Output: ${outputPath}`);

// Bundle with esbuild
console.log('\nBundling sidecar with esbuild...');
execSync(
  'npx esbuild src/sidecar/main.ts --bundle --platform=node --format=cjs --outfile=dist-sidecar/bundled.js --external:sharp --external:electron --external:playwright --external:playwright-core --external:chromium-bidi',
  { stdio: 'inherit' }
);

// Package with pkg
console.log('\nPackaging sidecar binary...');
execSync(
  `npx @yao-pkg/pkg dist-sidecar/bundled.js --target ${target.pkg} --output ${outputPath}`,
  { stdio: 'inherit' }
);

console.log(`\nSidecar built: ${outputPath}`);
