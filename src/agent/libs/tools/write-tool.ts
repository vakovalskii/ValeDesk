/**
 * Write Tool - Create new files
 */

import { writeFile, mkdir, access } from 'fs/promises';
import { dirname, resolve } from 'path';
import { constants } from 'fs';
import { diffLines } from 'diff';
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
  // Validate required parameters
  if (!args.file_path) {
    return {
      success: false,
      error: 'Missing required parameter: file_path'
    };
  }
  
  if (args.content === undefined || args.content === null) {
    return {
      success: false,
      error: 'Missing required parameter: content. You must provide the file content to write.'
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
    
    // For new files, old content is empty
    const oldContent = '';
    const newContent = args.content;
    
    await writeFile(fullPath, newContent, 'utf-8');
    
    // Calculate diff statistics (all lines are additions for new file)
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
    
    console.log(`[WriteTool] Calculated diff for ${args.file_path}:`, {
      additions,
      deletions,
      oldContentLength: oldContent.length,
      newContentLength: newContent.length,
      diffSnapshotKeys: Object.keys(diffSnapshot),
      hasOldContent: !!diffSnapshot.oldContent,
      hasNewContent: !!diffSnapshot.newContent
    });
    
    // Force flush stdout in case of buffering
    if (process.stdout && typeof (process.stdout as any).flush === 'function') {
      (process.stdout as any).flush();
    }
    
    const result = {
      success: true,
      output: `File created: ${args.file_path}`,
      data: {
        diffSnapshot
      }
    };
    
    console.log(`[WriteTool] Returning result:`, {
      success: result.success,
      hasData: !!result.data,
      hasDiffSnapshot: !!(result.data && result.data.diffSnapshot),
      dataKeys: result.data ? Object.keys(result.data) : []
    });
    
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to write file: ${error.message}`
    };
  }
}

