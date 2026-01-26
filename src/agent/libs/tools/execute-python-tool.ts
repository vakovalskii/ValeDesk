/**
 * ExecutePython Tool - Execute Python code
 * Requires Python 3 installed on user's machine
 */

import { executePython } from '../container/quickjs-sandbox.js';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

export const ExecutePythonToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "execute_python",
    description: `Execute Python code using system Python 3. CAN use pip-installed libraries!

**AVAILABLE**:
- Full Python 3 standard library (json, os, sys, re, math, datetime, etc.)
- ALL pip-installed packages (numpy, pandas, requests, pillow, etc.)
- File I/O within workspace
- print() output captured

**EXAMPLE**:
import json
import os

# Use standard library
data = {"items": [1, 2, 3]}
print(json.dumps(data, indent=2))

# File operations
files = os.listdir('.')
print(f"Found {len(files)} files")

# Use pip packages (if installed on user's system):
# import numpy as np
# import pandas as pd
# import requests

**IF IMPORT FAILS**: Package not installed. Use bash tool to run: pip install <package>

**LIMITATIONS**: 
- Requires Python 3 on user's system
- pip packages must be pre-installed (or use bash to install)
- Code runs in workspace directory`,
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why you're executing this code and what it should do"
        },
        code: {
          type: "string",
          description: "Python code to execute"
        },
        timeout: {
          type: "number",
          description: "Execution timeout in milliseconds (default: 30000, max: 60000)",
          minimum: 1000,
          maximum: 60000
        }
      },
      required: ["explanation", "code"]
    }
  }
};

export async function executePythonTool(
  args: { code: string; explanation: string; timeout?: number },
  context: ToolExecutionContext
): Promise<ToolResult> {
  const timeout = Math.min(args.timeout || 30000, 60000);
  
  console.log('[ExecutePython] Starting execution');
  console.log('[ExecutePython] Timeout:', timeout);
  console.log('[ExecutePython] Context CWD:', context.cwd);
  console.log('[ExecutePython] Code length:', args.code.length);
    
  try {
    const result = await executePython(
      args.code,
      context.cwd,
      context.isPathSafe,
      timeout
    );
    
    if (result.success) {
      let output = '✅ Python code executed successfully\n\n';
    
      if (result.logs.length > 0) {
        output += '**Output:**\n```\n' + result.logs.join('\n') + '\n```\n\n';
      }
    
      if (result.output && result.output !== result.logs.join('\n')) {
        output += '**Result:**\n```\n' + result.output + '\n```';
      }
    
      return { success: true, output };
    } else {
      let errorMsg = `❌ Python execution failed: ${result.error}\n\n`;
    
      // Show truncated code for debugging
      errorMsg += `**Your code:**\n\`\`\`python\n${args.code.substring(0, 500)}${args.code.length > 500 ? '\n# ... truncated ...' : ''}\n\`\`\`\n\n`;
    
      if (result.logs.length > 0) {
        errorMsg += `\n**Output before error:**\n\`\`\`\n${result.logs.join('\n')}\n\`\`\``;
      }
      
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    return {
      success: false,
      error: `❌ Python execution failed: ${error.message}`
    };
  }
}
