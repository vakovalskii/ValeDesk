
/**
 * OpenAI-based runner - replacement for Claude SDK
 * Gives us full control over requests, tools, and streaming
 */

import OpenAI from 'openai';
import type { ServerEvent } from "../types.js";
import type { Session } from "./session-store.js";
import { loadApiSettings } from "./settings-store.js";
import { TOOLS, getTools, getSystemPrompt } from "./tools-definitions.js";
import { getInitialPrompt } from "./prompt-loader.js";
import { getTodosSummary, getTodos } from "./tools/manage-todos-tool.js";
import { ToolExecutor } from "./tools-executor.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
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
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

// Logging
const getLogsDir = () => {
  const logsDir = join(homedir(), '.localdesk', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
};

const logApiRequest = (sessionId: string, data: any) => {
  try {
    const logsDir = getLogsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `openai-request-${sessionId}-${timestamp}.json`;
    const filepath = join(logsDir, filename);
    
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[OpenAI Runner] Request logged to: ${filepath}`);
  } catch (error) {
    console.error('[OpenAI Runner] Failed to write log:', error);
  }
};

export async function runClaude(options: RunnerOptions): Promise<RunnerHandle> {
  const { prompt, session, onEvent, onSessionUpdate } = options;
  let aborted = false;

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

  // Start the query in the background
  (async () => {
    try {
      // Load settings
      const guiSettings = loadApiSettings();
      
      if (!guiSettings || !guiSettings.baseUrl || !guiSettings.model) {
        throw new Error('API settings not configured. Please set API Key, Base URL and Model in Settings (⚙️).');
      }
      
      if (!guiSettings.apiKey) {
        throw new Error('API Key is missing. Please configure it in Settings (⚙️).');
      }

      // Ensure baseURL ends with /v1 for OpenAI compatibility
      let baseURL = guiSettings.baseUrl;


      console.log(`[OpenAI Runner] Starting with model: ${guiSettings.model}`);
      console.log(`[OpenAI Runner] Base URL: ${baseURL}`);
      console.log(`[OpenAI Runner] Temperature: ${guiSettings.temperature || 0.3}`);

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

      // Initialize OpenAI client with custom fetch
      const client = new OpenAI({
        apiKey: guiSettings.apiKey || 'dummy-key',
        baseURL: baseURL,
        dangerouslyAllowBrowser: false,
        fetch: customFetch as any
      });

      // Initialize tool executor with API settings for web tools
      // If no cwd, pass empty string to enable "no workspace" mode
      const toolExecutor = new ToolExecutor(session.cwd || '', guiSettings);

      // Build conversation history from session
      const currentCwd = session.cwd || 'No workspace folder';
      
      // Function to load memory
      const loadMemory = async (): Promise<string | undefined> => {
        if (!guiSettings?.enableMemory) return undefined;
        
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
      
      // Build system prompt with optional todos
      let systemContent = getSystemPrompt(currentCwd);
      const todosSummary = getTodosSummary();
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
        if (history && history.messages.length > 0) {
          console.log(`[OpenAI Runner] Loading ${history.messages.length} messages from history`);
          
          let currentAssistantMessage = '';
          let currentMessageHasTools = false;
          let currentMessageNoteAdded = false;
          let pendingToolUse: any = null;
          
          // Convert session history to OpenAI format
          for (const msg of history.messages) {
            if (msg.type === 'user_prompt') {
              const promptText = (msg as any).prompt || '';
              
              // Flush any pending assistant message
              if (currentAssistantMessage.trim()) {
                messages.push({
                  role: 'assistant',
                  content: currentAssistantMessage.trim()
                });
                currentAssistantMessage = '';
                currentMessageHasTools = false;
                currentMessageNoteAdded = false;
              }
              
              // Track last user prompt to avoid duplication
              lastUserPrompt = promptText;
              
              // ALWAYS format user prompts with date (even from history)
              // This ensures consistent context for the model
              // Only add memory to the FIRST user prompt
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
              currentAssistantMessage += (msg as any).text || '';
            } else if (msg.type === 'tool_use') {
              // Mark that this message has tools
              currentMessageHasTools = true;
              
              // Add note about compressed history on first tool call in THIS message
              if (!currentMessageNoteAdded) {
                currentAssistantMessage += `\n\n---\nNote: The following shows compressed tool execution history for context. To perform actions, use actual function calling.\n---\n\n`;
                currentMessageNoteAdded = true;
              }
              
              // Store tool use for pairing with result
              pendingToolUse = msg;
            } else if (msg.type === 'tool_result') {
              // Compressed tool history: CSV format - tool,explanation,result
              if (pendingToolUse) {
                const toolName = (pendingToolUse as any).name || 'Unknown';
                const toolInput = (pendingToolUse as any).input || {};
                const explanation = toolInput.explanation || 'No explanation';
                const output = (msg as any).output || '';
                const isError = (msg as any).is_error;
                const briefOutput = output.substring(0, 80).replace(/\n/g, ' ');
                
                currentAssistantMessage += `${toolName},${explanation},${isError ? 'ERROR: ' : ''}${briefOutput}${output.length > 80 ? '...' : ''}\n`;
                pendingToolUse = null;
              }
            }
            // Skip other message types (system, etc.)
          }
          
          // Flush final assistant message if any
          if (currentAssistantMessage.trim()) {
            messages.push({
              role: 'assistant',
              content: currentAssistantMessage.trim()
            });
            currentMessageHasTools = false;
            currentMessageNoteAdded = false;
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
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const sessionStartTime = Date.now();

      // Log request
      const activeTools = getTools(guiSettings);
      
      logApiRequest(session.id, {
        model: guiSettings.model,
        messages,
        tools: activeTools,
        temperature: guiSettings.temperature || 0.3
      });

      // Send system init message
      sendMessage('system', {
        subtype: 'init',
        cwd: session.cwd || 'No workspace folder',
        session_id: session.id,
        tools: activeTools.map(t => t.function.name),
        model: guiSettings.model,
        permissionMode: guiSettings.permissionMode || 'ask',
        memoryEnabled: guiSettings.enableMemory || false
      });

      // Update session with ID for resume support
      if (onSessionUpdate) {
        onSessionUpdate({ claudeSessionId: session.id });
      }

      // Main agent loop
      let iterationCount = 0;
      const MAX_ITERATIONS = 50;
      
      // Loop detection: track recent tool calls
      const recentToolCalls: { name: string; args: string }[] = [];
      const LOOP_DETECTION_WINDOW = 5; // Check last N tool calls
      const LOOP_THRESHOLD = 3; // Same tool called N times = loop
      const MAX_LOOP_RETRIES = 5; // Max retries before stopping
      let loopRetryCount = 0;
      let loopHintAdded = false;

      while (!aborted && iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        console.log(`[OpenAI Runner] Iteration ${iterationCount}`);
        console.log(`[OpenAI Runner] Messages count: ${messages.length}`);
        console.log(`[OpenAI Runner] All messages:`, JSON.stringify(messages, null, 2));

        // Prepare request payload for logging
        const requestPayload = {
          model: guiSettings.model,
          messages: messages,
          tools: activeTools,
          temperature: guiSettings.temperature || 0.3,
          stream: true,
          parallel_tool_calls: true,  // Enable parallel tool calls
          stream_options: { include_usage: true }  // Include token usage in stream
        };

        // Log full request
        console.log('[OpenAI Runner] ===== RAW REQUEST =====');
        console.log(JSON.stringify(requestPayload, null, 2));
        console.log('[OpenAI Runner] ===== END REQUEST =====');

        // Call OpenAI API (with explicit typing)
        const stream = await client.chat.completions.create({
          model: guiSettings.model,
          messages: messages as any[],
          tools: activeTools as any[],
          temperature: guiSettings.temperature || 0.3,
          stream: true,
          parallel_tool_calls: true,
          stream_options: { include_usage: true }
        });

        let assistantMessage = '';
        let toolCalls: any[] = [];
        let currentToolCall: any = null;
        let contentStarted = false;
        
        // OPTIMIZATION: Only track metadata, not all chunks (memory leak!)
        let streamMetadata: { id?: string; model?: string; created?: number; finishReason?: string; usage?: any } = {};

        // Process stream
        for await (const chunk of stream) {
          if (aborted) {
            console.log('[OpenAI Runner] Stream aborted by user');
            break;
          }

          // Track metadata from first/last chunks (lightweight)
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

          // Text content
          if (delta.content) {
            // Send content_block_start on first chunk
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
            
            // Send streaming text
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

          // Tool calls
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
                } else {
                  if (toolCall.function?.arguments) {
                    toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                  }
                }
              }
            }
          }
        }

        // Send content_block_stop if content was streamed
        if (contentStarted) {
          sendMessage('stream_event', {
            event: {
              type: 'content_block_stop',
              index: 0
            }
          });
        }

        // Check if aborted during stream
        if (aborted) {
          console.log('[OpenAI Runner] Session aborted during streaming');
          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status: "idle", title: session.title }
          });
          return;
        }
        
        // OPTIMIZATION: Lightweight logging (no JSON.stringify on large objects)
        console.log(`[OpenAI Runner] Stream complete: ${assistantMessage.length} chars, ${toolCalls.length} tools, finish: ${streamMetadata.finishReason}`);
        
        // Accumulate token usage
        if (streamMetadata.usage) {
          totalInputTokens += streamMetadata.usage.prompt_tokens || 0;
          totalOutputTokens += streamMetadata.usage.completion_tokens || 0;
        }
        
        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          console.log(`[OpenAI Runner] Final assistant response (no tools):`, assistantMessage);
          
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
        for (const toolCall of toolCalls) {
          const callSignature = { 
            name: toolCall.function.name, 
            args: toolCall.function.arguments || '' 
          };
          recentToolCalls.push(callSignature);
          
          // Keep only last N calls
          if (recentToolCalls.length > LOOP_DETECTION_WINDOW) {
            recentToolCalls.shift();
          }
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
              
              onEvent({
                type: "session.status",
                payload: { sessionId: session.id, status: "idle", title: session.title }
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

        // Send tool use messages
        for (const toolCall of toolCalls) {
          const toolInput = JSON.parse(toolCall.function.arguments || '{}');
          
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

        for (const toolCall of toolCalls) {
          if (aborted) {
            console.log('[OpenAI Runner] Tool execution aborted by user');
            break;
          }

          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

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

          // Execute tool
          const result = await toolExecutor.executeTool(toolName, toolArgs);

          // If Memory tool was executed successfully, reload memory for next iteration
          if (toolName === 'manage_memory' && result.success) {
            console.log('[OpenAI Runner] Memory tool executed, reloading memory...');
            memoryContent = await loadMemory();
          }
          
          // If manage_todos was executed, emit todos update event
          if (toolName === 'manage_todos' && result.success) {
            const todos = getTodos();
            onEvent({
              type: 'todos.updated',
              payload: { sessionId: session.id, todos }
            });
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
          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status: "idle", title: session.title }
          });
          return;
        }
        
        // Add all tool results to messages
        messages.push(...toolResults);
        
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
      
      // Extract detailed error message from API response
      let errorMessage = String(error);
      
      // Check if we captured the error body via custom fetch
      if (lastErrorBody) {
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
      console.log('[OpenAI Runner] Aborted');
    },
    resolvePermission: (toolUseId: string, approved: boolean) => {
      resolvePermission(toolUseId, approved);
    }
  };
}
