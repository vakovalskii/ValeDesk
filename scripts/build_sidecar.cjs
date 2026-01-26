#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const isWindows = process.platform === 'win32';
const rootDir = path.resolve(__dirname, '..');

const scriptName = isWindows ? 'build_sidecar.ps1' : 'build_sidecar.sh';
const scriptPath = path.join(__dirname, scriptName);

if (isWindows) {
  const ps = spawn('powershell', [
    '-ExecutionPolicy', 'ByPass',
    '-File', scriptPath
  ], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });

  ps.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} else {
  const sh = spawn('bash', [scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false
  });

  sh.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
