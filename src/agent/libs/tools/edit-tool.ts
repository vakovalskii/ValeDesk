/**
 * Edit Tool - Modify existing files
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { diffLines } from 'diff';
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
  // Validate required parameters
  if (!args.file_path) {
    return {
      success: false,
      error: 'Missing required parameter: file_path'
    };
  }
  
  if (args.old_string === undefined || args.old_string === null) {
    return {
      success: false,
      error: 'Missing required parameter: old_string'
    };
  }
  
  if (args.new_string === undefined || args.new_string === null) {
    return {
      success: false,
      error: 'Missing required parameter: new_string'
    };
  }
  
  // Security check
  if (!context.isPathSafe(args.file_path)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`
    };
  }
  
  try {
    const fullPath = resolve(context.cwd, args.file_path);
    const oldContent = await readFile(fullPath, 'utf-8');
    
    if (!oldContent.includes(args.old_string)) {
      return {
        success: false,
        error: `String not found in file: "${args.old_string.substring(0, 50)}..."`
      };
    }
    
    const newContent = oldContent.replace(args.old_string, args.new_string);
    await writeFile(fullPath, newContent, 'utf-8');
    
    // Calculate diff statistics
    const diffChanges = diffLines(oldContent, newContent);
    let additions = 0;
    let deletions = 0;
    
    for (const change of diffChanges) {
      if (change.added) {
        // Count lines (including empty lines, but not the trailing empty line if change ends with newline)
        const lines = change.value.split('\n');
        additions += lines.length - (change.value.endsWith('\n') ? 1 : 0);
      } else if (change.removed) {
        // Count lines (including empty lines, but not the trailing empty line if change ends with newline)
        const lines = change.value.split('\n');
        deletions += lines.length - (change.value.endsWith('\n') ? 1 : 0);
      }
    }
    
    // Return result with diff snapshot
    const diffSnapshot = {
      oldContent,
      newContent,
      additions,
      deletions,
      filePath: args.file_path
    };
    
    return {
      success: true,
      output: `File edited: ${args.file_path}`,
      data: {
        diffSnapshot
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to edit file: ${error.message}`
    };
  }
}

