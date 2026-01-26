import { query, type SDKMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ServerEvent } from "../types.js";
import type { Session } from "./session-store.js";
import { claudeCodePath, getEnhancedEnv } from "./util.js";
import { loadApiSettings } from "./settings-store.js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";
// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

const https = require("https");
const http = require("http");


export type RunnerOptions = {
  prompt: string;
  session: Session;
  resumeSessionId?: string;
  onEvent: (event: ServerEvent) => void;
  onSessionUpdate?: (updates: Partial<Session>) => void;
};

export type RunnerHandle = {
  abort: () => void;
  resolvePermission: (toolUseId: string, approved: boolean) => void;
};

const DEFAULT_CWD = process.cwd();

// Create logs directory
const getLogsDir = () => {
  const logsDir = join(homedir(), '.localdesk', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
};

// Log API request to file
const logApiRequest = (sessionId: string, data: any, suffix: string = '') => {
  try {
    const logsDir = getLogsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `request-${sessionId}-${timestamp}${suffix}.json`;
    const filepath = join(logsDir, filename);

    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[API Log] Request saved to: ${filepath}`);

    // Also append to main log file
    const mainLog = join(logsDir, 'requests.log');
    appendFileSync(mainLog, `\n\n=== ${timestamp}${suffix} ===\n${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[API Log] Failed to write log:', error);
  }
};

// Intercept HTTP/HTTPS requests to log them
let httpInterceptorInstalled = false;

const installHttpInterceptor = (sessionId: string) => {
  if (httpInterceptorInstalled) return;
  httpInterceptorInstalled = true;

  // Save original request methods
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  // Intercept http.request
  (http as any).request = function (...args: any[]) {
    const req = (originalHttpRequest as any).apply(this, args);
    interceptRequest(req, sessionId, 'http');
    return req;
  };

  // Intercept https.request
  (https as any).request = function (...args: any[]) {
    const req = (originalHttpsRequest as any).apply(this, args);
    interceptRequest(req, sessionId, 'https');
    return req;
  };

  console.log('[HTTP Interceptor] Installed');
};

const interceptRequest = (req: any, sessionId: string, protocol: string) => {
  const originalWrite = req.write;
  const originalEnd = req.end;
  let body = '';

  // Capture request body
  req.write = function (chunk: any, ...args: any[]) {
    if (chunk) {
      body += chunk.toString();
    }
    return originalWrite.apply(req, [chunk, ...args]);
  };

  req.end = function (chunk: any, ...args: any[]) {
    if (chunk) {
      body += chunk.toString();
    }

    // Log the request if it looks like an API call
    if (body && body.length > 0) {
      try {
        const jsonBody = JSON.parse(body);

        // Check if this is an LLM API request (has messages or prompt)
        if (jsonBody.messages || jsonBody.prompt || jsonBody.model) {
          console.log('[HTTP Interceptor] Captured API request');

          const requestLog = {
            timestamp: new Date().toISOString(),
            protocol,
            method: req.method,
            path: req.path,
            headers: req.getHeaders ? req.getHeaders() : {},
            body: jsonBody
          };

          logApiRequest(sessionId, requestLog, '-http-actual');
        }
      } catch (e) {
        // Not JSON or parsing error, skip
      }
    }

    return originalEnd.apply(req, [chunk, ...args]);
  };
};


export async function runClaude(options: RunnerOptions): Promise<RunnerHandle> {
  const { prompt, session, resumeSessionId, onEvent, onSessionUpdate } = options;
  const abortController = new AbortController();

  const sendMessage = (message: SDKMessage) => {
    onEvent({
      type: "stream.message",
      payload: { sessionId: session.id, message }
    });
  };

  const sendPermissionRequest = (toolUseId: string, toolName: string, input: unknown, explanation?: string) => {
    onEvent({
      type: "permission.request",
      payload: { sessionId: session.id, toolUseId, toolName, input, explanation }
    });
  };

  // Extract explanation from tool input (optional)
  const extractExplanation = (input: unknown): string | undefined => {
    if (!input || typeof input !== "object") {
      return undefined;
    }

    const inputObj = input as Record<string, unknown>;

    // Check for explanation field (optional)
    if (inputObj.explanation && typeof inputObj.explanation === "string") {
      return inputObj.explanation;
    }

    return undefined;
  };

  // Start the query in the background
  (async () => {
    try {
      // Install HTTP interceptor to capture actual API requests
      installHttpInterceptor(session.id);

      // Extract model name from session.model (format: provider-id::model-name)
      let modelName = session.model;
      if (modelName?.includes('::')) {
        modelName = modelName.split('::')[1];
      }

      // Load GUI settings with priority over default settings
      const guiSettings = loadApiSettings();
      const env = getEnhancedEnv(guiSettings);

      // Override model if specified in session
      if (modelName) {
        env.ANTHROPIC_MODEL = modelName;
      }

      // Use temperature from session if provided
      if (session.temperature !== undefined) {
        env.ANTHROPIC_TEMPERATURE = String(session.temperature);
        env.TEMPERATURE = String(session.temperature);
      }

      // Log all parameters being sent to SDK
      const apiRequestLog = {
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        prompt,
        env: {
          ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
          ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
          ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '***REDACTED***' : undefined,
          ANTHROPIC_TEMPERATURE: env.ANTHROPIC_TEMPERATURE,
          TEMPERATURE: env.TEMPERATURE,
        },
        options: {
          cwd: session.cwd ?? DEFAULT_CWD,
          permissionMode: "default",
          includePartialMessages: true,
          systemPrompt: "Using Claude Code preset + custom append for tool usage rules",
        }
      };

      // Save to file
      logApiRequest(session.id, apiRequestLog);

      // Console logging
      console.log(`[Agent] Starting query with prompt: ${prompt.substring(0, 100)}...`);
      console.log(`[Agent] Full prompt:`, prompt);
      console.log(`[Agent] Using model from env:`, env.ANTHROPIC_MODEL);
      console.log(`[Agent] Base URL:`, env.ANTHROPIC_BASE_URL);
      console.log(`[Agent] Temperature:`, env.ANTHROPIC_TEMPERATURE || env.TEMPERATURE);
      console.log(`[Agent] Permission Mode: default (requires user approval)`);
      console.log(`[Agent] System Prompt: Using Claude Code preset + custom append to prevent tool hallucination`);
      console.log(`[Agent] Request log saved to: ~/.localdesk/logs/`);

      const q = query({
        prompt,
        options: {
          cwd: session.cwd ?? DEFAULT_CWD,
          resume: resumeSessionId,
          abortController,
          env,
          pathToClaudeCodeExecutable: claudeCodePath,
          permissionMode: "default", // Changed: require permission for double verification
          includePartialMessages: true,
          // Use default Claude Code tools (Bash, Read, Write, Edit, Glob, Grep, Task, etc.)
          // SDK automatically provides these to the model via JSON schema
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: `
CRITICAL TOOL USAGE RULES:
1. You MUST ONLY use tools from this exact list: Bash, Read, Write, Edit, Glob, Grep, Task, TaskOutput, AskUserQuestion, WebFetch, LS, ExitPlanMode
2. NEVER invent tool names like "Skill", "Command", "Execute", or any other name not in the list above
3. Tool name matching is CASE-SENSITIVE - use exact capitalization (e.g., "Bash" not "bash")
4. If you want to execute a shell command → use "Bash" tool
5. If you want to read a file → use "Read" tool
6. If you want to create a file → use "Write" tool
7. If you want to search for files → use "Glob" tool
8. If you want to search in file contents → use "Grep" tool
9. If you're unsure → use "AskUserQuestion" tool to clarify

REQUIRED: When using any tool, you MUST provide an "explanation" field in the input describing why you're calling this tool.

Example correct tool usage:
{
  "name": "Bash",
  "input": {
    "command": "ls -la",
    "explanation": "I need to list files in the current directory to understand the project structure"
  }
}

WRONG examples (DO NOT DO THIS):
- {"name": "Skill", ...} ← WRONG: "Skill" is not a valid tool
- {"name": "bash", ...} ← WRONG: lowercase, should be "Bash"
- {"name": "Command", ...} ← WRONG: no such tool exists
`
          },
          canUseTool: async (toolName, input, { signal }) => {
            // Debug logging for tool calls
            console.log(`[Tool Call] ${toolName}`, {
              input: JSON.stringify(input).substring(0, 200),
              explanation: extractExplanation(input)
            });
            // Extract explanation if provided (optional for compatibility)
            const explanation = extractExplanation(input);

            // For AskUserQuestion or any tool, use double verification with user
            // This is especially important for local models like vLLM that may generate incorrect tools
            const toolUseId = crypto.randomUUID();

            // Send permission request to frontend with explanation
            sendPermissionRequest(toolUseId, toolName, input, explanation);

            // Create a promise that will be resolved when user responds
            return new Promise<PermissionResult>((resolve) => {
              session.pendingPermissions.set(toolUseId, {
                toolUseId,
                toolName,
                input,
                resolve: (result) => {
                  session.pendingPermissions.delete(toolUseId);
                  resolve(result as PermissionResult);
                }
              });

              // Handle abort
              signal.addEventListener("abort", () => {
                session.pendingPermissions.delete(toolUseId);
                resolve({ behavior: "deny", message: "Session aborted" });
              });
            });
          }
        }
      });

      // Capture session_id from init message
      for await (const message of q) {
        // Debug log all messages
        console.log(`[SDK Message] Type: ${message.type}`, JSON.stringify(message).substring(0, 200));

        // Extract session_id from system init message
        if (message.type === "system" && "subtype" in message && message.subtype === "init") {
          const sdkSessionId = message.session_id;
          if (sdkSessionId) {
            session.claudeSessionId = sdkSessionId;
            onSessionUpdate?.({ claudeSessionId: sdkSessionId });
          }
        }

        // Send message to frontend
        sendMessage(message);

        // Check for result to update session status
        if (message.type === "result") {
          const status = message.subtype === "success" ? "completed" : "error";
          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status, title: session.title }
          });
        }
      }

      // Query completed normally
      if (session.status === "running") {
        onEvent({
          type: "session.status",
          payload: { sessionId: session.id, status: "completed", title: session.title }
        });
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Session was aborted, don't treat as error
        return;
      }
      onEvent({
        type: "session.status",
        payload: { sessionId: session.id, status: "error", title: session.title, error: String(error) }
      });
    }
  })();

  return {
    abort: () => abortController.abort(),
    resolvePermission: (toolUseId: string, approved: boolean) => {
      const pending = session.pendingPermissions.get(toolUseId);
      if (pending) {
        pending.resolve({ behavior: approved ? "allow" : "deny" });
      }
    }
  };
}
