/**
 * Write Tool - Create new files
 */

import { writeFile, mkdir, access } from 'fs/promises';
import { dirname, resolve } from 'path';
import { constants } from 'fs';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

export const WriteToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "write_file",
    description: "Create a new file with given content. If file already exists, choose different filename (add number suffix or timestamp) instead of editing.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why you're creating this file"
        },
        file_path: {
          type: "string",
          description: "Path where to create the file"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["explanation", "file_path", "content"]
    }
  }
};

export async function executeWriteTool(
  args: { file_path: string; content: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  // Security check
  if (!context.isPathSafe(args.file_path)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`
    };
  }
  
  try {
    const fullPath = resolve(context.cwd, args.file_path);
    
    // Check if file already exists
    try {
      await access(fullPath, constants.F_OK);
      return {
        success: false,
        error: `File already exists: ${args.file_path}. Please choose a different filename or use Edit tool to modify the existing file.`
      };
    } catch {
      // File doesn't exist, proceed with creation
    }
    
    const dir = dirname(fullPath);
    
    // Create directory if it doesn't exist
    await mkdir(dir, { recursive: true });
    
    await writeFile(fullPath, args.content, 'utf-8');
    return {
      success: true,
      output: `File created: ${args.file_path}`
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write file: ${error.message}`
    };
  }
}

