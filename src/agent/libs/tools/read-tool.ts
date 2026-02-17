/**
 * Read Tool - Read file contents
 */

import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

// Max file size to read (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Default max lines if file is very large
const DEFAULT_MAX_LINES = 2000;

export const ReadToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a text file. Use start_line/end_line to read specific portions of large files.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why you need to read this file"
        },
        file_path: {
          type: "string",
          description: "Path to the file to read (relative or absolute)"
        },
        start_line: {
          type: "integer",
          description: "Start reading from this line number (1-based, inclusive). Optional."
        },
        end_line: {
          type: "integer",
          description: "Stop reading at this line number (1-based, inclusive). Optional."
        },
        max_lines: {
          type: "integer",
          description: "Maximum number of lines to return. Default: 2000 for large files. Optional."
        }
      },
      required: ["explanation", "file_path"]
    }
  }
};

export async function executeReadTool(
  args: { 
    file_path: string; 
    explanation: string;
    start_line?: number;
    end_line?: number;
    max_lines?: number;
  },
  context: ToolExecutionContext
): Promise<ToolResult> {
  // Check for PDF files - they should use ExecuteJS with pdf-parse
  if (args.file_path.toLowerCase().endsWith('.pdf')) {
    return {
      success: false,
      error: `❌ Cannot read PDF files with Read tool (will return binary garbage).\n\n` +
             `Use ExecuteJS instead:\n` +
             `1. InstallPackage(['pdf-parse'])\n` +
             `2. ExecuteJS: const pdf = require('pdf-parse'); const buffer = require('fs').readFileSync('${args.file_path}'); return pdf(buffer);`
    };
  }

  // Block reading .env files — they contain secrets (API keys, tokens, passwords)
  const fileName = args.file_path.split('/').pop()?.toLowerCase() || '';
  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return {
      success: false,
      error: `🔒 Access denied: Cannot read .env files — they may contain secrets (API keys, tokens, passwords).\n\n` +
             `If a skill requires environment variables, they should be:\n` +
             `1. Set in the user's system environment (export VAR=value)\n` +
             `2. Declared in the skill's dependencies, not read directly from .env files\n\n` +
             `Ask the user to provide the required values or set them as environment variables.`
    };
  }

  // Block reading skill script files — they should be executed, not read
  const normalizedPath = args.file_path.replace(/\\/g, '/');
  if (normalizedPath.match(/\/skills\/[^/]+\/scripts\//) || normalizedPath.match(/^skills\/[^/]+\/scripts\//)) {
    return {
      success: false,
      error: `🚫 Do not read skill script source code. Execute scripts directly via bash:\n\n` +
             `bash: cd <skill_directory> && python scripts/<script_name>.py [args]\n\n` +
             `Use \`load_skill\` with operation "get" to read the skill's SKILL.md instructions.`
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
    
    // Check file size first
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large (${(fileStat.size / 1024 / 1024).toFixed(2)} MB). Max size: ${MAX_FILE_SIZE / 1024 / 1024} MB.\n` +
               `Use start_line/end_line parameters to read specific portions.`
      };
    }
    
    const content = await readFile(fullPath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    
    // Apply line filters
    let startLine = args.start_line ?? 1;
    let endLine = args.end_line ?? totalLines;
    const maxLines = args.max_lines ?? (totalLines > DEFAULT_MAX_LINES ? DEFAULT_MAX_LINES : undefined);
    
    // Validate and adjust line numbers
    startLine = Math.max(1, Math.min(startLine, totalLines));
    endLine = Math.max(startLine, Math.min(endLine, totalLines));
    
    // Apply max_lines limit
    if (maxLines && (endLine - startLine + 1) > maxLines) {
      endLine = startLine + maxLines - 1;
    }
    
    // Extract lines (convert to 0-based index)
    const selectedLines = lines.slice(startLine - 1, endLine);
    
    // Build output with line numbers
    let output = '';
    
    // Add header if reading partial file
    const isPartial = startLine > 1 || endLine < totalLines;
    if (isPartial) {
      output += `[Lines ${startLine}-${endLine} of ${totalLines}]\n\n`;
    }
    
    // Add content with line numbers for easier reference
    output += selectedLines.map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(6, ' ');
      return `${lineNum}|${line}`;
    }).join('\n');
    
    // Add truncation notice if applicable
    if (endLine < totalLines && maxLines) {
      output += `\n\n[... ${totalLines - endLine} more lines. Use start_line=${endLine + 1} to continue reading.]`;
    }
    
    return {
      success: true,
      output
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to read file: ${error.message}`
    };
  }
}

