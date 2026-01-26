/**
 * Grep Tool - Search for text in files
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

const execAsync = promisify(exec);

export const GrepToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_text",
    description: "Search for text content inside files. Find specific code or text patterns.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "What you're searching for and why"
        },
        pattern: {
          type: "string",
          description: "Text or regex pattern to search for"
        },
        path: {
          type: "string",
          description: "Directory or file to search in (optional)"
        }
      },
      required: ["explanation", "pattern"]
    }
  }
};

export async function executeGrepTool(
  args: { pattern: string; path?: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  try {
    const isWindows = process.platform === 'win32';
    
    // Use findstr on Windows, grep on Unix
    const cmd = isWindows
      ? args.path 
        ? `findstr /s /i /c:"${args.pattern}" "${args.path}\\*"`
        : `findstr /s /i /c:"${args.pattern}" *`
      : args.path 
        ? `grep -r "${args.pattern}" "${args.path}"`
        : `grep -r "${args.pattern}" .`;
    
    const { stdout, stderr } = await execAsync(cmd, { 
      cwd: context.cwd, 
      maxBuffer: 10 * 1024 * 1024 
    });
    
    return {
      success: true,
      output: stdout || 'No matches found'
    };
  } catch (error: any) {
    // grep/findstr returns exit code 1 when no matches found
    if (error.code === 1) {
      return {
        success: true,
        output: 'No matches found'
      };
    }
    return {
      success: false,
      error: `Grep failed: ${error.message}`
    };
  }
}

