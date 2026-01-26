
/**
 * OpenAI-based runner - replacement for Claude SDK
 * Gives us full control over requests, tools, and streaming
 */

import OpenAI from 'openai';
import type { ServerEvent } from "../types.js";
import type { Session } from "./session-store.js";
import { loadApiSettings } from "./settings-store.js";
import { loadLLMProviderSettings } from "./llm-providers-store.js";
import { TOOLS, getTools, generateToolsSummary } from "./tools-definitions.js";
import { getInitialPrompt, getSystemPrompt } from "./prompt-loader.js";
import { getTodosSummary, getTodos, setTodos, clearTodos } from "./tools/manage-todos-tool.js";
import { ToolExecutor } from "./tools-executor.js";
import type { FileChange } from "../types.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { isGitRepo, getRelativePath, getFileDiffStats } from "../git-utils.js";
import { join } from "path";
import { homedir } from "os";

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

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

// Logging - organized by session folders with turn-based request/response files
const getSessionLogsDir = (sessionId: string) => {
  const baseDir = join(homedir(), '.localdesk', 'logs', 'sessions', sessionId);
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
};

const logTurn = (sessionId: string, iteration: number, type: 'request' | 'response', data: any) => {
  try {
    const logsDir = getSessionLogsDir(sessionId);
    const paddedIteration = String(iteration).padStart(3, '0');
    const filename = `turn-${paddedIteration}-${type}.json`;
    const filepath = join(logsDir, filename);
    
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    
    if (type === 'request' && iteration === 1) {
      console.log(`[OpenAI Runner] Session logs: ${logsDir}`);
    }
  } catch (error) {
    console.error(`[OpenAI Runner] Failed to write ${type} log:`, error);
  }
};

const redactMessagesForLog = (messages: ChatMessage[]) => {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;

    const sanitized = message.content.map((item: any) => {
      if (item?.type !== 'image_url' || !item.image_url?.url) return item;
      const url = item.image_url.url;
      const placeholder = typeof url === 'string' && url.startsWith('data:')
        ? 'data:image/webp;base64,<redacted>'
        : url;
      return {
        ...item,
        image_url: {
          ...item.image_url,
          url: placeholder
        }
      };
    });

    return { ...message, content: sanitized };
  });
};


