#!/usr/bin/env node
const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Use xvfb on Linux when DISPLAY is not set (headless/devcontainer)
function needsXvfb() {
  return isLinux && !process.env.DISPLAY;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // On Windows, use shell to properly handle .cmd files
    const proc = spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: isWindows,
      windowsHide: true,
      ...options
    });

    proc.on('close', (code) => {
      resolve(code);
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Wait 5 seconds before starting electron
setTimeout(async () => {
  try {
    // Run transpile:electron
    const transpileCode = await runCommand('npm', ['run', 'transpile:electron']);

    if (transpileCode !== 0) {
      process.exit(transpileCode || 1);
      return;
    }

    const cwd = process.cwd();
    const env = { ...process.env, NODE_ENV: 'development' };

    let electronCode;
    if (needsXvfb()) {
      electronCode = await runCommand(
        '/usr/bin/xvfb-run',
        ['-a', 'npx', 'electron', '.', '--no-sandbox'],
        { env, cwd }
      );
    } else {
      electronCode = await runCommand(
        'npx',
        ['electron', '.', '--no-sandbox'],
        { env, cwd }
      );
    }

    process.exit(electronCode || 0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}, 5000);
