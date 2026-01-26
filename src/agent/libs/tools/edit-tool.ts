/**
 * Edit Tool - Modify existing files
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

export const EditToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "edit_file",
    description: "Edit existing file by replacing old content with new content. Use for modifying files.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "What you're changing and why"
        },
        file_path: {
          type: "string",
          description: "Path to the file to edit"
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace"
        },
        new_string: {
          type: "string",
          description: "The new text to replace with"
        }
      },
      required: ["explanation", "file_path", "old_string", "new_string"]
    }
  }
};

export async function executeEditTool(
  args: { file_path: string; old_string: string; new_string: string; explanation: string },
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
    const content = await readFile(fullPath, 'utf-8');
    
    if (!content.includes(args.old_string)) {
      return {
        success: false,
        error: `String not found in file: "${args.old_string.substring(0, 50)}..."`
      };
    }
    
    const newContent = content.replace(args.old_string, args.new_string);
    await writeFile(fullPath, newContent, 'utf-8');
    
    return {
      success: true,
      output: `File edited: ${args.file_path}`
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to edit file: ${error.message}`
    };
  }
}

