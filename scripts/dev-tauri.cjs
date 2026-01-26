#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const isWindows = process.platform === 'win32';
const rootDir = path.resolve(__dirname, '..');
const sidecarEntry = path.join(rootDir, 'dist-sidecar', 'sidecar', 'main.js').replace(/\\/g, '/');

// Start Vite dev server
console.log('Starting Vite dev server...');
const vite = spawn('npm', ['run', 'dev:react'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: isWindows
});

// Wait a bit for Vite to start
setTimeout(() => {
  console.log('Starting Tauri...');
  const tauri = spawn('cargo', ['tauri', 'dev'], {
    cwd: path.join(rootDir, 'src-tauri'),
    stdio: 'inherit',
    shell: isWindows,
    env: {
      ...process.env,
      LOCALDESK_SIDECAR_ENTRY: sidecarEntry
    }
  });

  // Handle cleanup
  const cleanup = () => {
    vite.kill('SIGTERM');
    tauri.kill('SIGTERM');
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  tauri.on('exit', (code) => {
    vite.kill('SIGTERM');
    process.exit(code ?? 0);
  });
}, 3000);

vite.on('exit', (code) => {
  if (code !== null && code !== 0) {
    process.exit(code);
  }
});
