# Tool Development Guide

## Tool System Overview

LocalDesk uses OpenAI-compatible function calling. Each tool is defined with:
- JSON schema for parameters
- Execution function
- Optional permission requirements

## Available Tools

| Category | Tool | Description |
|----------|------|-------------|
| **File** | `read_file` | Read text files (max 5MB) |
| **File** | `write_file` | Create new files |
| **File** | `edit_file` | Modify files via search/replace |
| **File** | `search_files` | Find files by glob pattern |
| **File** | `search_text` | Grep-like text search |
| **File** | `read_document` | Extract text from PDF/DOCX |
| **File** | `attach_image` | Attach local image for model input |
| **Code** | `execute_js` | Run JS in Node.js vm sandbox |
| **Code** | `execute_python` | Run Python code (system Python + pip) |
| **System** | `run_command` | Execute shell commands |
| **Web** | `search_web` | Internet search (Tavily/Z.AI) |
| **Web** | `fetch_html` | Fetch URL content |
| **Web** | `fetch_json` | Fetch and parse JSON |
| **Web** | `download_file` | Download files from URL |
| **Browser** | `browser_*` | Full browser automation (navigate, click, type, etc.) |
| **Git** | `git_*` | Git operations (status, log, diff, commit, etc.) |
| **Memory** | `manage_memory` | Persistent user preferences |
| **Tasks** | `manage_todos` | Task planning with UI |
| **Skills** | `load_skill` | Load specialized instructions |
| **Scheduler** | `schedule_task` | Create recurring/delayed tasks |

**Note**: Tools are passed dynamically via function calling - not hardcoded in system prompt.

## Creating a New Tool

### 1. Create Tool File

Path: `src/agent/libs/tools/your-tool.ts`

```typescript
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// Tool definition (OpenAI function calling format)
export const yourToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'your_tool',  // snake_case, verb_noun pattern
    description: 'Clear description of what the tool does',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'What this parameter does'
        },
        param2: {
          type: 'number',
          description: 'Optional parameter'
        }
      },
      required: ['param1']
    }
  }
};

// Execution function
export async function executeYourTool(
  args: { param1: string; param2?: number },
  cwd: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    // Your logic here
    const result = `Processed: ${args.param1}`;
    
    return { success: true, output: result };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}
```

### 2. Register Tool

Add to `src/agent/libs/tools/index.ts`:

```typescript
import { yourToolDefinition, executeYourTool } from './your-tool.js';

export const ALL_TOOL_DEFINITIONS = [
  // ... existing tools
  yourToolDefinition,
];

// In executors map
export const TOOL_EXECUTORS = {
  // ... existing executors
  'your_tool': executeYourTool,
};
```

### 3. Add to Tools Executor

Update `src/agent/libs/tools-executor.ts` if tool needs special handling.

## Tool Naming Convention

**Pattern**: `verb_noun`

Good:
- `read_file`, `write_file`, `edit_file`
- `search_web`, `search_files`, `search_text`
- `execute_js`, `run_command`
- `manage_todos`, `manage_memory`

Bad:
- `fileReader` (camelCase)
- `file_read` (noun_verb)
- `readFile` (camelCase)

## Code Sandboxes

### execute_js (Node.js vm sandbox)

**Available** (globals, no imports needed):
- `fs.readFileSync`, `fs.writeFileSync`, `fs.readdirSync`, `fs.existsSync`
- `path.join`, `path.resolve`, `path.dirname`, `path.basename`, `path.extname`
- `console.log`, `console.error`, `console.warn`, `console.info`
- `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `RegExp`
- `__dirname` (workspace path)

**NOT Available**:
- `require()`, `import` - no modules, no npm packages
- `async`/`await`, `Promise` - no async
- `setTimeout`, `setInterval` - no timers
- `fetch` - no network

### execute_python (System subprocess)

**Available**:
- Full Python 3 standard library
- ALL pip-installed packages (numpy, pandas, requests, etc.)
- File I/O within workspace
- `print()` output captured

**Limitations**:
- Requires Python 3 on user's system
- pip packages must be pre-installed (or use bash to install)
- Runs in workspace directory

## Tool Permission Modes

Defined in Settings:
- `ask` - User confirms each tool execution
- `default` - Auto-approve safe tools

Tools that always require confirmation:
- `run_command` (shell execution)
- `write_file`, `edit_file` (file modifications)

## Testing Tools

1. Start dev mode: `npm run dev`
2. Open chat, ask model to use your tool
3. Check console for errors
4. Verify tool result in chat

Debug logging:
```typescript
console.log(`[YourTool] Processing: ${args.param1}`);
```
