/**
 * Glob Tool - Search for files by pattern
 */

import fg from 'fast-glob';
import { resolve, isAbsolute, relative, sep } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

export const GlobToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_files",
    description: "Search for files matching a glob pattern. Find files by name or extension.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "What files you're looking for and why"
        },
        pattern: {
          type: "string",
          description: "Glob pattern (e.g., '*.ts', 'src/**/*.js')"
        }
      },
      required: ["explanation", "pattern"]
    }
  }
};

const normalizePattern = (pattern: string) => pattern.replace(/\\/g, '/');

export async function executeGlobTool(
  args: { pattern: string; explanation: string },
  context: ToolExecutionContext
): Promise<ToolResult> {
  try {
    if (!context.cwd || !context.cwd.trim()) {
      return {
        success: false,
        error: 'Cannot search files: No workspace folder is set.'
      };
    }

    const rawPattern = args.pattern?.trim();
    if (!rawPattern) {
      return {
        success: false,
        error: 'Glob pattern is required'
      };
    }

    const cwd = resolve(context.cwd);
    let pattern = rawPattern;

    if (isAbsolute(rawPattern)) {
      const absolutePattern = resolve(rawPattern);
      if (absolutePattern === cwd) {
        pattern = '.';
      } else if (!absolutePattern.startsWith(cwd + sep)) {
        return {
          success: false,
          error: 'Glob pattern must be inside the workspace folder.'
        };
      } else {
        pattern = relative(cwd, absolutePattern);
      }
    }

    const normalizedPattern = normalizePattern(pattern);
    console.log(`[Glob] Searching for pattern: ${normalizedPattern} in ${context.cwd}`);

    const results = await fg(normalizedPattern, {
      cwd,
      onlyFiles: true,
      absolute: true,
      dot: false,
      followSymbolicLinks: false,
      unique: true
    });
    
    if (results.length === 0) {
      return {
        success: true,
        output: 'No files found'
      };
    }
    
    // Return results with proper encoding (UTF-8)
    const output = results.join('\n');
    console.log(`[Glob] Found ${results.length} files`);
    
    return {
      success: true,
      output
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Glob search failed: ${error.message || String(error)}`
    };
  }
}
