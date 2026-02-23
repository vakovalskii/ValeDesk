/**
 * Bash Tool - Execute shell commands
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

const execAsync = promisify(exec);
const pathSep = platform() === 'win32' ? ';' : ':';

// Max output size to prevent token explosion (100KB)
const MAX_OUTPUT_SIZE = 100 * 1024;

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) {
    return output;
  }
  const half = Math.floor(MAX_OUTPUT_SIZE / 2);
  const truncatedMsg = `\n\n... [OUTPUT TRUNCATED: ${output.length} bytes total, showing first ${half} and last ${half} bytes] ...\n\n`;
  return output.slice(0, half) + truncatedMsg + output.slice(-half);
}

export const BashToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "run_command",
    description: "Execute a shell command in the working directory. Use Windows commands (dir, type, cd) on Windows, or Unix commands (ls, cat, cd) on Unix. The system runs in the appropriate shell (PowerShell on Windows, bash on Unix). When FFmpeg is enabled in Settings → Tools, ffmpeg, ffprobe, and ffplay are available in PATH.",
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

const FFMPEG_PATTERN = /\b(ffmpeg|ffprobe|ffplay)\b/i;

export async function executeBashTool(
  args: { command: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  if (FFMPEG_PATTERN.test(args.command) && context.enableFfmpegTools && !context.ffmpegDir) {
    const msg = context.ffmpegDownloadAsked
      ? "FFmpeg is not installed. Enable and download FFmpeg in Settings → Tools."
      : "FFmpeg is not installed. Download it when prompted, or enable it in Settings → Tools.";
    return {
      success: false,
      error: msg,
      output: msg,
    };
  }

  try {
    const isWindows = process.platform === 'win32';
    
    // On Windows, prepend UTF-8 encoding commands
    const finalCommand = isWindows 
      ? `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${args.command}`
      : args.command;

    const baseEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' } as NodeJS.ProcessEnv;
    const env = context.ffmpegDir
      ? {
          ...baseEnv,
          PATH: `${context.ffmpegDir}${pathSep}${(baseEnv.PATH as string) || ''}`,
        }
      : baseEnv;
    
    const { stdout, stderr } = await execAsync(finalCommand, { 
      cwd: context.cwd, 
      maxBuffer: 10 * 1024 * 1024,
      shell: isWindows ? 'powershell.exe' : undefined,
      windowsHide: true,
      encoding: 'utf8',
      env
    });
    
    const rawOutput = stdout || stderr || 'Command executed successfully (no output)';
    return {
      success: true,
      output: truncateOutput(rawOutput)
    };
  } catch (error: any) {
    const rawOutput = error.stdout || error.stderr || '';
    return {
      success: false,
      error: error.message,
      output: truncateOutput(rawOutput)
    };
  }
}