export async function runClaude(options: RunnerOptions): Promise<RunnerHandle> {
  const { prompt, session, onEvent, onSessionUpdate } = options;
  let aborted = false;
  const abortController = new AbortController();
  const MAX_STREAM_RETRIES = 3;
  const RETRY_BASE_DELAY_MS = 500;

  // Token tracking (declare outside try block for catch access)
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // CRITICAL: Clear todos from any previous session FIRST
  // They will be restored from DB if this is an existing session
  clearTodos(session.id);

  // Permission tracking
  const pendingPermissions = new Map<string, { resolve: (approved: boolean) => void }>();

  const sendMessage = (type: string, content: any) => {
    onEvent({
      type: "stream.message" as any,
      payload: { sessionId: session.id, message: { type, ...content } as any }
    });
  };

  // Save to DB without triggering UI updates
  const saveToDb = (type: string, content: any) => {
    const sessionStore = (global as any).sessionStore;
    if (sessionStore && session.id) {
      sessionStore.recordMessage(session.id, { type, ...content });
    }
  };

  const sendPermissionRequest = (toolUseId: string, toolName: string, input: unknown, explanation?: string) => {
    onEvent({
      type: "permission.request",
      payload: { sessionId: session.id, toolUseId, toolName, input, explanation }
    });
  };

  const resolvePermission = (toolUseId: string, approved: boolean) => {
    const pending = pendingPermissions.get(toolUseId);
    if (pending) {
      pending.resolve(approved);
      pendingPermissions.delete(toolUseId);
    }
  };

  // Store last error body for error handling
  let lastErrorBody: string | null = null;

  const sendSystemNotice = (text: string) => {
    sendMessage('system', { subtype: 'notice', text });
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isRetryableNetworkError = (error: unknown): boolean => {
    if (!error) return false;
    const err = error as any;
    const message = String(err.message || '').toLowerCase();
    const causeMessage = String(err.cause?.message || '').toLowerCase();
    const code = err.cause?.code || err.code;
    const status = err.status || err.statusCode;

    if (code && ['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'ENETRESET', 'ECONNREFUSED'].includes(code)) {
      return true;
    }
    if (status && [408, 429, 500, 502, 503, 504].includes(Number(status))) {
      return true;
    }
    if (message.includes('terminated') || message.includes('fetch failed')) {
      return true;
    }
    if (message.includes('socket') || causeMessage.includes('other side closed')) {
      return true;
    }
    return false;
  };

  // Start the query in the background
  (async () => {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterationCount = 0;
    let sessionStartTime = Date.now();

    try {
      // Determine if model is from LLM provider (contains ::)
      const isLLMProviderModel = session.model?.includes('::');
      
      let apiKey: string;
      let baseURL: string;
      let modelName: string;
      let temperature: number | undefined;
      let providerInfo = '';
      
      if (isLLMProviderModel && session.model) {
        // Extract provider ID and model ID
        const [providerId, modelId] = session.model.split('::');
        
        // Load LLM provider settings
        const llmSettings = loadLLMProviderSettings();
        
        if (!llmSettings) {
          throw new Error('LLM Provider settings not found. Please configure providers in Settings (⚙️).');
        }
        
        // Find the provider
        const provider = llmSettings.providers.find(p => p.id === providerId);
        
        if (!provider) {
          throw new Error(`Provider ${providerId} not found. Please check your LLM provider settings.`);
        }
        
        // Set up API configuration from provider
        apiKey = provider.apiKey;
        
        // Determine base URL based on provider type
        if (provider.type === 'openrouter') {
          baseURL = 'https://openrouter.ai/api/v1';
        } else if (provider.type === 'zai') {
          const prefix = provider.zaiApiPrefix === 'coding' ? 'api/coding/paas' : 'api/paas';
          baseURL = `https://api.z.ai/${prefix}/v4`;
        } else {
          baseURL = provider.baseUrl || '';
        }
        
        modelName = modelId;
        temperature = session.temperature; // undefined means don't send
        providerInfo = `${provider.name} (${provider.type})`;
      } else {
        // Use legacy API settings
        const guiSettings = loadApiSettings();
        
        if (!guiSettings || !guiSettings.baseUrl || !guiSettings.model) {
          throw new Error('API settings not configured. Please set API Key, Base URL and Model in Settings (⚙️).');
        }
        
        if (!guiSettings.apiKey) {
          throw new Error('API Key is missing. Please configure it in Settings (⚙️).');
        }

        apiKey = guiSettings.apiKey;
        baseURL = guiSettings.baseUrl;
        modelName = guiSettings.model;
        temperature = session.temperature; // undefined means don't send
        providerInfo = 'Legacy API';
      }
      
      // Load legacy settings for other configuration (tools, permissions, etc)
      const guiSettings = loadApiSettings();

      // Custom fetch to capture error response bodies
      const originalFetch = global.fetch;
      const customFetch = async (url: any, options: any) => {
        const response = await originalFetch(url, options);
        
        // Clone response to read body for errors
        if (!response.ok && response.status >= 400) {
          const clonedResponse = response.clone();
          try {
            const errorBody = await clonedResponse.text();
            console.error(`[OpenAI Runner] API Error Response (${response.status}):`, errorBody);
            // Store for catch block
            lastErrorBody = errorBody;
          } catch (e) {
            console.error('[OpenAI Runner] Failed to read error body:', e);
          }
        }
        
        return response;
      };

      // Initialize OpenAI client with custom fetch and timeout
      const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for long operations
      const client = new OpenAI({
        apiKey: apiKey || 'dummy-key',
        baseURL: baseURL,
        dangerouslyAllowBrowser: false,
        fetch: customFetch as any,
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 2
      });

      // Get scheduler store from global (may be undefined in sidecar mode)
      const schedulerStore = (global as any).schedulerStore || undefined;

      // Initialize tool executor with API settings for web tools
      // If no cwd, pass empty string to enable "no workspace" mode
      // schedulerStore is optional - schedule_task tool won't be available without it
      const toolExecutor = new ToolExecutor(session.cwd || '', guiSettings, schedulerStore);

      // Build conversation history from session
      const currentCwd = session.cwd || 'No workspace folder';
      
      // Function to load memory
      const loadMemory = async (): Promise<string | undefined> => {
        if (guiSettings?.enableMemory === false) return undefined;
        
        try {
          const { readFile, access } = await import('fs/promises');
          const { constants } = await import('fs');
          const { join } = await import('path');
          const { homedir } = await import('os');
          
          const memoryPath = join(homedir(), '.localdesk', 'memory.md');
          
          await access(memoryPath, constants.F_OK);
          const content = await readFile(memoryPath, 'utf-8');
          console.log('[OpenAI Runner] Memory loaded from:', memoryPath);
          return content;
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            console.warn('[OpenAI Runner] Failed to load memory:', error.message);
          }
          return undefined;
        }
      };
      
      // Load memory initially
      let memoryContent = await loadMemory();
      
      // Get initial tools for system prompt
      const initialTools = getTools(guiSettings);
      const initialToolsSummary = generateToolsSummary(initialTools);
      
      // Build system prompt with tools summary and optional todos
      let systemContent = getSystemPrompt(currentCwd, initialToolsSummary);
      const todosSummary = getTodosSummary(session.id);
      if (todosSummary) {
        systemContent += todosSummary;
      }
      
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemContent
        }
      ];

      // Load previous messages from session history
      const sessionStore = (global as any).sessionStore;
      let lastUserPrompt = '';
      let isFirstUserPrompt = true;
      
      if (sessionStore && session.id) {
        const history = sessionStore.getSessionHistory(session.id);

        // Clear todos from previous session for this sessionId, then load from history
        clearTodos(session.id);
        if (history && history.todos && history.todos.length > 0) {
          console.log(`[OpenAI Runner] Loading ${history.todos.length} todos from history for session ${session.id}`);
          setTodos(session.id, history.todos);
        }
        
        if (history && history.messages.length > 0) {
          console.log(`[OpenAI Runner] Loading ${history.messages.length} messages from history`);
          
          let currentAssistantText = '';
          let currentToolCalls: any[] = [];
          let pendingToolResults: Map<string, { output: string; isError: boolean }> = new Map();
          
          // Convert session history to OpenAI format (proper tool call format)
          for (const msg of history.messages) {
            if (msg.type === 'user_prompt') {
              const promptText = (msg as any).prompt || '';
              
              // Flush any pending assistant message with tool calls
              if (currentAssistantText.trim() || currentToolCalls.length > 0) {
                // Add assistant message (with or without tool calls)
                const assistantMsg: ChatMessage = {
                  role: 'assistant',
                  content: currentAssistantText.trim() || ''
                };
                if (currentToolCalls.length > 0) {
                  assistantMsg.tool_calls = currentToolCalls;
                }
                messages.push(assistantMsg);
                
                // Add tool results as separate messages (OpenAI format)
                for (const tc of currentToolCalls) {
                  const result = pendingToolResults.get(tc.id);
                  if (result) {
                    messages.push({
                      role: 'tool',
                      tool_call_id: tc.id,
                      name: tc.function.name,
                      content: result.isError ? `Error: ${result.output}` : result.output
                    });
                  }
                }
                
                currentAssistantText = '';
                currentToolCalls = [];
                pendingToolResults.clear();
              }
              
              // Track last user prompt to avoid duplication
              lastUserPrompt = promptText;
              
              // ALWAYS format user prompts with date (even from history)
              const formattedPromptText = isFirstUserPrompt 
                ? getInitialPrompt(promptText, memoryContent)
                : getInitialPrompt(promptText);
              isFirstUserPrompt = false;
              
              messages.push({
                role: 'user',
                content: formattedPromptText
              });
            } else if (msg.type === 'text') {
              // Accumulate text into assistant message
              currentAssistantText += (msg as any).text || '';
            } else if (msg.type === 'tool_use') {
              // Add tool call in OpenAI format
              const toolId = (msg as any).id || `call_${Date.now()}_${currentToolCalls.length}`;
              const toolName = (msg as any).name || 'unknown';
              const toolInput = (msg as any).input || {};
              
              currentToolCalls.push({
                id: toolId,
                type: 'function',
                function: {
                  name: toolName,
                  arguments: JSON.stringify(toolInput)
                }
              });
            } else if (msg.type === 'tool_result') {
              // Store tool result for pairing with tool call
              const toolUseId = (msg as any).tool_use_id;
              const output = (msg as any).output || '';
              const isError = (msg as any).is_error || false;
              
              if (toolUseId) {
                pendingToolResults.set(toolUseId, { output, isError });
              }
            }
            // Skip other message types (system, etc.)
          }
          
          // Flush final assistant message if any
          if (currentAssistantText.trim() || currentToolCalls.length > 0) {
            const assistantMsg: ChatMessage = {
              role: 'assistant',
              content: currentAssistantText.trim() || ''
            };
            if (currentToolCalls.length > 0) {
              assistantMsg.tool_calls = currentToolCalls;
            }
            messages.push(assistantMsg);
            
            // Add tool results
            for (const tc of currentToolCalls) {
              const result = pendingToolResults.get(tc.id);
              if (result) {
                messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  name: tc.function.name,
                  content: result.isError ? `Error: ${result.output}` : result.output
                });
              }
            }
          }
        }
      }

      // Add current prompt ONLY if it's different from the last one in history
      if (prompt !== lastUserPrompt) {
        // Always format prompt with current date for context
        // Add memory only if this is a new session (no history)
        const shouldAddMemory = messages.length === 1; // Only system message exists
        const formattedPrompt = shouldAddMemory 
          ? getInitialPrompt(prompt, memoryContent)
          : getInitialPrompt(prompt);
        messages.push({
          role: 'user',
          content: formattedPrompt
        });
      }

      // Track total usage across all iterations
      totalInputTokens = 0;
      totalOutputTokens = 0;
      sessionStartTime = Date.now();

      // Use initial tools (will be refreshed each iteration)
      let activeTools = initialTools;
      let currentGuiSettings = guiSettings;
      
      console.log(`\n[OpenAI Runner] ══════════════════════════════════════`);
      console.log(`[OpenAI Runner] Session: ${session.id}`);
      console.log(`[OpenAI Runner] Provider: ${providerInfo}`);
      console.log(`[OpenAI Runner] Model: ${modelName}`);
      console.log(`[OpenAI Runner] Temperature: ${temperature !== undefined ? temperature : '(not sent)'}`)
      console.log(`[OpenAI Runner] Base URL: ${baseURL}`);
      console.log(`[OpenAI Runner] Messages: ${messages.length}`);
      console.log(`[OpenAI Runner] Tools: ${activeTools.length} (${activeTools.map(t => t.function.name).join(', ')})`);
      console.log(`[OpenAI Runner] ══════════════════════════════════════\n`);
      
      // Session logs will be saved to: ~/.localdesk/logs/sessions/{sessionId}/
      console.log(`[OpenAI Runner] Session logs: ~/.localdesk/logs/sessions/${session.id}/`);

      // Send system init message
      sendMessage('system', {
        subtype: 'init',
        cwd: session.cwd || 'No workspace folder',
        session_id: session.id,
        tools: activeTools.map(t => t.function.name),
        model: modelName,
        permissionMode: currentGuiSettings?.permissionMode || 'ask',
        memoryEnabled: currentGuiSettings?.enableMemory || false
      });

      // Update session with ID for resume support
      if (onSessionUpdate) {
        onSessionUpdate({ claudeSessionId: session.id });
      }

      // Main agent loop
      iterationCount = 0;
      const MAX_ITERATIONS = 50;
      
      // Loop detection: track recent tool calls
      const recentToolCalls: { name: string; args: string }[] = [];
      const LOOP_DETECTION_WINDOW = 5; // Check last N tool calls
      const LOOP_THRESHOLD = 5; // Same tool called N times = loop
      const MAX_LOOP_RETRIES = 5; // Max retries before stopping
      let loopRetryCount = 0;
      let loopHintAdded = false;

      while (!aborted && iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        
        // Reload settings to pick up any changes (e.g. Tavily API key, memory enabled)
        const freshSettings = loadApiSettings();
        if (freshSettings) {
          const newTools = getTools(freshSettings);
          const oldToolNames = activeTools.map(t => t.function.name).sort().join(',');
          const newToolNames = newTools.map(t => t.function.name).sort().join(',');
          
          if (oldToolNames !== newToolNames) {
            console.log(`[OpenAI Runner] Tools updated: ${activeTools.length} → ${newTools.length}`);
            activeTools = newTools;
            currentGuiSettings = freshSettings;
            // Update tool executor with new settings
            toolExecutor.updateSettings(freshSettings);
          }
        }
        
        // Update system prompt with current tools summary and todos
        const currentToolsSummary = generateToolsSummary(activeTools);
        const updatedTodosSummary = getTodosSummary(session.id);
        let updatedSystemContent = getSystemPrompt(currentCwd, currentToolsSummary);
        if (updatedTodosSummary) {
          updatedSystemContent += updatedTodosSummary;
        }
        messages[0] = { role: 'system', content: updatedSystemContent };
        
        console.log(`\n[OpenAI Runner] ▶ Iteration ${iterationCount} | Messages: ${messages.length} | Tools: ${activeTools.length}`);

        // Log request to file
        const requestPayload = {
          model: modelName,
          messages: redactMessagesForLog(messages),
          tools: activeTools,
          temperature,
          timestamp: new Date().toISOString()
        };
        logTurn(session.id, iterationCount, 'request', requestPayload);

        const runStreamWithRetries = async () => {
          let lastError: unknown;

          for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
            let assistantMessage = '';
            let toolCalls: any[] = [];
            let contentStarted = false;
            let streamMetadata: { id?: string; model?: string; created?: number; finishReason?: string; usage?: any } = {};

            try {
              const stream = await client.chat.completions.create({
                model: modelName,
                messages: messages as any[],
                tools: activeTools as any[],
                stream: true,
                parallel_tool_calls: true,
                stream_options: { include_usage: true },
                ...(temperature !== undefined ? { temperature } : {})
              }, { signal: abortController.signal });

              for await (const chunk of stream) {
                if (aborted) {
                  console.log('[OpenAI Runner] Stream aborted by user');
                  break;
                }

                if (!streamMetadata.id && chunk.id) {
                  streamMetadata.id = chunk.id;
                  streamMetadata.model = chunk.model;
                  streamMetadata.created = chunk.created;
                }
                if (chunk.choices?.[0]?.finish_reason) {
                  streamMetadata.finishReason = chunk.choices[0].finish_reason;
                }
                if (chunk.usage) {
                  streamMetadata.usage = chunk.usage;
                }

                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                  if (!contentStarted) {
                    contentStarted = true;
                    sendMessage('stream_event', {
                      event: {
                        type: 'content_block_start',
                        content_block: {
                          type: 'text',
                          text: ''
                        },
                        index: 0
                      }
                    });
                  }

                  assistantMessage += delta.content;
                  sendMessage('stream_event', {
                    event: {
                      type: 'content_block_delta',
                      delta: {
                        type: 'text_delta',
                        text: delta.content
                      },
                      index: 0
                    }
                  });
                }

                if (delta.tool_calls) {
                  for (const toolCall of delta.tool_calls) {
                    if (toolCall.index !== undefined) {
                      if (!toolCalls[toolCall.index]) {
                        toolCalls[toolCall.index] = {
                          id: toolCall.id || `call_${Date.now()}_${toolCall.index}`,
                          type: 'function',
                          function: {
                            name: toolCall.function?.name || '',
                            arguments: toolCall.function?.arguments || ''
                          }
                        };
                      } else if (toolCall.function?.arguments) {
                        toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                      }
                    }
                  }
                }
              }

              if (contentStarted) {
                sendMessage('stream_event', {
                  event: {
                    type: 'content_block_stop',
                    index: 0
                  }
                });
              }

              return { assistantMessage, toolCalls, streamMetadata };
            } catch (error) {
              lastError = error;
              const retryable = isRetryableNetworkError(error);

              if (contentStarted) {
                sendMessage('stream_event', {
                  event: {
                    type: 'content_block_stop',
                    index: 0
                  }
                });
              }

              if (aborted || !retryable || attempt === MAX_STREAM_RETRIES) {
                const finalError = error instanceof Error ? error : new Error(String(error));
                (finalError as any).retryable = retryable;
                (finalError as any).retryAttempts = Math.min(attempt, MAX_STREAM_RETRIES);
                throw finalError;
              }

              const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt;
              sendSystemNotice(`Network error detected. Retrying (${attempt + 1}/${MAX_STREAM_RETRIES})...`);
              console.warn(`[OpenAI Runner] Stream error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_STREAM_RETRIES})`, error);
              await sleep(delayMs);
            }
          }

          throw lastError ?? new Error('Unknown stream error');
        };

        const { assistantMessage, toolCalls, streamMetadata } = await runStreamWithRetries();

        // Check if aborted during stream
        if (aborted) {
          console.log('[OpenAI Runner] Session aborted during streaming');
          if (onSessionUpdate) {
            onSessionUpdate({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
          }
          onEvent({
            type: "session.status",
            payload: {
              sessionId: session.id,
              status: "idle",
              title: session.title
            }
          });
          return;
        }
        
        // Accumulate token usage
        if (streamMetadata.usage) {
          totalInputTokens += streamMetadata.usage.prompt_tokens || 0;
          totalOutputTokens += streamMetadata.usage.completion_tokens || 0;
        }
        
        // Log response to file
        const responsePayload = {
          id: streamMetadata.id,
          model: streamMetadata.model,
          finish_reason: streamMetadata.finishReason,
          usage: streamMetadata.usage,
          message: {
            role: 'assistant',
            content: assistantMessage || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          },
          timestamp: new Date().toISOString()
        };
        logTurn(session.id, iterationCount, 'response', responsePayload);
        
        console.log(`[OpenAI Runner] ──────────────────────────────────────`);
        
        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          
          // Send assistant message for UI display
          sendMessage('assistant', {
            message: {
              id: `msg_${Date.now()}`,
              content: [{ type: 'text', text: assistantMessage }]
            }
          });

          // Save as 'text' type to DB (without triggering UI update)
          saveToDb('text', {
            text: assistantMessage,
            uuid: `msg_${Date.now()}_db`
          });

          sendMessage('result', {
            subtype: 'success',
            is_error: false,
            duration_ms: Date.now() - sessionStartTime,
            duration_api_ms: Date.now() - sessionStartTime, // Approximate API time
            num_turns: iterationCount,
            result: assistantMessage,
            session_id: session.id,
            total_cost_usd: 0,
            usage: {
              input_tokens: totalInputTokens,
              output_tokens: totalOutputTokens
            }
          });

          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status: "completed", title: session.title }
          });

          break;
        }

        // LOOP DETECTION: Check if model is stuck calling same tool repeatedly
        // Skip loop detection for parallel tool calls (batches of 2+ tools)
        // Parallel batches are intentional, not loops - even if same tool called multiple times
        const isParallelBatch = toolCalls.length > 1;
        
        if (!isParallelBatch) {
          // Only track single tool calls
          const toolCall = toolCalls[0];
          const callSignature = { 
            name: toolCall.function.name, 
            args: toolCall.function.arguments || '' 
          };
          recentToolCalls.push(callSignature);
          
          // Keep only last N calls
          if (recentToolCalls.length > LOOP_DETECTION_WINDOW) {
            recentToolCalls.shift();
          }
        } else {
          // Parallel batch - clear loop detection (intentional parallel work)
          console.log(`[OpenAI Runner] Parallel batch (${toolCalls.length} tools) - resetting loop detection`);
          recentToolCalls.length = 0;
        }
        
        // Check for loops: same tool called LOOP_THRESHOLD times in a row
        if (recentToolCalls.length >= LOOP_THRESHOLD) {
          const lastCalls = recentToolCalls.slice(-LOOP_THRESHOLD);
          const allSameTool = lastCalls.every(c => c.name === lastCalls[0].name);
          
          if (allSameTool) {
            const loopedTool = lastCalls[0].name;
            loopRetryCount++;
            
            console.warn(`[OpenAI Runner] ⚠️ LOOP DETECTED: Tool "${loopedTool}" called ${LOOP_THRESHOLD}+ times (retry ${loopRetryCount}/${MAX_LOOP_RETRIES})`);
            
            // Check if we've exceeded max retries
            if (loopRetryCount >= MAX_LOOP_RETRIES) {
              console.error(`[OpenAI Runner] ❌ Loop not resolved after ${MAX_LOOP_RETRIES} retries. Stopping.`);
              
              // Send warning to UI
              sendMessage('text', {
                text: `⚠️ **Loop detected**: The model is stuck calling \`${loopedTool}\` repeatedly (${MAX_LOOP_RETRIES} retries exhausted).\n\nPlease try:\n- Rephrasing your request\n- Using a larger/smarter model\n- Breaking down your task into smaller steps`
              });
              
              // Save warning to DB
              saveToDb('text', {
                text: `[LOOP] Model stuck calling ${loopedTool} repeatedly. Stopped after ${loopRetryCount} retries.`,
                uuid: `loop_warning_${Date.now()}`
              });
              
              // End session with error
              sendMessage('result', {
                subtype: 'error',
                is_error: true,
                duration_ms: Date.now() - sessionStartTime,
                duration_api_ms: Date.now() - sessionStartTime,
                num_turns: iterationCount,
                result: `Loop not resolved: ${loopedTool} called repeatedly`,
                session_id: session.id,
                total_cost_usd: 0,
                usage: {
                  input_tokens: totalInputTokens,
                  output_tokens: totalOutputTokens
                }
              });

              if (onSessionUpdate) {
                onSessionUpdate({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
              }
              onEvent({
                type: "session.status",
                payload: {
                  sessionId: session.id,
                  status: "idle",
                  title: session.title
                }
              });

              return; // Exit the runner
            }
            
            // Add hint to help model break out of loop
            if (!loopHintAdded) {
              loopHintAdded = true;
              console.log(`[OpenAI Runner] Adding loop-break hint to messages`);
            }
            
            // Clear recent calls to give model fresh start
            recentToolCalls.length = 0;
          }
        }

        // Add assistant message with tool calls to history
        messages.push({
          role: 'assistant',
          content: assistantMessage || '',
          tool_calls: toolCalls
        });

        // Save text response if any (before tool calls)
        if (assistantMessage.trim()) {
          saveToDb('text', {
            text: assistantMessage,
            uuid: `msg_text_${Date.now()}`
          });
        }

        // Helper to safely parse tool arguments
        const safeParseToolArgs = (args: string | undefined, toolName: string): Record<string, any> => {
          if (!args || args === '') return {};
          try {
            return JSON.parse(args);
          } catch (e) {
            console.error(`[OpenAI Runner] Failed to parse tool arguments for ${toolName}:`, args);
            // Try to fix common JSON issues
            try {
              // Sometimes model outputs truncated JSON, try to close it
              const fixed = args.replace(/,\s*$/, '') + '}';
              return JSON.parse(fixed);
            } catch {
              // Return error info as argument
              return { _parse_error: `Invalid JSON: ${args.substring(0, 200)}...` };
            }
          }
        };

        // Send tool use messages
        for (const toolCall of toolCalls) {
          const toolInput = safeParseToolArgs(toolCall.function.arguments, toolCall.function.name);
          
          // For UI display - assistant message with tool_use
          sendMessage('assistant', {
            message: {
              id: `msg_${toolCall.id}`,
              content: [{
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function.name,
                input: toolInput
              }]
            }
          });
          
          // For DB storage - tool_use type (without UI update)
          saveToDb('tool_use', {
            id: toolCall.id,
            name: toolCall.function.name,
            input: toolInput,
            uuid: `tool_${toolCall.id}`
          });
        }

        // Execute tools
        const toolResults: ChatMessage[] = [];
        const followUpMessages: ChatMessage[] = [];

        for (const toolCall of toolCalls) {
          if (aborted) {
            console.log('[OpenAI Runner] Tool execution aborted by user');
            break;
          }

          const toolName = toolCall.function.name;
          const toolArgs = safeParseToolArgs(toolCall.function.arguments, toolName);

          // Check for parse error
          if (toolArgs._parse_error) {
            console.error(`[OpenAI Runner] Skipping tool ${toolName} due to parse error`);
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: Failed to parse tool arguments. ${toolArgs._parse_error}`
            });
            continue;
          }

          // Request permission
          const toolUseId = toolCall.id;
          // Reload settings to get latest permissionMode
          const currentSettings = loadApiSettings();
          const permissionMode = currentSettings?.permissionMode || 'ask';
          
          console.log(`[OpenAI Runner] Executing tool: ${toolName} (permission mode: ${permissionMode})`, toolArgs);
          
          if (permissionMode === 'ask') {
            // Send permission request and wait for user approval
            sendPermissionRequest(toolUseId, toolName, toolArgs, toolArgs.explanation);
            
            // Wait for permission result from UI with abort check
            const approved = await new Promise<boolean>((resolve) => {
              pendingPermissions.set(toolUseId, { resolve });
              
              // Check abort periodically
              const checkAbort = setInterval(() => {
                if (aborted) {
                  clearInterval(checkAbort);
                  pendingPermissions.delete(toolUseId);
                  resolve(false);
                }
              }, 100);
              
              // Clean up interval when resolved
              pendingPermissions.get(toolUseId)!.resolve = (approved: boolean) => {
                clearInterval(checkAbort);
                resolve(approved);
              };
            });
            
            if (aborted) {
              console.log(`[OpenAI Runner] Tool execution aborted while waiting for permission: ${toolName}`);
              break;
            }
            
            if (!approved) {
              console.log(`[OpenAI Runner] Tool execution denied by user: ${toolName}`);
              
              // Add error result for denied tool
              toolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolName,
                content: 'Error: Tool execution denied by user'
              });
              
              continue; // Skip this tool
            }
          }
          // In default mode, execute immediately without asking

          // Execute tool with callback for todos persistence
          const result = await toolExecutor.executeTool(toolName, toolArgs, {
            sessionId: session.id,
            onTodosChanged: (todos) => {
              // Save to DB
              if (sessionStore && session.id) {
                sessionStore.saveTodos(session.id, todos);
              }
              // Emit event for UI
              onEvent({
                type: 'todos.updated',
                payload: { sessionId: session.id, todos }
              });
            }
          });

          if (toolName === 'attach_image' && result.success && result.data && (result.data as any).dataUrl) {
            const data = result.data as { dataUrl: string; fileName?: string };
            followUpMessages.push({
              role: 'user',
              content: [
                { type: 'text', text: `Attached image: ${data.fileName || 'image'}` },
                { type: 'image_url', image_url: { url: data.dataUrl } }
              ]
            });
          }

          // If Memory tool was executed successfully, reload memory for next iteration
          if (toolName === 'manage_memory' && result.success) {
            console.log('[OpenAI Runner] Memory tool executed, reloading memory...');
            memoryContent = await loadMemory();
          }

          // Track file changes for write_file and edit_file
          if ((toolName === 'write_file' || toolName === 'edit_file') && result.success) {
            const filePath = toolArgs.file_path || toolArgs.path;
            if (filePath && session.cwd && sessionStore) {
              try {
                // Only track changes if this is a git repository
                if (!isGitRepo(session.cwd)) {
                  console.log(`[OpenAI Runner] Skipping file change tracking - not a git repository: ${session.cwd}`);
                } else {
                  // Get relative path from project root
                  const relativePath = getRelativePath(filePath, session.cwd);
                  // Get git diff stats for the file
                  const diffStats = getFileDiffStats(filePath, session.cwd);

                  if (diffStats.additions > 0 || diffStats.deletions > 0) {
                    // Create FileChange entry
                    const fileChange: FileChange = {
                      path: relativePath,
                      additions: diffStats.additions,
                      deletions: diffStats.deletions,
                      status: 'pending'
                    };
                    // Add to session store
                    sessionStore.addFileChanges(session.id, [fileChange]);
                    console.log(`[OpenAI Runner] File change tracked: ${fileChange.path} (+${fileChange.additions} -${fileChange.deletions})`);
                    // Emit event for UI update
                    onEvent({
                      type: 'file_changes.updated',
                      payload: { sessionId: session.id, fileChanges: sessionStore.getFileChanges(session.id) }
                    });
                  }
                }
              } catch (error) {
                console.error('[OpenAI Runner] Failed to track file changes:', error);
              }
            }
          }

          // Add tool result to messages
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.success 
              ? (result.output || 'Success') 
              : `Error: ${result.error}`
          });

          // Send tool result message for UI
          sendMessage('user', {
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: result.success ? result.output : `Error: ${result.error}`,
                is_error: !result.success
              }]
            }
          });
          
          // Save for DB storage (without UI update)
          saveToDb('tool_result', {
            tool_use_id: toolCall.id,
            output: result.success ? result.output : `Error: ${result.error}`,
            is_error: !result.success,
            uuid: `tool_result_${toolCall.id}`
          });
        }

        // Check if aborted during tool execution
        if (aborted) {
          console.log('[OpenAI Runner] Session aborted during tool execution');
          if (onSessionUpdate) {
            onSessionUpdate({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
          }
          onEvent({
            type: "session.status",
            payload: {
              sessionId: session.id,
              status: "idle",
              title: session.title
            }
          });
          return;
        }

        // Add all tool results to messages
        messages.push(...toolResults, ...followUpMessages);
        
        // Add loop-breaking hint if loop was detected
        if (loopHintAdded && loopRetryCount > 0) {
          messages.push({
            role: 'user',
            content: `⚠️ IMPORTANT: You've been calling the same tool repeatedly without making progress. Please:
1. STOP and think about what you're trying to achieve
2. Try a DIFFERENT approach or tool
3. If the task is complete, respond to the user
4. If stuck, explain what's blocking you

DO NOT call the same tool again with similar arguments.`
          });
          loopHintAdded = false; // Reset so we don't add it every time
        }
        
        // If memory was updated, refresh the first user message with new memory
        if (memoryContent !== undefined && messages.length > 1 && messages[1].role === 'user') {
          // Find the first user message (index 1, after system)
          const firstUserMsg = messages[1];
          if (typeof firstUserMsg.content === 'string') {
            // Extract the original request from the message
            const match = firstUserMsg.content.match(/ORIGINAL USER REQUEST:\n\n([\s\S]+)$/);
            if (match) {
              const originalRequest = match[1];
              // Regenerate the message with updated memory
              messages[1] = {
                role: 'user',
                content: getInitialPrompt(originalRequest, memoryContent)
              };
              console.log('[OpenAI Runner] Updated first user message with refreshed memory');
            }
          }
        }
      }

      if (iterationCount >= MAX_ITERATIONS) {
        throw new Error('Max iterations reached');
      }

    } catch (error: any) {
      console.error('[OpenAI Runner] Error:', error);

      const retryable = Boolean((error as any)?.retryable);
      const retryAttempts = (error as any)?.retryAttempts ?? 0;
      
      // Extract detailed error message from API response
      let errorMessage = error instanceof Error ? error.message : String(error);

      sendMessage('result', {
        subtype: 'error',
        is_error: true,
        duration_ms: Date.now() - sessionStartTime,
        duration_api_ms: Date.now() - sessionStartTime,
        num_turns: iterationCount,
        result: errorMessage,
        session_id: session.id,
        total_cost_usd: 0,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens
        },
        retryable: retryable,
        retryPrompt: prompt,
        retryAttempts: retryAttempts
      });
      
      // Check for timeout errors
      if (error.name === 'TimeoutError' || error.message?.includes('timeout') || error.code === 'ETIMEDOUT') {
        errorMessage = '⏱️ Request timed out. The server took too long to respond. Try again or use a faster model.';
      }
      // Check if we captured the error body via custom fetch
      else if (lastErrorBody) {
        try {
          const errorBody = JSON.parse(lastErrorBody);
          if (errorBody.detail) {
            errorMessage = `${errorBody.detail}`;
          } else if (errorBody.error) {
            errorMessage = `${errorBody.error}`;
          } else {
            errorMessage = `API Error: ${JSON.stringify(errorBody)}`;
          }
        } catch (parseError) {
          // Not JSON, use raw text
          errorMessage = lastErrorBody;
        }
      } else if (error.error) {
        // OpenAI SDK error object
        errorMessage = typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      // Add status code for clarity if available
      if (error.status && !errorMessage.includes(`${error.status}`)) {
        errorMessage = `[${error.status}] ${errorMessage}`;
      }
      
      // Send error message to chat
      sendMessage('text', { text: `\n\n❌ **Error:** ${errorMessage}\n\nPlease check your API settings (Base URL, Model Name, API Key) and try again.` });
      saveToDb('text', { text: `\n\n❌ **Error:** ${errorMessage}\n\nPlease check your API settings (Base URL, Model Name, API Key) and try again.` });
      
      if (onSessionUpdate) {
        onSessionUpdate({ inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
      }
      onEvent({
        type: "session.status",
        payload: { 
          sessionId: session.id, 
          status: "idle", 
          title: session.title, 
          error: errorMessage 
        }
      });
    }
  })();

  return {
    abort: () => {
      aborted = true;
      abortController.abort();
      console.log('[OpenAI Runner] Aborted');
    },
    resolvePermission: (toolUseId: string, approved: boolean) => {
      resolvePermission(toolUseId, approved);
    }
  };
}
