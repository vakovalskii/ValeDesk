/**
 * Code Sandbox - Execute JS/Python code securely
 * 
 * Uses Node.js vm module which works reliably in pkg binary
 * (For Rust-native sandbox, use Tauri command sandbox_execute directly)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import * as vm from 'vm';
import { spawn } from 'child_process';

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  logs: string[];
  language?: string;
}

/**
 * Execute JavaScript code in sandbox
 */
export async function executeInQuickJS(
  code: string,
  cwd: string,
  isPathSafe: (path: string) => boolean,
  timeout: number = 5000
): Promise<SandboxResult> {
  const logs: string[] = [];
  
  try {
    // Create sandbox context with allowed APIs
    const sandbox: any = {
      console: {
        log: (...args: any[]) => {
          const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
          logs.push(msg);
        },
        error: (...args: any[]) => {
          const msg = `ERROR: ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
          logs.push(msg);
        },
        warn: (...args: any[]) => {
          const msg = `WARN: ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`;
          logs.push(msg);
        },
        info: (...args: any[]) => {
          const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
          logs.push(msg);
        }
      },
      fs: {
        readFileSync: (filePath: string, encoding?: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${filePath} is outside workspace`);
          }
          return readFileSync(fullPath, (encoding as BufferEncoding) || 'utf-8');
        },
        writeFileSync: (filePath: string, data: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${filePath} is outside workspace`);
          }
          writeFileSync(fullPath, data, 'utf-8');
        },
        existsSync: (filePath: string) => {
          const fullPath = resolve(cwd, filePath.startsWith('/') ? filePath.slice(1) : filePath);
          return existsSync(fullPath);
        },
        readdirSync: (dirPath: string) => {
          const fullPath = resolve(cwd, dirPath.startsWith('/') ? dirPath.slice(1) : dirPath);
          if (!isPathSafe(fullPath)) {
            throw new Error(`Access denied: ${dirPath} is outside workspace`);
          }
          return readdirSync(fullPath);
        }
      },
      path: {
        join: (...parts: string[]) => join(...parts),
        resolve: (...parts: string[]) => resolve(...parts),
        dirname: (p: string) => dirname(p),
        basename: (p: string) => basename(p),
        extname: (p: string) => extname(p)
      },
      __dirname: cwd,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      // Disabled for security
      setTimeout: undefined,
      setInterval: undefined,
      fetch: undefined,
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
    };
    
    // Create VM context
    const context = vm.createContext(sandbox);
    
    // Wrap code to capture return value
    const wrappedCode = `
(function() {
  "use strict";
  ${code}
})()
`;
    
    // Execute with timeout
    const script = new vm.Script(wrappedCode, { filename: 'sandbox.js' });
    const result = script.runInContext(context, { timeout });
    
    let outputStr = '';
    if (result !== undefined) {
      outputStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    }
    
    return {
      success: true,
      output: outputStr,
      logs,
      language: 'javascript'
    };
    
  } catch (error: any) {
    return {
      success: false,
      output: '',
      error: error.message,
      logs,
      language: 'javascript'
    };
  }
}

/**
 * Execute Python code (requires Python 3 installed)
 */
export async function executePython(
  code: string,
  cwd: string,
  _isPathSafe: (path: string) => boolean,
  timeout: number = 30000
): Promise<SandboxResult> {
  return new Promise((promiseResolve) => {
    const logs: string[] = [];
    let stdout = '';
    let stderr = '';
    
    // Find Python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const proc = spawn(pythonCmd, ['-c', code], {
      cwd,
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      logs.push(...text.split('\n').filter((l: string) => l.trim()));
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (exitCode) => {
      if (exitCode === 0) {
        promiseResolve({
          success: true,
          output: stdout.trim(),
          logs,
          language: 'python'
        });
      } else {
        promiseResolve({
          success: false,
          output: stdout,
          error: stderr || `Python exited with code ${exitCode}`,
          logs,
          language: 'python'
        });
      }
    });
    
    proc.on('error', (err) => {
      promiseResolve({
        success: false,
        output: '',
        error: `Failed to execute Python: ${err.message}. Make sure Python 3 is installed.`,
        logs,
        language: 'python'
      });
    });
  });
}
