/**
 * Bash Tool - Execute shell commands
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

const execAsync = promisify(exec);

export const BashToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_command",
    description: "Execute a shell command in the working directory. Use Windows commands (dir, type, cd) on Windows, or Unix commands (ls, cat, cd) on Unix. The system runs in the appropriate shell (PowerShell on Windows, bash on Unix).",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Brief explanation of why you're running this command"
        },
        command: {
          type: "string",
          description: "The shell command to execute. Use 'dir' instead of 'ls' on Windows, 'type' instead of 'cat', etc."
        }
      },
      required: ["explanation", "command"]
    }
  }
};

export async function executeBashTool(
  args: { command: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  try {
    const isWindows = process.platform === 'win32';
    
    // On Windows, prepend UTF-8 encoding commands
    const finalCommand = isWindows 
      ? `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${args.command}`
      : args.command;
    
    const { stdout, stderr } = await execAsync(finalCommand, { 
      cwd: context.cwd, 
      maxBuffer: 10 * 1024 * 1024,
      shell: isWindows ? 'powershell.exe' : undefined,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    
    return {
      success: true,
      output: stdout || stderr || 'Command executed successfully (no output)'
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      output: error.stdout || error.stderr
    };
  }
}

