import readline from "node:readline";
import type { ClientEvent } from "../ui/types.js";
import type { ServerEvent } from "../agent/types.js";
import type { SidecarInboundMessage, SidecarOutboundMessage } from "./protocol.js";

// Use in-memory session store - no SQLite/better-sqlite3 dependency
import { MemorySessionStore } from "./session-store-memory.js";

import { runClaude as runClaudeSDK } from "../agent/libs/runner.js";
import { runClaude as runOpenAI } from "../agent/libs/runner-openai.js";
import { loadApiSettings, saveApiSettings } from "../agent/libs/settings-store.js";
import { generateSessionTitle } from "../agent/libs/util.js";
import { loadLLMProviderSettings, saveLLMProviderSettings } from "../agent/libs/llm-providers-store.js";
import { fetchModelsFromProvider, checkModelsAvailability } from "../agent/libs/llm-providers.js";
import { loadSkillsSettings, toggleSkill, setMarketplaceUrl, addRepository, updateRepository, removeRepository, toggleRepository } from "../agent/libs/skills-store.js";
import { fetchSkillsFromMarketplace } from "../agent/libs/skills-loader.js";
import { webCache } from "../agent/libs/web-cache.js";
import * as gitUtils from "../agent/git-utils.js";
import { openAIOAuthConfig, startBrowserOAuthFlow, stopOAuthFlow, getCredential, setCredential, deleteCredential, isExpired, readCodexCliCredentials } from "../agent/libs/auth/index.js";
import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  MiniWorkflowStore,
  buildStepPrompt,
  getLlmSteps,
  checkDistillability,
  writeReplayLog,
} from "../agent/libs/mini-workflow.js";
import {
  extractJsonObject,
  getLlmConnection,
  llmCall,
  distillChain,
  validateWorkflow,
  getMiniWorkflowSchemaPrompt,
  buildVerificationPrompt,
  buildRefinePrompt,
  redactDebugLog,
  type DistillDebugLog,
  type DistillUsage,
  type VerifyResult,
  type ReplayResult,
} from "../agent/libs/distill-service.js";

const miniWorkflowStore = new MiniWorkflowStore();
const distillAbortControllers = new Map<string, AbortController>();

async function safeRmDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`[safeRmDir] Failed to remove ${dir}: ${(err as Error).message}`);
  }
}

function getDataDir(): string {
  return join(homedir(), ".valera");
}

type RunnerHandle = {
  abort: () => void;
  resolvePermission: (toolUseId: string, approved: boolean) => void;
};

function writeOut(msg: SidecarOutboundMessage) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function emit(event: ServerEvent) {
  writeOut({ type: "server-event", event });
}

// In-memory session store - persistent data is handled by Rust/Tauri
const sessions = new MemorySessionStore();

// Sync session changes to Rust DB
sessions.setSyncCallback((type, sessionId, data) => {
  emit({
    type: "session.sync",
    payload: { syncType: type, sessionId, data }
  } as any);
});

// Make sessionStore globally available for runner (matches Electron behavior)
// Note: schedulerStore is now handled by Tauri
(global as any).sessionStore = sessions;

const runnerHandles = new Map<string, RunnerHandle>();
const stoppedSessionIds = new Set<string>();
const refineAbortControllers = new Map<string, AbortController>();
const multiThreadTasks = new Map<string, any>();
const STEP_OUTPUT_DIR = "__miniapp_steps";

function sanitizeStepFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "step";
}

function detectStepOutputExtension(content: string): ".json" | ".md" | ".txt" {
  const trimmed = content.trim();
  if (!trimmed) return ".txt";
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return ".json";
    } catch {
      // ignore
    }
  }
  if (trimmed.includes("```") || /^#{1,6}\s/m.test(trimmed)) return ".md";
  return ".txt";
}

function buildStepPreview(content: string, limit = 1200): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "Step completed without inline text output. Check saved artifacts in workspace.";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}\n...(preview truncated, full output saved to workspace)`;
}

function buildStepSummary(stepTitle: string, content: string, artifactPaths: string[]): string {
  const preview = content.replace(/\s+/g, " ").trim();
  const compactPreview = preview.length > 240 ? `${preview.slice(0, 240)}...` : preview;
  const artifactText = artifactPaths.length > 0 ? ` Saved artifacts: ${artifactPaths.join(", ")}` : "";
  return compactPreview
    ? `${stepTitle} completed.${artifactText} Preview: ${compactPreview}`
    : `${stepTitle} completed.${artifactText}`;
}

async function persistStepOutput(
  workspaceDir: string,
  step: { id: string; title?: string },
  content: string
): Promise<{ artifactPaths: string[]; compactResult: string; preview: string }> {
  const outputDir = join(workspaceDir, STEP_OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });

  const safeBase = sanitizeStepFileName(step.id);
  const extension = detectStepOutputExtension(content);
  const outputFileName = `${safeBase}${extension}`;
  const manifestFileName = `${safeBase}.manifest.json`;
  const outputPath = join(outputDir, outputFileName);
  const manifestPath = join(outputDir, manifestFileName);
  const preview = buildStepPreview(content);

  let fileContent = content;
  if (extension === ".json") {
    try {
      fileContent = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
    } catch {
      fileContent = content;
    }
  }
  await fs.writeFile(outputPath, fileContent, "utf8");

  const artifactPaths = [`${STEP_OUTPUT_DIR}/${outputFileName}`, `${STEP_OUTPUT_DIR}/${manifestFileName}`];
  await fs.writeFile(manifestPath, JSON.stringify({
    step_id: step.id,
    title: step.title || step.id,
    saved_at: new Date().toISOString(),
    output_file: artifactPaths[0],
    content_type: extension.slice(1),
    preview
  }, null, 2), "utf8");

  return {
    artifactPaths,
    compactResult: buildStepSummary(step.title || step.id, content, artifactPaths),
    preview
  };
}

function selectRunner(model: string | undefined) {
  if (model?.startsWith("claude-code::")) {
    return runClaudeSDK;
  }
  return runOpenAI;
}

function checkAndUpdateMultiThreadTaskStatus(sessionId: string) {
  for (const [taskId, task] of multiThreadTasks.entries()) {
    if (!Array.isArray(task.threadIds) || !task.threadIds.includes(sessionId)) continue;

    const threadStatuses = task.threadIds.map((id: string) => {
      const thread = sessions.getSession(id);
      return thread?.status || "idle";
    });

    const total = threadStatuses.length;
    const completed = threadStatuses.filter((s: string) => s === "completed").length;
    const error = threadStatuses.filter((s: string) => s === "error").length;
    const running = threadStatuses.filter((s: string) => s === "running").length;

    let newStatus: "created" | "running" | "completed" | "error" = task.status;
    if (running === 0) {
      if (error > 0) {
        newStatus = "error";
      } else if (completed === total) {
        newStatus = "completed";
      }
    }

    if (newStatus !== task.status) {
      task.status = newStatus;
      task.updatedAt = Date.now();
      emit({
        type: "task.status",
        payload: { taskId, status: newStatus },
      } as any);

      if (newStatus === "completed" && task.autoSummary) {
        void createSummaryThread(taskId, task).catch((error) => {
          sendRunnerError(`Failed to create summary thread: ${String(error)}`);
        });
      }
    }

    break;
  }
}

async function createSummaryThread(taskId: string, task: any) {
  const threadResponses: Array<{ threadId: string; model: string; messages: any[] }> = [];

  for (const threadId of task.threadIds as string[]) {
    const history = sessions.getSessionHistory(threadId);
    if (history?.messages) {
      const thread = sessions.getSession(threadId);
      threadResponses.push({
        threadId,
        model: thread?.model || "unknown",
        messages: history.messages,
      });
    }
  }

  const summaryPrompt = `You are a summarization assistant. Here are ${threadResponses.length} responses from different AI models working on the same task.

Task: "${task.title}"

${threadResponses
      .map(
        (r, i) => `
--- Thread ${i + 1} (${r.model}) ---
${r.messages
            .map((m) => {
              if (m.type === "user_prompt") return `User: ${m.prompt}`;
              if (m.type === "result" && m.content) return `Response: ${JSON.stringify(m.content)}`;
              return "";
            })
            .join("\n")}
--- End Thread ${i + 1} ---
`
      )
      .join("\n")}

Please provide:
1. A comprehensive summary of what all threads accomplished
2. Key findings or insights from each thread
3. Any contradictions or differences between threads
4. A final consolidated result or recommendation

Format your response clearly with sections.`;

  const summarySession = sessions.createSession({
    title: `${task.title} - Summary`,
    cwd: undefined,
    allowedTools: "",
    model: task.consensusModel || "gpt-4",
    threadId: "summary",
  });

  // Keep Electron-compatible behavior: add summary session to task threads.
  task.threadIds.push(summarySession.id);
  task.updatedAt = Date.now();

  const session = sessions.getSession(summarySession.id);
  if (!session) {
    throw new Error(`[sidecar] Failed to create summary session for task ${taskId}`);
  }

  sessions.updateSession(summarySession.id, { status: "running", lastPrompt: summaryPrompt });
  emitAndPersist({
    type: "stream.user_prompt",
    payload: { sessionId: summarySession.id, threadId: "summary", prompt: summaryPrompt },
  } as any);

  const runClaude = selectRunner(session.model);
  const handle = await runClaude({
    prompt: summaryPrompt,
    session,
    resumeSessionId: undefined,
    onEvent: emitAndPersist,
    onSessionUpdate: (updates: any) => {
      sessions.updateSession(summarySession.id, updates);
    },
  } as any);

  runnerHandles.set(summarySession.id, handle as any);
  sessions.setAbortController(summarySession.id, undefined);
}

/**
 * Calls the current session model once (non-streaming) to produce a summary of the conversation.
 */
async function callModelForSummary(
  session: ReturnType<typeof sessions.getSession>,
  conversationText: string,
  llmProviderSettings?: any,
  apiSettingsOverride?: any
): Promise<string> {
  if (!session) throw new Error('No session');

  let apiKey = '';
  let baseURL = '';
  let modelName = '';

  const llmSettings = llmProviderSettings || loadLLMProviderSettings();
  const isLLMProviderModel = session.model?.includes('::');
  let resolved = false;

  if (isLLMProviderModel && session.model) {
    const [providerId, modelId] = session.model.split('::');
    if (llmSettings) {
      const provider = llmSettings.providers.find((p: any) => p.id === providerId);
      if (provider) {
        apiKey = provider.apiKey;
        if (provider.type === 'openrouter') {
          baseURL = 'https://openrouter.ai/api/v1';
        } else if (provider.type === 'zai') {
          const prefix = provider.zaiApiPrefix === 'coding' ? 'api/coding/paas' : 'api/paas';
          baseURL = `https://api.z.ai/${prefix}/v4`;
        } else {
          baseURL = provider.baseUrl || '';
        }
        modelName = modelId;
        resolved = true;
      }
    }
  }

  // Fallback: try legacy API settings
  if (!resolved) {
    const guiSettings = apiSettingsOverride || loadApiSettings();
    if (guiSettings?.baseUrl && guiSettings?.model && guiSettings?.apiKey) {
      apiKey = guiSettings.apiKey;
      baseURL = guiSettings.baseUrl;
      modelName = guiSettings.model;
      resolved = true;
    }
  }

  // Fallback: use first available enabled provider + model
  if (!resolved && llmSettings) {
    for (const provider of llmSettings.providers) {
      if (!provider.enabled) continue;
      const providerModel = llmSettings.models?.find((m: any) => m.providerId === provider.id && m.enabled);
      if (!providerModel) continue;
      apiKey = provider.apiKey;
      if (provider.type === 'openrouter') {
        baseURL = 'https://openrouter.ai/api/v1';
      } else if (provider.type === 'zai') {
        const prefix = provider.zaiApiPrefix === 'coding' ? 'api/coding/paas' : 'api/paas';
        baseURL = `https://api.z.ai/${prefix}/v4`;
      } else {
        baseURL = provider.baseUrl || '';
      }
      modelName = providerModel.name || providerModel.id;
      resolved = true;
      writeOut({ type: "log", level: "info", message: `[Compact] Session provider not found, falling back to ${provider.name}/${modelName}`, context: {} });
      break;
    }
  }

  if (!resolved) {
    throw new Error('No LLM provider or API settings available for summarization');
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey: apiKey || 'dummy-key', baseURL, dangerouslyAllowBrowser: false, timeout: 60_000, maxRetries: 1 });

  const systemPrompt = `You are a conversation summarizer. Your task is to create a concise summary of the conversation history provided. The summary should:
- Capture the key topics discussed and decisions made
- Preserve important context, facts, code snippets, and file paths mentioned
- Be structured as bullet points grouped by topic
- Be compact but comprehensive enough to continue the conversation

Output ONLY the summary, no preamble.`;

  const completion = await client.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Please summarize this conversation history:\n\n${conversationText}` }
    ],
    stream: false
  });

  return (completion.choices[0]?.message?.content || '').trim();
}

/**
 * Performs a compact operation on a session:
 * 1. Gets full conversation history
 * 2. Summarizes it using the session's model
 * 3. Creates a new session pre-populated with the summary
 * 4. Emits session.compacted so UI can navigate to the new session
 */
async function performCompact(sessionId: string, nextPrompt?: string, llmProviderSettings?: any, apiSettingsOverride?: any): Promise<void> {
  const session = sessions.getSession(sessionId);
  if (!session) {
    writeOut({ type: "log", level: "error", message: "[Compact] Session not found", context: { sessionId } });
    return;
  }

  // Signal compacting is in progress
  emit({ type: "session.compacting", payload: { sessionId } } as any);

  // Get full history
  const history = sessions.getSessionHistory(sessionId);
  if (!history || history.messages.length === 0) {
    writeOut({ type: "log", level: "info", message: "[Compact] No messages to compact", context: { sessionId } });
    return;
  }

  // Format history as plain text for summarization
  const lines: string[] = [];
  for (const msg of history.messages) {
    if ((msg as any).type === 'user_prompt') {
      const text = (msg as any).prompt || '';
      if (text.trim()) lines.push(`User: ${text}`);
    } else if ((msg as any).type === 'text') {
      const text = (msg as any).text || '';
      if (text.trim()) lines.push(`Assistant: ${text}`);
    }
  }
  const conversationText = lines.join('\n\n');

  if (!conversationText.trim()) {
    writeOut({ type: "log", level: "info", message: "[Compact] No meaningful content to compact", context: { sessionId } });
    return;
  }

  // Summarize
  let summary = '';
  try {
    writeOut({ type: "log", level: "info", message: "[Compact] Calling model to summarize", context: { sessionId } });
    summary = await callModelForSummary(session, conversationText, llmProviderSettings, apiSettingsOverride);
    writeOut({ type: "log", level: "info", message: "[Compact] Summary generated", context: { length: summary.length } });
  } catch (e) {
    writeOut({ type: "log", level: "error", message: "[Compact] Failed to generate summary", context: { error: String(e) } });
    summary = `[Summary generation failed. Original conversation had ${lines.length} messages.]`;
  }

  // Create new session with same settings
  const newSession = sessions.createSession({
    title: `${session.title || 'Chat'} (compacted)`,
    cwd: session.cwd,
    allowedTools: session.allowedTools,
    model: session.model,
    temperature: session.temperature,
  });

  // Record the summary as the first user message (context carrier)
  const summaryUserMessage = `[Previous conversation summary]\n\n${summary}`;
  sessions.recordMessage(newSession.id, { type: 'user_prompt', prompt: summaryUserMessage } as any);

  // Broadcast updated session list
  emit({ type: "session.list", payload: { sessions: sessions.listSessions() } });

  // Notify UI about the compact result
  emit({ type: "session.compacted", payload: { oldSessionId: sessionId, newSessionId: newSession.id } } as any);

  // Auto-compact case: re-run the prompt that caused the error in the new session
  if (nextPrompt && nextPrompt.trim()) {
    const ns = sessions.getSession(newSession.id);
    if (ns) {
      sessions.updateSession(newSession.id, { status: 'running', lastPrompt: nextPrompt });
      emit({
        type: "session.status",
        payload: { sessionId: newSession.id, status: 'running', title: newSession.title, cwd: newSession.cwd, model: newSession.model }
      } as any);
      emitAndPersist({ type: "stream.user_prompt", payload: { sessionId: newSession.id, prompt: nextPrompt } } as any);

      const runClaude = selectRunner(ns.model);
      void runClaude({
        prompt: nextPrompt,
        session: ns,
        resumeSessionId: undefined,
        onEvent: emitAndPersist,
        onSessionUpdate: (updates: any) => { sessions.updateSession(newSession.id, updates); }
      } as any)
        .then((handle: RunnerHandle) => { runnerHandles.set(newSession.id, handle); })
        .catch((error: any) => {
          sessions.updateSession(newSession.id, { status: 'error' });
          sendRunnerError(String(error), newSession.id);
        });
    }
  }
}

function emitAndPersist(event: ServerEvent) {
  // Intercept auto-compact trigger from runner
  if ((event as any).type === "session.compact_needed") {
    const { sessionId, nextPrompt } = (event as any).payload;
    void performCompact(sessionId, nextPrompt).catch((e) => {
      writeOut({ type: "log", level: "error", message: "[Compact] Auto-compact error", context: { error: String(e) } });
    });
    return;
  }

  // Mirror the behavior in Electron ipc-handlers.ts:
  // - persist session.status and stream messages to DB
  if (event.type === "session.status") {
    sessions.updateSession(event.payload.sessionId, { status: event.payload.status });

    const payload = event.payload as any;
    if (payload.usage) {
      const { input_tokens, output_tokens } = payload.usage;
      if (input_tokens !== undefined || output_tokens !== undefined) {
        sessions.updateTokens(event.payload.sessionId, input_tokens || 0, output_tokens || 0);
      }
    }

    checkAndUpdateMultiThreadTaskStatus(event.payload.sessionId);
  }

  if (event.type === "stream.message") {
    const message = event.payload.message as any;
    if (message.type === "result" && message.usage) {
      const { input_tokens, output_tokens } = message.usage;
      if (input_tokens !== undefined || output_tokens !== undefined) {
        sessions.updateTokens(event.payload.sessionId, input_tokens || 0, output_tokens || 0);
      }
    }

    // Avoid storing stream_event messages in DB (same as Electron)
    if (message?.type !== "stream_event") {
      sessions.recordMessage(event.payload.sessionId, event.payload.message);
    }
  }

  if (event.type === "stream.user_prompt") {
    sessions.recordMessage(event.payload.sessionId, { type: "user_prompt", prompt: event.payload.prompt } as any);
  }

  emit(event);
}

function sendRunnerError(message: string, sessionId?: string) {
  emit({
    type: "runner.error",
    payload: sessionId ? { sessionId, message } : { message },
  } as any);
}

function handleSessionList() {
  emit({
    type: "session.list",
    payload: { sessions: sessions.listSessions() },
  });
}

function handleSessionHistory(event: Extract<ClientEvent, { type: "session.history" }>) {
  const { sessionId } = event.payload;
  // In-memory store doesn't support pagination, return full history
  const history = sessions.getSessionHistory(sessionId);

  if (!history) {
    sendRunnerError("Unknown session");
    return;
  }

  emit({
    type: "session.history",
    payload: {
      sessionId: history.session.id,
      status: history.session.status,
      messages: history.messages,
      inputTokens: history.session.inputTokens,
      outputTokens: history.session.outputTokens,
      todos: history.todos || [],
      model: history.session.model,
      fileChanges: history.fileChanges || [],
      hasMore: false,
      nextCursor: undefined,
      page: "initial",
    },
  } as any);
}

function startRunner(sessionId: string, prompt: string) {
  stoppedSessionIds.delete(sessionId);
  const session = sessions.getSession(sessionId);
  if (!session) {
    sendRunnerError("Unknown session", sessionId);
    return;
  }

  // Fire and forget: runner emits events via emitAndPersist
  const runClaude = selectRunner(session.model);
  void runClaude({
    prompt,
    session,
    resumeSessionId: session.claudeSessionId,
    onEvent: emitAndPersist,
    onSessionUpdate: (updates) => sessions.updateSession(session.id, updates),
  })
    .then((handle) => {
      runnerHandles.set(session.id, handle);
      sessions.setAbortController(session.id, undefined);
    })
    .catch((error) => {
      sessions.updateSession(session.id, { status: "error" });
      sendRunnerError(String(error), session.id);
    });
}

function handleSessionStart(event: Extract<ClientEvent, { type: "session.start" }>) {
  const session = sessions.createSession({
    cwd: event.payload.cwd,
    title: event.payload.title,
    allowedTools: event.payload.allowedTools,
    prompt: event.payload.prompt,
    model: event.payload.model,
    threadId: event.payload.threadId,
    temperature: event.payload.temperature,
  });

  if (!event.payload.prompt || event.payload.prompt.trim() === "") {
    sessions.updateSession(session.id, { status: "idle", lastPrompt: "" });
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
    } as any);
    return;
  }

  sessions.updateSession(session.id, { status: "running", lastPrompt: event.payload.prompt });
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);

  emitAndPersist({ type: "stream.user_prompt", payload: { sessionId: session.id, prompt: event.payload.prompt } } as any);

  // Auto-generate title using the session's LLM model
  if (session.title === "New Chat" && event.payload.prompt?.trim()) {
    generateSessionTitle(event.payload.prompt, session.model)
      .then((newTitle) => {
        const current = sessions.getSession(session.id);
        if (current && current.title === "New Chat" && newTitle && newTitle !== "New Chat") {
          sessions.updateSession(session.id, { title: newTitle });
          emit({
            type: "session.status",
            payload: { sessionId: session.id, status: current.status, title: newTitle, cwd: session.cwd, model: session.model, temperature: session.temperature },
          } as any);
        }
      })
      .catch((err) => {
        console.error("Failed to generate title for new session:", err);
      });
  }

  startRunner(session.id, event.payload.prompt);
}

function handleSessionContinue(event: Extract<ClientEvent, { type: "session.continue" }>) {
  const { sessionId, prompt, sessionData, messages: historyMessages, todos: historyTodos } = event.payload as any;
  let session = sessions.getSession(sessionId);
  
  // If session not in memory, try to restore from sessionData (provided by Rust)
  if (!session && sessionData) {
    session = sessions.restoreSession({
      id: sessionId,
      title: sessionData.title || "Restored Session",
      cwd: sessionData.cwd,
      model: sessionData.model,
      allowedTools: sessionData.allowedTools,
      temperature: sessionData.temperature,
    });
    
    // Restore message history from DB
    if (historyMessages && Array.isArray(historyMessages)) {
      for (const msg of historyMessages) {
        const messages = (sessions as any).messages.get(sessionId) || [];
        messages.push(msg);
        (sessions as any).messages.set(sessionId, messages);
      }
    }
    
    // Restore todos from DB
    if (historyTodos && Array.isArray(historyTodos)) {
      (sessions as any).todos.set(sessionId, historyTodos);
    }
  }
  
  if (!session) {
    sendRunnerError("Unknown session");
    return;
  }

  const isFirstRun = !session.claudeSessionId;

  sessions.updateSession(sessionId, { status: "running", lastPrompt: prompt });
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);

  emitAndPersist({ type: "stream.user_prompt", payload: { sessionId: session.id, prompt } } as any);

  // Auto-generate title for empty chats on first real prompt
  if (isFirstRun && session.title === "New Chat" && prompt?.trim()) {
    generateSessionTitle(prompt, session.model)
      .then((newTitle) => {
        const current = sessions.getSession(sessionId);
        if (current && current.title === "New Chat" && newTitle && newTitle !== "New Chat") {
          sessions.updateSession(sessionId, { title: newTitle });
          emit({
            type: "session.status",
            payload: { sessionId, status: current.status, title: newTitle, cwd: session.cwd, model: session.model, temperature: session.temperature },
          } as any);
        }
      })
      .catch((err) => {
        console.error("Failed to generate title for continued session:", err);
      });
  }

  startRunner(session.id, prompt);
}

function handleSessionStop(event: Extract<ClientEvent, { type: "session.stop" }>) {
  const { sessionId } = event.payload;
  stoppedSessionIds.add(sessionId);
  sessions.getSession(sessionId)?.abortController?.abort();
  const handle = runnerHandles.get(sessionId);
  if (handle) {
    handle.abort();
    runnerHandles.delete(sessionId);
  }
  
  // Update session status and notify UI
  const session = sessions.getSession(sessionId);
  if (session) {
    sessions.updateSession(sessionId, { status: "idle" });
    emit({
      type: "session.status",
      payload: { 
        sessionId, 
        status: "idle", 
        title: session.title, 
        cwd: session.cwd, 
        model: session.model 
      }
    } as any);
  }
}

function handleSessionDelete(event: Extract<ClientEvent, { type: "session.delete" }>) {
  const { sessionId } = event.payload;
  stoppedSessionIds.add(sessionId);
  sessions.getSession(sessionId)?.abortController?.abort();
  const handle = runnerHandles.get(sessionId);
  if (handle) {
    handle.abort();
    runnerHandles.delete(sessionId);
  }

  sessions.deleteSession(sessionId);
  emit({ type: "session.deleted", payload: { sessionId } } as any);
  handleSessionList();
}

function handleSessionPin(event: Extract<ClientEvent, { type: "session.pin" }>) {
  const { sessionId, isPinned } = event.payload;
  sessions.setPinned(sessionId, isPinned);
  handleSessionList();
}

function handleSessionUpdateCwd(event: Extract<ClientEvent, { type: "session.update-cwd" }>) {
  const { sessionId, cwd } = event.payload;
  sessions.updateSession(sessionId, { cwd });
  const session = sessions.getSession(sessionId);
  if (!session) return;
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: session.status, title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);
}

function handleSessionUpdate(event: Extract<ClientEvent, { type: "session.update" }>) {
  const { sessionId, model, temperature, title } = event.payload;
  const updates: any = {};
  if (model !== undefined) updates.model = model;
  if (temperature !== undefined) updates.temperature = temperature;
  if (title !== undefined) updates.title = title;
  sessions.updateSession(sessionId, updates);
  const session = sessions.getSession(sessionId);
  if (!session) return;
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: session.status, title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);
}

function handlePermissionResponse(event: Extract<ClientEvent, { type: "permission.response" }>) {
  const { sessionId, toolUseId, result } = event.payload;
  const handle = runnerHandles.get(sessionId);
  if (!handle) {
    writeOut({ type: "log", level: "error", message: "No runner handle for permission response", context: { sessionId, toolUseId } });
    return;
  }
  const approved = result.behavior === "allow";
  handle.resolvePermission(toolUseId, approved);
}

function handleMessageEdit(event: Extract<ClientEvent, { type: "message.edit" }>) {
  const { sessionId, messageIndex, newPrompt, sessionData, messages: historyMessages, todos: historyTodos } = event.payload as any;
  let session = sessions.getSession(sessionId);
  
  // If session not in memory, try to restore from sessionData (provided by Rust)
  if (!session && sessionData) {
    session = sessions.restoreSession({
      id: sessionId,
      title: sessionData.title || "Restored Session",
      cwd: sessionData.cwd,
      model: sessionData.model,
      allowedTools: sessionData.allowedTools,
      temperature: sessionData.temperature,
    });
    
    // Restore message history from DB
    if (historyMessages && Array.isArray(historyMessages)) {
      for (const msg of historyMessages) {
        const messages = (sessions as any).messages.get(sessionId) || [];
        messages.push(msg);
        (sessions as any).messages.set(sessionId, messages);
      }
    }
    
    // Restore todos from DB
    if (historyTodos && Array.isArray(historyTodos)) {
      (sessions as any).todos.set(sessionId, historyTodos);
    }
  }
  
  if (!session) {
    sendRunnerError("Unknown session");
    return;
  }

  const handle = runnerHandles.get(sessionId);
  if (handle) {
    handle.abort();
    runnerHandles.delete(sessionId);
  }

  sessions.truncateHistoryAfter(sessionId, messageIndex);
  sessions.updateMessageAt(sessionId, messageIndex, { prompt: newPrompt } as any);

  const updatedHistory = sessions.getSessionHistory(sessionId);
  if (updatedHistory) {
    emit({
      type: "session.history",
      payload: {
        sessionId: updatedHistory.session.id,
        status: updatedHistory.session.status,
        messages: updatedHistory.messages,
        todos: updatedHistory.todos || [],
        model: updatedHistory.session.model,
        fileChanges: updatedHistory.fileChanges || [],
        hasMore: false,
      },
    } as any);
  }

  sessions.updateSession(sessionId, { status: "running", lastPrompt: newPrompt });
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);

  const runClaude = selectRunner(session.model);
  void runClaude({
    prompt: newPrompt,
    session,
    resumeSessionId: session.claudeSessionId,
    onEvent: emitAndPersist,
    onSessionUpdate: (updates: any) => sessions.updateSession(session.id, updates),
  } as any)
    .then((newHandle: RunnerHandle) => {
      runnerHandles.set(session.id, newHandle);
    })
    .catch((error: any) => {
      sessions.updateSession(session.id, { status: "error" });
      emit({
        type: "session.status",
        payload: {
          sessionId: session.id,
          status: "error",
          title: session.title,
          cwd: session.cwd,
          model: session.model,
          error: String(error),
        },
      } as any);
    });
}

function handleSettingsGet() {
  const settings = loadApiSettings();
  emit({ type: "settings.loaded", payload: { settings } } as any);
}

function handleSettingsSave(event: Extract<ClientEvent, { type: "settings.save" }>) {
  Promise.resolve()
    .then(() => {
      saveApiSettings(event.payload.settings as any);
      emit({ type: "settings.loaded", payload: { settings: event.payload.settings } } as any);
    })
    .catch((error) => {
      sendRunnerError(`Failed to save settings: ${String(error)}`);
    });
}

async function fetchModels(): Promise<Array<{ id: string; name: string; description?: string }>> {
  const settings = loadApiSettings();
  if (!settings || !settings.baseUrl || !settings.apiKey) {
    // Return empty array if legacy settings are not configured
    // This allows the app to proceed with only LLM Providers
    return [];
  }

  let modelsURL: string;
  const baseURL = settings.baseUrl;

  if (baseURL.endsWith("/v1")) {
    modelsURL = `${baseURL}/models`;
  } else if (baseURL.includes("/v4")) {
    const v4Index = baseURL.indexOf("/v4");
    const baseURLUpToV4 = baseURL.substring(0, v4Index + 3);
    modelsURL = `${baseURLUpToV4}/models`;
  } else if (baseURL.endsWith("/")) {
    modelsURL = `${baseURL}v1/models`;
  } else {
    modelsURL = `${baseURL}/v1/models`;
  }

  const response = await fetch(modelsURL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  if (data.data && Array.isArray(data.data)) {
    return data.data.map((model: any) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
    }));
  }
  if (Array.isArray(data)) {
    return data.map((model: any) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
    }));
  }
  return [];
}

function handleModelsGet() {
  void fetchModels()
    .then((models) => {
      emit({ type: "models.loaded", payload: { models } } as any);
    })
    .catch((error) => {
      emit({ type: "models.error", payload: { message: String(error) } } as any);
    });
}

function handleThreadList(event: Extract<ClientEvent, { type: "thread.list" }>) {
  const { sessionId } = event.payload;
  const threads = sessions.getThreads(sessionId);
  emit({ type: "thread.list", payload: { sessionId, threads } } as any);
}

function startThread(threadId: string, prompt: string) {
  const thread = sessions.getSession(threadId);
  if (!thread) return;

  sessions.updateSession(threadId, { status: "running", lastPrompt: prompt });
  emitAndPersist({
    type: "session.status",
    payload: {
      sessionId: thread.id,
      status: "running",
      title: thread.title,
      cwd: thread.cwd,
      model: thread.model,
      threadId: thread.threadId,
    },
  } as any);
  emitAndPersist({ type: "stream.user_prompt", payload: { sessionId: threadId, threadId, prompt } } as any);

  const runClaude = selectRunner(thread.model);
  void runClaude({
    prompt,
    session: thread,
    resumeSessionId: thread.claudeSessionId,
    onEvent: emitAndPersist,
    onSessionUpdate: (updates: any) => sessions.updateSession(threadId, updates),
  } as any)
    .then((handle: RunnerHandle) => {
      runnerHandles.set(threadId, handle);
      sessions.setAbortController(threadId, undefined);
    })
    .catch((error: any) => {
      sessions.updateSession(threadId, { status: "error" });
      sendRunnerError(String(error), threadId);
    });
}

function handleTaskDelete(event: Extract<ClientEvent, { type: "task.delete" }>) {
  const { taskId } = event.payload;
  const task = multiThreadTasks.get(taskId);
  if (task) {
    for (const threadId of task.threadIds as string[]) {
      const handle = runnerHandles.get(threadId);
      if (handle) {
        handle.abort();
        runnerHandles.delete(threadId);
      }
      sessions.deleteSession(threadId);
    }
    multiThreadTasks.delete(taskId);
    emit({ type: "task.deleted", payload: { taskId } } as any);
    handleSessionList();
  }
}

function handleTaskCreate(event: Extract<ClientEvent, { type: "task.create" }>) {
  const payload: any = event.payload;
  const { mode, title, cwd, allowedTools, shareWebCache } = payload;

  if (!shareWebCache) {
    webCache.clear();
  }

  if (mode === "role_group") {
    const roleGroupPrompt = payload.roleGroupPrompt || "";
    const roleGroupModel = payload.roleGroupModel || payload.tasks?.[0]?.model || "gpt-4";
    const thread = sessions.createSession({
      title,
      cwd,
      allowedTools,
      model: roleGroupModel,
      threadId: "role-group",
    });
    handleSessionList();
    if (roleGroupPrompt.trim()) {
      startThread(thread.id, roleGroupPrompt);
    }
    return;
  }

  const createdThreads: Array<{ threadId: string; model: string; status: "idle" | "running" | "completed" | "error"; createdAt: number; updatedAt: number }> = [];
  const threadIds: string[] = [];
  const now = Date.now();

  if (mode === "consensus") {
    const consensusModel = payload.consensusModel || "gpt-4";
    const quantity = payload.consensusQuantity || 5;

    for (let i = 0; i < quantity; i++) {
      const threadTitle = `${title} [${i + 1}/${quantity}]`;
      const thread = sessions.createSession({
        title: threadTitle,
        cwd,
        allowedTools,
        model: consensusModel,
        threadId: `thread-${i + 1}`,
      });

      threadIds.push(thread.id);
      createdThreads.push({ threadId: thread.id, model: consensusModel, status: "idle", createdAt: now, updatedAt: now });
    }
  } else if ((mode === "different_tasks" || mode === "role_group") && payload.tasks) {
    const tasks = payload.tasks as any[];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const roleLabel = t.roleName || t.roleId || `${i + 1}/${tasks.length}`;
      const threadTitle = `${title} [${roleLabel}]`;
      const thread = sessions.createSession({
        title: threadTitle,
        cwd,
        allowedTools,
        model: t.model,
        threadId: `thread-${i + 1}`,
      });
      threadIds.push(thread.id);
      createdThreads.push({ threadId: thread.id, model: t.model, status: "idle", createdAt: now, updatedAt: now });
    }
  }

  const taskId = `task-${now}`;
  const task = {
    id: taskId,
    title,
    mode,
    createdAt: now,
    updatedAt: now,
    status: "created" as const,
    threadIds,
    shareWebCache,
    consensusModel: payload.consensusModel,
    consensusQuantity: payload.consensusQuantity,
    consensusPrompt: payload.consensusPrompt,
    autoSummary: payload.autoSummary,
    tasks: payload.tasks,
  };

  multiThreadTasks.set(taskId, task);

  emit({ type: "task.created", payload: { task, threads: createdThreads } } as any);
  handleSessionList();

  // Auto-start task (Electron behavior)
  (task as any).status = "running";
  (task as any).updatedAt = Date.now();
  emit({ type: "task.status", payload: { taskId, status: "running" } } as any);

  if (task.mode === "consensus") {
    const consensusPrompt = task.consensusPrompt || "";
    if (consensusPrompt.trim()) {
      for (const threadId of task.threadIds) {
        startThread(threadId, consensusPrompt);
      }
    }
  } else if ((task.mode === "different_tasks" || task.mode === "role_group") && task.tasks) {
    for (let i = 0; i < task.threadIds.length; i++) {
      const threadId = task.threadIds[i];
      const prompt = task.tasks[i]?.prompt || "";
      if (prompt.trim()) {
        startThread(threadId, prompt);
      }
    }
  }
}

function handleTaskStart(event: Extract<ClientEvent, { type: "task.start" }>) {
  const { taskId } = event.payload;
  const task = multiThreadTasks.get(taskId);
  if (!task) {
    emit({ type: "task.error", payload: { message: `Task ${taskId} not found` } } as any);
    return;
  }

  task.status = "running";
  task.updatedAt = Date.now();
  emit({ type: "task.status", payload: { taskId, status: "running" } } as any);

  if (task.mode === "consensus") {
    const consensusPrompt = task.consensusPrompt || "";
    if (consensusPrompt.trim()) {
      for (const threadId of task.threadIds) {
        startThread(threadId, consensusPrompt);
      }
    }
  } else if ((task.mode === "different_tasks" || task.mode === "role_group") && task.tasks) {
    for (let i = 0; i < task.threadIds.length; i++) {
      const threadId = task.threadIds[i];
      const prompt = task.tasks[i]?.prompt || "";
      if (prompt.trim()) {
        startThread(threadId, prompt);
      }
    }
  }
}

function handleTaskStop(event: Extract<ClientEvent, { type: "task.stop" }>) {
  // UI sends task.stop with sessionId; treat it as a stop request for that running session/thread.
  const { sessionId } = (event as any).payload;
  const handle = runnerHandles.get(sessionId);
  if (handle) {
    handle.abort();
    runnerHandles.delete(sessionId);
  }
}

function handleFileChangesConfirm(event: Extract<ClientEvent, { type: "file_changes.confirm" }>) {
  const { sessionId } = event.payload;
  const session = sessions.getSession(sessionId);
  if (!session) {
    emit({ type: "file_changes.error", payload: { sessionId, message: "Session not found" } } as any);
    return;
  }

  sessions.confirmFileChanges(sessionId);
  emit({ type: "file_changes.confirmed", payload: { sessionId } } as any);
}

function handleFileChangesRollback(event: Extract<ClientEvent, { type: "file_changes.rollback" }>) {
  const { sessionId } = event.payload;
  const session = sessions.getSession(sessionId);

  if (!session || !session.cwd) {
    emit({ type: "file_changes.error", payload: { sessionId, message: "Session not found or no working directory" } } as any);
    return;
  }

  if (!gitUtils.isGitRepo(session.cwd)) {
    emit({ type: "file_changes.error", payload: { sessionId, message: "Not a git repository" } } as any);
    return;
  }

  const allChanges = sessions.getFileChanges(sessionId);
  const pendingChanges = allChanges.filter((c: any) => c.status === "pending");
  if (pendingChanges.length === 0) {
    emit({ type: "file_changes.error", payload: { sessionId, message: "No pending changes to rollback" } } as any);
    return;
  }

  const filePaths = pendingChanges.map((c: any) => c.path);
  const { failed } = gitUtils.checkoutFiles(filePaths, session.cwd);

  sessions.clearFileChanges(sessionId);
  const remainingChanges = allChanges.filter((c: any) => failed.includes(c.path));
  emit({ type: "file_changes.rolledback", payload: { sessionId, fileChanges: remainingChanges } } as any);
}

// OAuth handlers
function handleOAuthLogin(event: any) {
  const { provider, method, token } = event.payload;

  if (method === 'token' && token) {
    setCredential(provider, {
      accessToken: token,
      provider,
      authMethod: 'token',
    });
    emit({ type: "oauth.flow.completed", payload: { provider } } as any);
    return;
  }

  // Browser OAuth flow
  try {
    const cfg = openAIOAuthConfig();
    const { authorizeUrl, flowId } = startBrowserOAuthFlow(cfg);

    emit({ type: "oauth.flow.started", payload: { authorizeUrl, flowId } } as any);

    // Open browser — emit event for Rust/Tauri to handle, with exec fallback
    emit({ type: "open.external" as any, payload: { url: authorizeUrl } } as any);
    // Fallback: also try direct open in case event isn't handled
    if (process.platform === 'win32') {
      exec(`cmd /c start "" "${authorizeUrl}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${authorizeUrl}"`);
    } else {
      exec(`xdg-open "${authorizeUrl}"`);
    }

    // Poll for completion
    const pollInterval = setInterval(() => {
      const cred = getCredential('openai');
      if (cred) {
        clearInterval(pollInterval);
        emit({ type: "oauth.flow.completed", payload: { provider, email: cred.email, accountId: cred.accountId } } as any);
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(pollInterval);
      stopOAuthFlow();
    }, 5 * 60 * 1000);
  } catch (error) {
    emit({ type: "oauth.flow.error", payload: { message: String(error) } } as any);
  }
}

function handleOAuthLogout(event: any) {
  const { provider } = event.payload;
  deleteCredential(provider);
  emit({ type: "oauth.status", payload: { provider, loggedIn: false } } as any);
}

function handleOAuthStatusGet(event: any) {
  const { provider } = event.payload;
  let cred = getCredential(provider);

  // Auto-import from Codex CLI if no ValeDesk credentials
  if (!cred && provider === 'openai') {
    const codexCred = readCodexCliCredentials();
    if (codexCred) {
      setCredential('openai', codexCred);
      cred = codexCred;
      writeOut({ type: "log", level: "info", message: "Auto-imported credentials from Codex CLI (~/.codex/auth.json)" });
    }
  }

  emit({
    type: "oauth.status",
    payload: {
      provider,
      loggedIn: !!cred && !isExpired(cred),
      email: cred?.email,
      accountId: cred?.accountId,
      expiresAt: cred?.expiresAt,
    }
  } as any);
}

function handleLlmProvidersGet() {
  const settings = loadLLMProviderSettings();
  emit({ type: "llm.providers.loaded", payload: { settings: settings || { providers: [], models: [] } } } as any);
}

function handleLlmProvidersSave(event: Extract<ClientEvent, { type: "llm.providers.save" }>) {
  Promise.resolve()
    .then(() => {
      saveLLMProviderSettings(event.payload.settings as any);
      emit({ type: "llm.providers.saved", payload: { settings: event.payload.settings } } as any);
    })
    .catch((error) => {
      sendRunnerError(`Failed to save LLM providers: ${String(error)}`);
    });
}

function handleLlmModelsTest(event: Extract<ClientEvent, { type: "llm.models.test" }>) {
  const { provider } = event.payload as any;
  fetchModelsFromProvider(provider)
    .then((models) => {
      emit({ type: "llm.models.fetched", payload: { providerId: provider.id, models } } as any);
    })
    .catch((error) => {
      emit({ type: "llm.models.error", payload: { providerId: provider.id, message: String(error) } } as any);
    });
}

function handleLlmModelsFetch(event: Extract<ClientEvent, { type: "llm.models.fetch" }>) {
  const { providerId } = event.payload;
  const settings = loadLLMProviderSettings();
  if (!settings) {
    emit({ type: "llm.models.error", payload: { providerId, message: "No settings found" } } as any);
    return;
  }

  const provider = settings.providers.find((p: any) => p.id === providerId);
  if (!provider) {
    emit({ type: "llm.models.error", payload: { providerId, message: "Provider not found" } } as any);
    return;
  }

  fetchModelsFromProvider(provider)
    .then((models) => {
      const existingSettings = loadLLMProviderSettings() || { providers: [], models: [] };
      const existingModels = existingSettings.models.filter((m: any) => m.providerId !== providerId);
      const updatedModels = [...existingModels, ...models];
      const updatedSettings = { ...existingSettings, models: updatedModels };
      saveLLMProviderSettings(updatedSettings as any);
      emit({ type: "llm.models.fetched", payload: { providerId, models } } as any);
    })
    .catch((error) => {
      emit({ type: "llm.models.error", payload: { providerId, message: String(error) } } as any);
    });
}

async function handleLlmModelsCheck() {
  const settings = loadLLMProviderSettings();
  if (!settings) {
    sendRunnerError("No LLM provider settings found");
    return;
  }

  const unavailableModels: string[] = [];
  const enabledProviders = settings.providers.filter((p: any) => p.enabled);

  for (const provider of enabledProviders) {
    const providerModels = settings.models.filter((m: any) => m.providerId === provider.id && m.enabled);
    const unavailable = await checkModelsAvailability(provider, providerModels);
    unavailableModels.push(...unavailable);
  }

  if (unavailableModels.length > 0) {
    const updatedModels = settings.models.map((m: any) => (unavailableModels.includes(m.id) ? { ...m, enabled: false } : m));
    const updatedSettings = { ...settings, models: updatedModels };
    saveLLMProviderSettings(updatedSettings as any);
  }

  emit({ type: "llm.models.checked", payload: { unavailableModels } } as any);
}

function emitSkillsLoaded() {
  const settings = loadSkillsSettings();
  emit({
    type: "skills.loaded",
    payload: { skills: settings.skills, repositories: settings.repositories, lastFetched: settings.lastFetched },
  } as any);
}

function handleSkillsGet() {
  emitSkillsLoaded();
}

function handleSkillsRefresh() {
  fetchSkillsFromMarketplace()
    .then(() => {
      emitSkillsLoaded();
    })
    .catch((error) => {
      emit({ type: "skills.error", payload: { message: String(error) } } as any);
    });
}

function handleSkillsToggle(event: Extract<ClientEvent, { type: "skills.toggle" }>) {
  const { skillId, enabled } = event.payload as any;
  toggleSkill(skillId, enabled);
  emitSkillsLoaded();
}

function handleSkillsSetMarketplace(event: Extract<ClientEvent, { type: "skills.set-marketplace" }>) {
  const { url } = event.payload as any;
  setMarketplaceUrl(url);
}

function handleSkillsAddRepository(event: Extract<ClientEvent, { type: "skills.add-repository" }>) {
  addRepository((event.payload as any).repo);
  fetchSkillsFromMarketplace()
    .then(() => emitSkillsLoaded())
    .catch((error) => {
      emit({ type: "skills.error", payload: { message: String(error) } } as any);
    });
}

function handleSkillsUpdateRepository(event: Extract<ClientEvent, { type: "skills.update-repository" }>) {
  const { id, updates } = event.payload as any;
  updateRepository(id, updates);
  emitSkillsLoaded();
}

function handleSkillsRemoveRepository(event: Extract<ClientEvent, { type: "skills.remove-repository" }>) {
  const { id } = event.payload as any;
  removeRepository(id);
  emitSkillsLoaded();
}

function handleSkillsToggleRepository(event: Extract<ClientEvent, { type: "skills.toggle-repository" }>) {
  const { id, enabled } = event.payload as any;
  toggleRepository(id, enabled);
  emitSkillsLoaded();
}

// ─── Mini-workflow helpers ───

interface FullReplayResult {
  stepResults: Record<string, string>;
  scriptErrors: Record<string, string>;
  filesCreated: string[];
  sessionId: string;
  inputs?: Record<string, unknown>;
}

async function runFullReplay(
  workflow: any,
  workspaceDir: string,
  options?: { model?: string; silent?: boolean }
): Promise<FullReplayResult> {
  const silent = options?.silent ?? false;

  await safeRmDir(workspaceDir);
  await fs.mkdir(workspaceDir, { recursive: true });

  const inputs: Record<string, unknown> = {};
  for (const inp of workflow.inputs || []) {
    inputs[inp.id] = inp.default ?? "";
  }

  const session = sessions.createSession({
    cwd: workspaceDir,
    title: silent ? `[verify] ${workflow.name}` : workflow.name,
    allowedTools: (workflow.compatibility?.tools_required || []).join(","),
    prompt: "",
    model: options?.model || undefined,
    ephemeral: silent
  });
  sessions.updateSession(session.id, { status: "running" });

  if (!silent) {
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
    } as any);
  }

  const secretBag: Record<string, string> = {};
  for (const inputSpec of workflow.inputs || []) {
    if (inputSpec.type === "secret" || inputSpec.redaction) {
      const v = inputs[inputSpec.id];
      if (typeof v === "string" && v) secretBag[inputSpec.id] = v;
    }
  }

  const scriptResults: Record<string, string> = {};
  const stepDisplayResults: Record<string, string> = {};
  const scriptErrors: Record<string, string> = {};
  const scriptSteps = (workflow.chain || []).filter((s: any) => s.execution === "script" && s.script?.code);

  if (scriptSteps.length > 0) {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    for (const step of scriptSteps) {
      try {
        const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "SYSTEMROOT", "COMSPEC", "SHELL", "PYTHONPATH", "PYTHONHOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "WINDIR"]);
        const SECRET_PATTERNS = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIAL|_AUTH)$|^(OPENAI|ANTHROPIC|TAVILY|ZAI|AWS_|AZURE_|GOOGLE_|GITHUB_TOKEN|NPM_TOKEN|CODEX_)/i;
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (v == null || SECRET_PATTERNS.test(k)) continue;
          if (SAFE_ENV_KEYS.has(k)) env[k] = v;
        }
        for (const [k, v] of Object.entries(inputs)) env[`INPUTS_${k.toUpperCase()}`] = String(v);
        for (const [k, v] of Object.entries(scriptResults)) env[`STEP_${k.toUpperCase()}_RESULT`] = v;
        env["WORKSPACE"] = workspaceDir;

        const scriptFile = join(workspaceDir, `${step.id}.py`);
        await fs.writeFile(scriptFile, step.script.code, "utf8");

        const { stdout } = await execFileAsync("python", [scriptFile], {
          cwd: workspaceDir,
          env,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024
        });
        const scriptOutput = (stdout || "").trim();
        const persisted = await persistStepOutput(workspaceDir, step, scriptOutput);
        scriptResults[step.id] = scriptOutput;
        stepDisplayResults[step.id] = persisted.compactResult;
      } catch (err: any) {
        scriptErrors[step.id] = err.message || String(err);
        scriptResults[step.id] = `[SCRIPT ERROR: ${err.message}]`;
        stepDisplayResults[step.id] = scriptResults[step.id];
      }
    }
  }

  const llmSteps = getLlmSteps(workflow);
  const allStepResults: Record<string, string> = { ...scriptResults };

  const runSingleStep = (stepPrompt: string, stepTitle: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      let collectedText = "";
      let stepCompleted = false;

      const stepEmit = (serverEvent: ServerEvent) => {
        if (!silent) emit(serverEvent);

        if (serverEvent.type === "stream.message" && serverEvent.payload.sessionId === session.id) {
          const msg = serverEvent.payload.message as any;
          if (msg.type === "result" && msg.result) {
            collectedText = msg.result;
          } else if (msg.type === "assistant" && msg.message?.content) {
            const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
            for (const p of parts) {
              if (p.type === "text" && p.text) collectedText += p.text;
            }
          } else if (msg.type === "text" && msg.text) {
            collectedText += msg.text;
          } else if (msg.type === "user" && msg.message?.content) {
            const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
            for (const part of parts) {
              if (part.type === "tool_result" && part.content) {
                collectedText += `\n[tool_result] ${part.content}`;
              }
            }
          }
        }
        if (serverEvent.type === "session.status" && serverEvent.payload.sessionId === session.id) {
          if (serverEvent.payload.status === "completed" || serverEvent.payload.status === "idle") {
            if (!stepCompleted) { stepCompleted = true; resolve(collectedText.trim()); }
          }
          if (serverEvent.payload.status === "error") {
            if (!stepCompleted) { stepCompleted = true; reject(new Error(`Step "${stepTitle}" failed`)); }
          }
        }
        if (serverEvent.type === "runner.error" && serverEvent.payload.sessionId === session.id) {
          if (!stepCompleted) { stepCompleted = true; reject(new Error(serverEvent.payload.message)); }
        }
      };

      const runner = selectRunner(session.model);
      runner({
        prompt: stepPrompt,
        session,
        resumeSessionId: session.claudeSessionId,
        onEvent: stepEmit,
        secretBag,
        onSessionUpdate: (updates: any) => { sessions.updateSession(session.id, updates); }
      } as any)
        .then((handle: any) => { runnerHandles.set(session.id, handle); })
        .catch((error: any) => { if (!stepCompleted) { stepCompleted = true; reject(error); } });
    });
  };

  for (let i = 0; i < llmSteps.length; i++) {
    const step = llmSteps[i];
    const stepPrompt = buildStepPrompt(workflow, step, i, llmSteps.length, inputs, allStepResults);
    sessions.updateSession(session.id, { lastPrompt: stepPrompt, status: "running" });

    if (!silent) {
      emit({ type: "stream.user_prompt", payload: { sessionId: session.id, prompt: stepPrompt } } as any);
    }

    try {
      const result = await runSingleStep(stepPrompt, step.title);
      const persisted = await persistStepOutput(workspaceDir, step, result);
      allStepResults[step.id] = result;
      stepDisplayResults[step.id] = persisted.compactResult;
    } catch (stepErr) {
      allStepResults[step.id] = `[LLM ERROR: ${String(stepErr)}]`;
      stepDisplayResults[step.id] = allStepResults[step.id];
    }
  }

  let filesCreated: string[] = [];
  try {
    const entries = await fs.readdir(workspaceDir, { recursive: true }) as string[];
    filesCreated = entries.filter(f => !f.endsWith(".py"));
  } catch { /* ignore */ }

  if (silent) {
    runnerHandles.delete(session.id);
    sessions.deleteSession(session.id);
  } else {
    sessions.updateSession(session.id, { status: "completed" });
    emit({ type: "session.status", payload: { sessionId: session.id, status: "completed" } } as any);
  }

  return { stepResults: stepDisplayResults, scriptErrors, filesCreated, sessionId: session.id, inputs };
}

async function runAgentVerification(
  workflow: any,
  replayResult: FullReplayResult,
  workspaceDir: string,
  options?: { model?: string; debugLog?: DistillDebugLog; debugStep?: string }
): Promise<VerifyResult> {
  const prompt = buildVerificationPrompt(workflow, replayResult);

  const session = sessions.createSession({
    cwd: workspaceDir,
    title: `[verify] ${workflow.name}`,
    allowedTools: "",
    prompt: "",
    model: options?.model || undefined,
    ephemeral: true
  });
  sessions.updateSession(session.id, { status: "running" });

  return new Promise((resolve) => {
    let collectedText = "";
    let completed = false;

    const onEvent = (serverEvent: ServerEvent) => {
      if (serverEvent.type === "stream.message" && serverEvent.payload.sessionId === session.id) {
        const msg = serverEvent.payload.message as any;
        if (msg.type === "result" && msg.result) {
          collectedText = msg.result;
        } else if (msg.type === "assistant" && msg.message?.content) {
          const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
          for (const p of parts) {
            if (p.type === "text" && p.text) collectedText += p.text;
          }
        } else if (msg.type === "text" && msg.text) {
          collectedText += msg.text;
        }
      }
      if (serverEvent.type === "session.status" && serverEvent.payload.sessionId === session.id) {
        if ((serverEvent.payload.status === "completed" || serverEvent.payload.status === "idle") && !completed) {
          completed = true;
          finalize();
        }
        if (serverEvent.payload.status === "error" && !completed) {
          completed = true;
          runnerHandles.delete(session.id);
          sessions.deleteSession(session.id);
          resolve({
            match: false,
            summary: `Verification agent error`,
            discrepancies: ["Verification agent failed"],
            suggestions: [],
            usage: { input_tokens: 0, output_tokens: 0 }
          });
        }
      }
    };

    const finalize = () => {
      const jsonRaw = extractJsonObject(collectedText);
      const usage = {
        input_tokens: sessions.getSession(session.id)?.inputTokens || 0,
        output_tokens: sessions.getSession(session.id)?.outputTokens || 0
      };

      runnerHandles.delete(session.id);
      sessions.deleteSession(session.id);

      if (options?.debugLog) {
        options.debugLog.push({
          step: options.debugStep || "verify_agent",
          timestamp: new Date().toISOString(),
          system: "(agent with tools)",
          user: prompt.slice(0, 2000),
          response: collectedText.slice(0, 5000),
          parsed: jsonRaw ? JSON.parse(jsonRaw) : null,
          usage
        });
      }

      if (!jsonRaw) {
        resolve({
          match: false,
          summary: collectedText.slice(0, 500) || "Agent did not return JSON",
          discrepancies: ["Verification agent did not return structured JSON"],
          suggestions: [],
          usage
        });
        return;
      }

      try {
        const data = JSON.parse(jsonRaw);
        resolve({
          match: Boolean(data.match),
          summary: String(data.summary || ""),
          discrepancies: Array.isArray(data.discrepancies) ? data.discrepancies.map(String) : [],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String) : [],
          usage
        });
      } catch {
        resolve({ match: false, summary: "Failed to parse verification JSON", discrepancies: ["JSON parse error"], suggestions: [], usage });
      }
    };

    const runner = selectRunner(session.model);
    runner({
      prompt,
      session,
      onEvent,
      onSessionUpdate: (updates: any) => { sessions.updateSession(session.id, updates); }
    } as any)
      .then((handle: any) => { runnerHandles.set(session.id, handle); })
      .catch((error: any) => {
        if (!completed) {
          completed = true;
          runnerHandles.delete(session.id);
          sessions.deleteSession(session.id);
          resolve({
            match: false,
            summary: `Verification runner error: ${String(error)}`,
            discrepancies: [String(error)],
            suggestions: [],
            usage: { input_tokens: 0, output_tokens: 0 }
          });
        }
      });
  });
}

async function runAgentRefine(
  workflow: any,
  verification: { discrepancies: string[]; suggestions: string[] },
  schemaRef: string,
  workspaceDir: string,
  options?: { model?: string; debugLog?: DistillDebugLog; debugStep?: string; signal?: AbortSignal }
): Promise<{ message: string; workflow: any; usage: { input_tokens: number; output_tokens: number } }> {
  const prompt = buildRefinePrompt(workflow, verification, schemaRef);

  const session = sessions.createSession({
    cwd: workspaceDir,
    title: `[refine] ${workflow.name}`,
    allowedTools: "",
    prompt: "",
    model: options?.model || undefined,
    ephemeral: true
  });
  sessions.updateSession(session.id, { status: "running" });

  return new Promise((resolve) => {
    let collectedText = "";
    let completed = false;

    const cleanup = () => {
      runnerHandles.delete(session.id);
      sessions.deleteSession(session.id);
    };

    const onEvent = (serverEvent: ServerEvent) => {
      if (serverEvent.type === "stream.message" && serverEvent.payload.sessionId === session.id) {
        const msg = serverEvent.payload.message as any;
        if (msg.type === "result" && msg.result) {
          collectedText = msg.result;
        } else if (msg.type === "assistant" && msg.message?.content) {
          const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
          for (const p of parts) {
            if (p.type === "text" && p.text) collectedText += p.text;
          }
        } else if (msg.type === "text" && msg.text) {
          collectedText += msg.text;
        }
      }
      if (serverEvent.type === "session.status" && serverEvent.payload.sessionId === session.id) {
        if ((serverEvent.payload.status === "completed" || serverEvent.payload.status === "idle") && !completed) {
          completed = true;
          finalize();
        }
        if (serverEvent.payload.status === "error" && !completed) {
          completed = true;
          cleanup();
          resolve({ message: "Refine agent error", workflow: null, usage: { input_tokens: 0, output_tokens: 0 } });
        }
      }
    };

    const finalize = () => {
      const usage = {
        input_tokens: sessions.getSession(session.id)?.inputTokens || 0,
        output_tokens: sessions.getSession(session.id)?.outputTokens || 0
      };
      cleanup();

      if (options?.debugLog) {
        const jsonRaw = extractJsonObject(collectedText);
        options.debugLog.push({
          step: options.debugStep || "refine_agent",
          timestamp: new Date().toISOString(),
          system: "(agent with tools)",
          user: prompt.slice(0, 2000),
          response: collectedText.slice(0, 5000),
          parsed: jsonRaw ? JSON.parse(jsonRaw) : null,
          usage
        });
      }

      const jsonRaw = extractJsonObject(collectedText);
      if (!jsonRaw) {
        resolve({ message: "Agent did not return JSON", workflow: null, usage });
        return;
      }
      try {
        const data = JSON.parse(jsonRaw);
        resolve({ message: data.message || "", workflow: data.workflow || null, usage });
      } catch {
        resolve({ message: "JSON parse error", workflow: null, usage });
      }
    };

    const runner = selectRunner(session.model);
    runner({
      prompt,
      session,
      onEvent,
      onSessionUpdate: (updates: any) => { sessions.updateSession(session.id, updates); }
    } as any)
      .then((handle: any) => { runnerHandles.set(session.id, handle); })
      .catch((error: any) => {
        if (!completed) {
          completed = true;
          cleanup();
          resolve({ message: String(error), workflow: null, usage: { input_tokens: 0, output_tokens: 0 } });
        }
      });
  });
}

async function handleClientEvent(event: ClientEvent) {
  switch (event.type) {
    case "session.list":
      handleSessionList();
      return;
    case "session.history":
      handleSessionHistory(event);
      return;
    case "session.start":
      handleSessionStart(event);
      return;
    case "session.continue":
      handleSessionContinue(event);
      return;
    case "session.stop":
      handleSessionStop(event);
      return;
    case "session.delete":
      handleSessionDelete(event);
      return;
    case "session.pin":
      handleSessionPin(event);
      return;
    case "session.update-cwd":
      handleSessionUpdateCwd(event);
      return;
    case "session.update":
      handleSessionUpdate(event);
      return;
    case "permission.response":
      handlePermissionResponse(event);
      return;
    case "message.edit":
      handleMessageEdit(event);
      return;
    case "settings.get":
      handleSettingsGet();
      return;
    case "settings.save":
      handleSettingsSave(event);
      return;
    case "models.get":
      handleModelsGet();
      return;
    case "file_changes.confirm":
      handleFileChangesConfirm(event);
      return;
    case "file_changes.rollback":
      handleFileChangesRollback(event);
      return;
    case "thread.list":
      handleThreadList(event);
      return;
    case "task.create":
      handleTaskCreate(event);
      return;
    case "task.start":
      handleTaskStart(event);
      return;
    case "task.delete":
      handleTaskDelete(event);
      return;
    case "task.stop":
      handleTaskStop(event as any);
      return;
    case "llm.providers.get":
      handleLlmProvidersGet();
      return;
    case "llm.providers.save":
      handleLlmProvidersSave(event);
      return;
    case "llm.models.test":
      handleLlmModelsTest(event);
      return;
    case "llm.models.fetch":
      handleLlmModelsFetch(event);
      return;
    case "llm.models.check":
      await handleLlmModelsCheck();
      return;
    case "skills.get":
      handleSkillsGet();
      return;
    case "skills.refresh":
      handleSkillsRefresh();
      return;
    case "skills.toggle":
      handleSkillsToggle(event);
      return;
    case "skills.set-marketplace":
      handleSkillsSetMarketplace(event);
      return;
    case "skills.add-repository":
      handleSkillsAddRepository(event);
      return;
    case "skills.update-repository":
      handleSkillsUpdateRepository(event);
      return;
    case "skills.remove-repository":
      handleSkillsRemoveRepository(event);
      return;
    case "skills.toggle-repository":
      handleSkillsToggleRepository(event);
      return;

    // ─── Mini-workflow events ───
    case "miniworkflow.list": {
      const workflows = await miniWorkflowStore.list({
        projectCwd: (event as any).payload?.cwd,
        includeProject: true,
        includeArchived: Boolean((event as any).payload?.includeArchived)
      });
      emit({ type: "miniworkflow.list", payload: { workflows } } as any);
      return;
    }
    case "miniworkflow.get": {
      const { workflowId, cwd } = (event as any).payload;
      const workflow = await miniWorkflowStore.load(workflowId, { projectCwd: cwd, preferProject: true });
      if (!workflow) {
        emit({ type: "miniworkflow.error", payload: { message: `Workflow not found: ${workflowId}` } } as any);
        return;
      }
      emit({ type: "miniworkflow.loaded", payload: { workflow } } as any);
      return;
    }
    case "miniworkflow.save": {
      const wfToSave = (event as any).payload.workflow;
      const saveCwd = (event as any).payload.cwd;
      await miniWorkflowStore.save(wfToSave, { scope: "global" });
      if (saveCwd) {
        await miniWorkflowStore.save(wfToSave, { scope: "project", projectCwd: saveCwd });
      }
      const updatedList = await miniWorkflowStore.list({ projectCwd: saveCwd, includeProject: Boolean(saveCwd), includeArchived: true });
      emit({ type: "miniworkflow.list", payload: { workflows: updatedList } } as any);
      return;
    }
    case "miniworkflow.delete": {
      const { workflowId: delId, scope, cwd: delCwd } = (event as any).payload;
      await miniWorkflowStore.delete(delId, { scope: scope ?? "both", projectCwd: delCwd });
      const afterDelete = await miniWorkflowStore.list({ projectCwd: delCwd, includeProject: Boolean(delCwd), includeArchived: true });
      emit({ type: "miniworkflow.list", payload: { workflows: afterDelete } } as any);
      return;
    }
    case "miniworkflow.restore": {
      const { workflowId: restoreId, cwd: restoreCwd } = (event as any).payload;
      let sourceScope: "global" | "project" = "global";
      let wfToRestore = null;
      if (restoreCwd) {
        wfToRestore = await miniWorkflowStore.load(restoreId, { baseDir: restoreCwd });
        if (wfToRestore) sourceScope = "project";
      }
      if (!wfToRestore) {
        wfToRestore = await miniWorkflowStore.load(restoreId);
      }
      if (!wfToRestore) {
        emit({ type: "miniworkflow.error", payload: { message: `Workflow not found: ${restoreId}` } } as any);
        return;
      }
      const restoredStatus = (wfToRestore as any).inputs?.length === 0 || !wfToRestore.chain?.length ? "draft" : "published";
      await miniWorkflowStore.save(
        { ...wfToRestore, status: restoredStatus as any, updated_at: new Date().toISOString() },
        { scope: sourceScope, projectCwd: restoreCwd }
      );
      const afterRestore = await miniWorkflowStore.list({ projectCwd: restoreCwd, includeProject: Boolean(restoreCwd), includeArchived: true });
      emit({ type: "miniworkflow.list", payload: { workflows: afterRestore } } as any);
      return;
    }
    case "miniworkflow.archive": {
      const { workflowId: archId, cwd: archCwd } = (event as any).payload;
      try {
        // Detect actual source scope: check project first, fall back to global
        let sourceScope: "global" | "project" = "global";
        let wfToArch = null;
        if (archCwd) {
          wfToArch = await miniWorkflowStore.load(archId, { baseDir: archCwd });
          if (wfToArch) sourceScope = "project";
        }
        if (!wfToArch) {
          wfToArch = await miniWorkflowStore.load(archId);
        }
        if (!wfToArch) {
          emit({ type: "miniworkflow.error", payload: { message: `Workflow not found: ${archId}` } } as any);
          return;
        }
        await miniWorkflowStore.save(
          { ...wfToArch, status: "archived", updated_at: new Date().toISOString() },
          { scope: sourceScope, projectCwd: archCwd }
        );
        const afterArchive = await miniWorkflowStore.list({ projectCwd: archCwd, includeProject: Boolean(archCwd), includeArchived: true });
        emit({ type: "miniworkflow.list", payload: { workflows: afterArchive } } as any);
      } catch (err) {
        emit({ type: "miniworkflow.error", payload: { message: `Failed to archive: ${String(err)}` } } as any);
      }
      return;
    }
    case "miniworkflow.distill": {
      const { sessionId: distillSessionId, validationErrors, model: distillModel, maxVerifyCycles: userMaxCycles, sessionData, messages: historyMessages } = (event as any).payload;

      // Restore session in memory if not present (Rust enriches with sessionData + messages)
      if (!sessions.getSession(distillSessionId) && sessionData) {
        sessions.restoreSession({
          id: distillSessionId,
          title: sessionData.title || "Restored Session",
          cwd: sessionData.cwd,
          model: sessionData.model,
          allowedTools: sessionData.allowedTools,
          temperature: sessionData.temperature,
        });
        if (historyMessages && Array.isArray(historyMessages)) {
          for (const msg of historyMessages) {
            const msgs = (sessions as any).messages.get(distillSessionId) || [];
            msgs.push(msg);
            (sessions as any).messages.set(distillSessionId, msgs);
          }
        }
      }

      const history = sessions.getSessionHistory(distillSessionId);
      if (!history) {
        emit({ type: "miniworkflow.error", payload: { message: "Session not found for distill" } } as any);
        return;
      }

      const suitability = checkDistillability(history.messages as any);
      if (!suitability.suitable) {
        emit({
          type: "miniworkflow.distill.result",
          payload: {
            sessionId: distillSessionId,
            result: { status: "not_suitable", reason: "Сессия не содержит вызовов инструментов.", suggest_prompt_preset: Boolean(suitability.suggest_prompt_preset) }
          }
        } as any);
        return;
      }

      // Create AbortController for this distillation
      const distillAC = new AbortController();
      distillAbortControllers.set(distillSessionId, distillAC);
      const distillSignal = distillAC.signal;

      try {
        const distillUsage: DistillUsage = { input_tokens: 0, output_tokens: 0 };
        const chainResult = await distillChain({
          sessionId: distillSessionId,
          cwd: history.session.cwd,
          history: history.messages as any[],
          model: distillModel || history.session.model,
          previousErrors: validationErrors
        }, (step, totalSteps, label, usage) => {
          emit({
            type: "miniworkflow.distill.progress",
            payload: { sessionId: distillSessionId, step, totalSteps, label, usage: { ...usage } }
          } as any);
        }, distillSignal);

        Object.assign(distillUsage, chainResult.usage);

        if (chainResult.status === "not_suitable") {
          emit({
            type: "miniworkflow.distill.result",
            payload: { sessionId: distillSessionId, usage: distillUsage, result: { status: "not_suitable", reason: chainResult.reason, suggest_prompt_preset: false } }
          } as any);
          return;
        }

        const validation = validateWorkflow(chainResult.workflow as Record<string, unknown>);
        if (!validation.valid) {
          emit({
            type: "miniworkflow.distill.result",
            payload: { sessionId: distillSessionId, usage: distillUsage, result: { status: "needs_clarification", questions: validation.errors } }
          } as any);
          return;
        }

        // ─── Verification loop ───
        let finalWorkflow = chainResult.workflow;
        const debugLog = chainResult.debugLog;
        const MAX_VERIFY_CYCLES = Math.max(1, Math.min(10, userMaxCycles ?? 3));
        let verificationResult: { match: boolean; summary: string; discrepancies: string[]; suggestions: string[] } | null = null;
        let lastReplayResult: FullReplayResult | null = null;
        let verifyCyclesUsed = 0;
        const testDir = join(getDataDir(), "distill-verify", distillSessionId);

        if (finalWorkflow.source_result?.description) {
          const verifyModel = finalWorkflow.source_model || history.session.model;
          const TOTAL_STEPS = 5 + MAX_VERIFY_CYCLES * 3;

          for (let cycle = 0; cycle < MAX_VERIFY_CYCLES; cycle++) {
            if (distillSignal.aborted) break;
            const cycleBase = 5 + cycle * 3;

            emit({
              type: "miniworkflow.distill.progress",
              payload: { sessionId: distillSessionId, step: cycleBase + 1, totalSteps: TOTAL_STEPS, label: `Полный прогон (${cycle + 1}/${MAX_VERIFY_CYCLES})...`, usage: { ...distillUsage } }
            } as any);

            const replayResult = await runFullReplay(finalWorkflow, testDir, { model: verifyModel, silent: true });
            lastReplayResult = replayResult;

            emit({
              type: "miniworkflow.distill.progress",
              payload: { sessionId: distillSessionId, step: cycleBase + 2, totalSteps: TOTAL_STEPS, label: `Верификация результата (${cycle + 1}/${MAX_VERIFY_CYCLES})...`, usage: { ...distillUsage } }
            } as any);

            const verifyRes = await runAgentVerification(finalWorkflow, replayResult, testDir, { model: verifyModel, debugLog, debugStep: `verify_cycle${cycle + 1}` });
            distillUsage.input_tokens += verifyRes.usage.input_tokens;
            distillUsage.output_tokens += verifyRes.usage.output_tokens;
            verificationResult = verifyRes;
            verifyCyclesUsed = cycle + 1;

            if (verificationResult.match) break;
            if (cycle === MAX_VERIFY_CYCLES - 1) break;

            emit({
              type: "miniworkflow.distill.progress",
              payload: { sessionId: distillSessionId, step: cycleBase + 3, totalSteps: TOTAL_STEPS, label: `Исправление по замечаниям (${cycle + 1}/${MAX_VERIFY_CYCLES})...`, usage: { ...distillUsage } }
            } as any);

            try {
              const schemaRef = getMiniWorkflowSchemaPrompt();
              const refineData = await runAgentRefine(finalWorkflow, verificationResult, schemaRef, testDir, { model: verifyModel, debugLog, debugStep: `refine_cycle${cycle + 1}` });
              if (refineData.usage) {
                distillUsage.input_tokens += refineData.usage.input_tokens;
                distillUsage.output_tokens += refineData.usage.output_tokens;
              }
              if (refineData.workflow) {
                const refineValidation = validateWorkflow(refineData.workflow as Record<string, unknown>);
                if (refineValidation.valid) {
                  refineData.workflow.source_model = finalWorkflow.source_model;
                  refineData.workflow.source_context = finalWorkflow.source_context;
                  refineData.workflow.source_result = finalWorkflow.source_result;
                  finalWorkflow = refineData.workflow;
                }
              }
            } catch (refineErr) {
              console.error(`[Distill] Refine failed on cycle ${cycle + 1}:`, refineErr);
            }
          }
        }

        // Save debug log
        let debugLogPath: string | undefined;
        if (debugLog.length > 0) {
          const debugDir = join(getDataDir(), "distill-debug");
          await fs.mkdir(debugDir, { recursive: true });
          debugLogPath = join(debugDir, `${distillSessionId}_${Date.now()}.json`);
          await fs.writeFile(debugLogPath, JSON.stringify({
            sessionId: distillSessionId, timestamp: new Date().toISOString(),
            model: history.session.model, usage: distillUsage,
            workflow: finalWorkflow, verification: verificationResult,
            llm_calls: redactDebugLog(debugLog)
          }, null, 2), "utf8");
        }
        if (debugLogPath) {
          (finalWorkflow as any).debug_log_path = debugLogPath;
        }

        emit({
          type: "miniworkflow.distill.result",
          payload: { sessionId: distillSessionId, usage: distillUsage, debugLogPath, result: { status: "success", workflow: finalWorkflow } }
        } as any);

        if (verificationResult) {
        emit({
          type: "miniworkflow.replay.verified",
          payload: {
            workflowId: finalWorkflow.id, sessionId: distillSessionId, source: "distill", verification: verificationResult,
            verifyCycles: { used: verifyCyclesUsed, max: MAX_VERIFY_CYCLES },
            replayArtifacts: lastReplayResult ? {
              filesCreated: lastReplayResult.filesCreated,
                stepResults: lastReplayResult.stepResults,
                workspaceDir: testDir
              } : undefined
            }
          } as any);
        }
      } catch (err) {
        if (distillSignal.aborted) {
          console.log("[Distill] Cancelled by user");
          emit({ type: "miniworkflow.distill.result", payload: { sessionId: distillSessionId, result: { status: "cancelled" } } } as any);
        } else {
          console.error("[Distill] Error:", err);
          emit({ type: "miniworkflow.error", payload: { message: `Distill failed: ${String(err)}` } } as any);
        }
      } finally {
        distillAbortControllers.delete(distillSessionId);
      }
      return;
    }
    case "miniworkflow.distill.cancel": {
      const { sessionId: cancelSessionId } = (event as any).payload;
      const ac = distillAbortControllers.get(cancelSessionId);
      if (ac) {
        ac.abort();
        distillAbortControllers.delete(cancelSessionId);
        console.log(`[Distill] Cancelled distillation for session ${cancelSessionId}`);
      }
      return;
    }
    case "miniworkflow.verify": {
      const { sessionId: verifySessionId, workflow: verifyWorkflow } = (event as any).payload;
      try {
        const verifyModel = verifyWorkflow.source_model;
        const testDir = join(getDataDir(), "distill-verify", verifySessionId);
        const replayResult = await runFullReplay(verifyWorkflow, testDir, { model: verifyModel, silent: true });
        const verification = await runAgentVerification(verifyWorkflow, replayResult, testDir, { model: verifyModel });

        emit({
          type: "miniworkflow.replay.verified",
          payload: {
            workflowId: verifyWorkflow.id, sessionId: verifySessionId, source: "editor_verify", verification,
            replayArtifacts: { filesCreated: replayResult.filesCreated, stepResults: replayResult.stepResults, workspaceDir: testDir }
          }
        } as any);
      } catch (err) {
        emit({
          type: "miniworkflow.replay.verified",
          payload: {
            workflowId: verifyWorkflow.id, sessionId: verifySessionId, source: "editor_verify",
            verification: { match: false, summary: `Ошибка верификации: ${String(err)}`, discrepancies: [String(err)], suggestions: [] }
          }
        } as any);
      }
      return;
    }
    case "miniworkflow.fix-discrepancies": {
      const { sessionId: fixSessionId, workflow: fixWorkflow, discrepancies, suggestions } = (event as any).payload;
      try {
        refineAbortControllers.get(fixSessionId)?.abort();
        const refineAbortController = new AbortController();
        refineAbortControllers.set(fixSessionId, refineAbortController);
        const schemaRef = getMiniWorkflowSchemaPrompt();
        const testDir = join(getDataDir(), "distill-verify", fixSessionId);
        await fs.mkdir(testDir, { recursive: true });

        const refineData = await runAgentRefine(fixWorkflow, { discrepancies, suggestions }, schemaRef, testDir, { model: fixWorkflow.source_model, signal: refineAbortController.signal });
        if (refineData.workflow) {
          const validation = validateWorkflow(refineData.workflow as Record<string, unknown>);
          if (validation.valid) {
            refineData.workflow.source_model = fixWorkflow.source_model;
            refineData.workflow.source_context = fixWorkflow.source_context;
            refineData.workflow.source_result = fixWorkflow.source_result;
            refineData.workflow.source_session_id = fixWorkflow.source_session_id;
            refineData.workflow.source_session_cwd = fixWorkflow.source_session_cwd;
            refineData.workflow.status = fixWorkflow.status;
            (refineData.workflow as any).debug_log_path = (fixWorkflow as any).debug_log_path;
            emit({
              type: "miniworkflow.refine.result",
              payload: { sessionId: fixSessionId, result: { status: "success", message: refineData.message || "Workflow исправлен.", workflow: refineData.workflow } }
            } as any);
          } else {
            emit({
              type: "miniworkflow.refine.result",
              payload: { sessionId: fixSessionId, result: { status: "error", message: `Невалидный workflow: ${validation.errors.join("; ")}` } }
            } as any);
          }
        } else {
          emit({
            type: "miniworkflow.refine.result",
            payload: { sessionId: fixSessionId, result: { status: "error", message: refineData.message || "Не удалось исправить." } }
          } as any);
        }
      } catch (err) {
        emit({
          type: "miniworkflow.refine.result",
          payload: { sessionId: fixSessionId, result: { status: "error", message: `Ошибка: ${String(err)}` } }
        } as any);
      } finally {
        refineAbortControllers.delete(fixSessionId);
      }
      return;
    }
    case "miniworkflow.refine": {
      const { sessionId: refineSessionId, workflow: refineWorkflow, userMessage } = (event as any).payload;
      try {
        refineAbortControllers.get(refineSessionId)?.abort();
        const refineAbortController = new AbortController();
        refineAbortControllers.set(refineSessionId, refineAbortController);
        const { client, modelName } = getLlmConnection(refineWorkflow.source_model);
        const schemaRef = getMiniWorkflowSchemaPrompt();
        const sourceCtx = refineWorkflow.source_context
          ? `\n\n<SOURCE_SESSION_CONTEXT>\n${String(refineWorkflow.source_context).slice(0, 6000)}\n</SOURCE_SESSION_CONTEXT>`
          : "";

        const systemPrompt = `Ты редактор MiniWorkflow. Пользователь просит внести изменения в workflow.\n\n${schemaRef}\n\nТекущий workflow (JSON):\n\`\`\`json\n${JSON.stringify(refineWorkflow, null, 2)}\n\`\`\`\n${sourceCtx}\n\nОтветь JSON (без markdown-обёртки):\n{\n  "message": "краткое описание что изменено",\n  "workflow": { ...обновлённый workflow целиком }\n}\n\nЕсли запрос непонятен или невыполним, верни:\n{ "message": "пояснение почему нельзя", "workflow": null }`;

        const result = await llmCall(client, modelName, systemPrompt, userMessage, undefined, undefined, refineAbortController.signal);
        const data = result.data;

        if (data.workflow) {
          const validation = validateWorkflow(data.workflow as Record<string, unknown>);
          if (!validation.valid) {
            emit({
              type: "miniworkflow.refine.result",
              payload: { sessionId: refineSessionId, result: { status: "error", message: `Агент вернул невалидный workflow: ${validation.errors.join("; ")}` } }
            } as any);
          } else {
            data.workflow.source_session_id = refineWorkflow.source_session_id;
            data.workflow.source_session_cwd = refineWorkflow.source_session_cwd;
            data.workflow.source_model = refineWorkflow.source_model;
            data.workflow.source_context = refineWorkflow.source_context;
            data.workflow.source_result = refineWorkflow.source_result;
            data.workflow.status = refineWorkflow.status;
            (data.workflow as any).debug_log_path = (refineWorkflow as any).debug_log_path;
            emit({
              type: "miniworkflow.refine.result",
              payload: { sessionId: refineSessionId, result: { status: "success", message: data.message || "Workflow обновлён.", workflow: data.workflow } }
            } as any);
          }
        } else {
          emit({
            type: "miniworkflow.refine.result",
            payload: { sessionId: refineSessionId, result: { status: "error", message: data.message || "Не удалось обработать запрос." } }
          } as any);
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") {
          emit({
            type: "miniworkflow.refine.result",
            payload: { sessionId: refineSessionId, result: { status: "error", message: "Request cancelled." } }
          } as any);
          return;
        }
        emit({
          type: "miniworkflow.refine.result",
          payload: { sessionId: refineSessionId, result: { status: "error", message: `Ошибка: ${String(err)}` } }
        } as any);
      } finally {
        refineAbortControllers.delete(refineSessionId);
      }
      return;
    }
    case "miniworkflow.refine.cancel": {
      const { sessionId: refineSessionId } = (event as any).payload;
      refineAbortControllers.get(refineSessionId)?.abort();
      refineAbortControllers.delete(refineSessionId);
      return;
    }
    case "miniworkflow.replay": {
      const { workflowId: replayWfId, cwd: replayCwd, inputs: replayInputs, model: replayModel } = (event as any).payload;
      if (!replayModel || !String(replayModel).trim()) {
        emit({ type: "miniworkflow.error", payload: { message: "Model is required to run Vale App" } } as any);
        return;
      }
      const replayWorkflow = await miniWorkflowStore.load(replayWfId, { projectCwd: replayCwd, preferProject: true });
      if (!replayWorkflow) {
        emit({ type: "miniworkflow.error", payload: { message: `Workflow not found: ${replayWfId}` } } as any);
        return;
      }

      const inputs = replayInputs || {};
      const firstInputValue = Object.values(inputs).find((v) => typeof v === "string" && String(v).trim().length > 0);

      const workflowDir = join(replayWorkflow.source_session_cwd || replayCwd || ".", ".valera", "workflows", replayWorkflow.id, "workspace");
      await safeRmDir(workflowDir);
      await fs.mkdir(workflowDir, { recursive: true });

      const session = sessions.createSession({
        cwd: workflowDir,
        title: `${replayWorkflow.name}${firstInputValue ? `: ${String(firstInputValue)}` : ""}`,
        allowedTools: replayWorkflow.compatibility.tools_required.join(","),
        prompt: "",
        model: replayModel
      });
      const replayAbortController = new AbortController();
      sessions.setAbortController(session.id, replayAbortController);
      stoppedSessionIds.delete(session.id);
      sessions.updateSession(session.id, { status: "running" });

      emit({ type: "session.status", payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model } } as any);
      emit({ type: "miniworkflow.replay.started", payload: { workflowId: replayWorkflow.id, sessionId: session.id } } as any);

      const secretBag: Record<string, string> = {};
      for (const inputSpec of replayWorkflow.inputs) {
        if (inputSpec.type === "secret" || inputSpec.redaction) {
          const v = inputs[inputSpec.id];
          if (typeof v === "string" && v) secretBag[inputSpec.id] = v;
        }
      }

      // Execute scripted steps
      const scriptResults: Record<string, string> = {};
      const stepDisplayResults: Record<string, string> = {};
      const scriptSteps = ((replayWorkflow as any).chain || []).filter((s: any) => s.execution === "script" && s.script?.code);
      if (scriptSteps.length > 0) {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);

        const emitProgress = (text: string) => emitAndPersist({
          type: "stream.message",
          payload: {
            sessionId: session.id,
            message: { type: "miniapp_step_progress", title: "MiniApp progress", text } as any
          }
        } as any);
        emitProgress(`⏳ Выполняю предварительные скрипты (${scriptSteps.length})...`);

        for (const step of scriptSteps) {
          if (stoppedSessionIds.has(session.id) || replayAbortController.signal.aborted) {
            throw new Error("__SESSION_STOPPED__");
          }
          try {
            const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "SYSTEMROOT", "COMSPEC", "SHELL", "PYTHONPATH", "PYTHONHOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "WINDIR"]);
            const SECRET_PATTERNS = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIAL|_AUTH)$|^(OPENAI|ANTHROPIC|TAVILY|ZAI|AWS_|AZURE_|GOOGLE_|GITHUB_TOKEN|NPM_TOKEN|CODEX_)/i;
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(process.env)) {
              if (v == null || SECRET_PATTERNS.test(k)) continue;
              if (SAFE_ENV_KEYS.has(k)) env[k] = v;
            }
            for (const [k, v] of Object.entries(inputs)) env[`INPUTS_${k.toUpperCase()}`] = String(v);
            for (const [k, v] of Object.entries(scriptResults)) env[`STEP_${k.toUpperCase()}_RESULT`] = v;
            env["WORKSPACE"] = workflowDir;

            const scriptFile = join(workflowDir, `${step.id}.py`);
            await fs.writeFile(scriptFile, step.script.code, "utf8");
            emitProgress(`▸ ${step.title}...`);

            const { stdout } = await execFileAsync("python", [scriptFile], {
              cwd: workflowDir, env, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, signal: replayAbortController.signal
            });
            const scriptOutput = (stdout || "").trim();
            const persisted = await persistStepOutput(workflowDir, step, scriptOutput);
            scriptResults[step.id] = scriptOutput;
            stepDisplayResults[step.id] = persisted.compactResult;
            emitAndPersist({
              type: "stream.message",
              payload: {
                sessionId: session.id,
                message: {
                  type: "miniapp_step_result",
                  stepId: step.id,
                  title: step.title,
                  status: "success",
                  summary: persisted.compactResult,
                  fullText: persisted.preview,
                  artifactPaths: persisted.artifactPaths
                } as any
              }
            } as any);
          } catch (err: any) {
            if (stoppedSessionIds.has(session.id) || replayAbortController.signal.aborted || err?.name === "AbortError") {
              throw new Error("__SESSION_STOPPED__");
            }
            scriptResults[step.id] = `[SCRIPT ERROR: ${err.message}]`;
            stepDisplayResults[step.id] = scriptResults[step.id];
            emitAndPersist({
              type: "stream.message",
              payload: {
                sessionId: session.id,
                message: {
                  type: "miniapp_step_result",
                  stepId: step.id,
                  title: step.title,
                  status: "failed",
                  summary: `Script step failed: ${String(err.message || err)}`,
                  fullText: String(err.stack || err.message || err)
                } as any
              }
            } as any);
          }
        }
        emitProgress(`✅ Скрипты выполнены. Запускаю агента...`);
      }

      // Execute LLM steps sequentially
      const llmSteps = getLlmSteps(replayWorkflow as any);
      const allStepResults: Record<string, string> = { ...scriptResults };
      let replayLogged = false;
      const orderedSteps: Array<{ step_id: string; status: "success" | "failed" | "skipped"; outputs?: unknown; error?: string | null; started_at?: string; finished_at?: string; duration_ms?: number }> = [];

      const finalizeReplayLog = (status: "success" | "partial" | "failed" | "aborted") => {
        if (replayLogged) return;
        replayLogged = true;
        void writeReplayLog(replayWorkflow as any, { inputs, final_status: status, step_results: orderedSteps });
      };

      const emitStepProgress = (text: string) => emitAndPersist({
        type: "stream.message",
        payload: {
          sessionId: session.id,
          message: { type: "miniapp_step_progress", title: "MiniApp progress", text } as any
        }
      } as any);

      const runSingleStep = (
        stepPrompt: string,
        stepTitle: string
      ): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }> => {
        return new Promise((resolve, reject) => {
          let collectedText = "";
          let stepCompleted = false;
          let stepUsage = { input_tokens: 0, output_tokens: 0 };

          const stepEmit = (serverEvent: ServerEvent) => {
            const msgType = serverEvent.type === "stream.message" ? (serverEvent.payload.message as any)?.type : null;
            const msgSubtype = serverEvent.type === "stream.message" ? (serverEvent.payload.message as any)?.subtype : null;
            const shouldForward =
              serverEvent.type !== "stream.message"
              || ((msgType !== "assistant" && msgType !== "text" && msgType !== "result" && msgType !== "user")
                && !(msgType === "system" && msgSubtype === "init"));
            if (shouldForward) {
              emit(serverEvent);
            }
            if (serverEvent.type === "stream.message" && serverEvent.payload.sessionId === session.id) {
              const msg = serverEvent.payload.message as any;
              if (msg.type === "result" && msg.result) {
                collectedText = msg.result;
                if (msg.usage) {
                  stepUsage = {
                    input_tokens: msg.usage.input_tokens ?? 0,
                    output_tokens: msg.usage.output_tokens ?? 0
                  };
                }
              } else if (msg.type === "assistant" && msg.message?.content) {
                const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
                for (const part of parts) {
                  if (part.type === "text" && part.text) {
                    collectedText += part.text;
                  }
                }
              } else if (msg.type === "text" && msg.text) {
                collectedText += msg.text;
              } else if (msg.type === "user" && msg.message?.content) {
                const parts = Array.isArray(msg.message.content) ? msg.message.content : [msg.message.content];
                for (const part of parts) {
                  if (part.type === "tool_result" && part.content) {
                    collectedText += `\n[tool_result] ${part.content}`;
                  }
                }
              }
            }
            if (serverEvent.type === "session.status" && serverEvent.payload.sessionId === session.id) {
              if (serverEvent.payload.status === "completed" || serverEvent.payload.status === "idle") {
                if (!stepCompleted) {
                  stepCompleted = true;
                  if (stoppedSessionIds.has(session.id)) {
                    reject(new Error("__SESSION_STOPPED__"));
                  } else {
                    resolve({ text: collectedText.trim(), usage: stepUsage });
                  }
                }
              }
              if (serverEvent.payload.status === "error") {
                if (!stepCompleted) { stepCompleted = true; reject(new Error(`Step "${stepTitle}" failed`)); }
              }
            }
            if (serverEvent.type === "runner.error" && serverEvent.payload.sessionId === session.id) {
              if (!stepCompleted) { stepCompleted = true; reject(new Error(serverEvent.payload.message)); }
            }
          };

          const runner = selectRunner(session.model);
          runner({
            prompt: stepPrompt, session, resumeSessionId: session.claudeSessionId,
            onEvent: stepEmit, secretBag,
            onSessionUpdate: (updates: any) => { sessions.updateSession(session.id, updates); }
          } as any)
            .then((handle: any) => { runnerHandles.set(session.id, handle); })
            .catch((error: any) => { if (!stepCompleted) { stepCompleted = true; reject(error); } });
        });
      };

      (async () => {
        try {
          for (let i = 0; i < llmSteps.length; i++) {
            if (stoppedSessionIds.has(session.id)) {
              throw new Error("__SESSION_STOPPED__");
            }
            const step = llmSteps[i];
            const stepStartedAt = Date.now();
            emitAndPersist({
              type: "stream.message",
              payload: {
                sessionId: session.id,
                message: {
                  type: "miniapp_step_progress",
                  stepId: step.id,
                  stepIndex: i + 1,
                  totalSteps: llmSteps.length,
                  title: step.title,
                  text: `Executing step ${i + 1}/${llmSteps.length}: ${step.title}`
                } as any
              }
            } as any);

            const stepPrompt = buildStepPrompt(replayWorkflow as any, step, i, llmSteps.length, inputs, allStepResults);
            sessions.updateSession(session.id, { lastPrompt: stepPrompt, status: "running" });

            try {
              const result = await runSingleStep(stepPrompt, step.title);
              const persisted = await persistStepOutput(workflowDir, step, result.text);
              allStepResults[step.id] = result.text;
              stepDisplayResults[step.id] = persisted.compactResult;
              orderedSteps.push({
                step_id: step.id, status: "success", outputs: persisted.compactResult.slice(0, 500),
                started_at: new Date(stepStartedAt).toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - stepStartedAt
              });
              emitAndPersist({
                type: "stream.message",
                payload: {
                  sessionId: session.id,
                  message: {
                    type: "miniapp_step_result",
                    stepId: step.id,
                    stepIndex: i + 1,
                    totalSteps: llmSteps.length,
                    title: step.title,
                    status: "success",
                    summary: persisted.compactResult,
                    fullText: persisted.preview,
                    artifactPaths: persisted.artifactPaths,
                    usage: result.usage
                  } as any
                }
              } as any);
            } catch (stepErr) {
              if (String(stepErr) === "__SESSION_STOPPED__") {
                throw stepErr;
              }
              allStepResults[step.id] = `[LLM ERROR: ${String(stepErr)}]`;
              stepDisplayResults[step.id] = allStepResults[step.id];
              orderedSteps.push({
                step_id: step.id, status: "failed", error: String(stepErr),
                started_at: new Date(stepStartedAt).toISOString(),
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - stepStartedAt
              });
              emitAndPersist({
                type: "stream.message",
                payload: {
                  sessionId: session.id,
                  message: {
                    type: "miniapp_step_result",
                    stepId: step.id,
                    stepIndex: i + 1,
                    totalSteps: llmSteps.length,
                    title: step.title,
                    status: "failed",
                    summary: `Step failed: ${String(stepErr)}`,
                    fullText: String(stepErr)
                  } as any
                }
              } as any);
              finalizeReplayLog("partial");
              return;
            }
          }

          const totalSteps = scriptSteps.length + llmSteps.length;
          emitStepProgress(`✅ Все ${totalSteps} шагов выполнены.`);

          if (replayWorkflow.source_result?.description) {
            if (stoppedSessionIds.has(session.id)) {
              throw new Error("__SESSION_STOPPED__");
            }
            emitStepProgress(`🔍 Верификация результата...`);
            try {
              const verifyModel = replayWorkflow.source_model || replayModel;
              let replayFiles: string[] = [];
              try {
                const entries = await fs.readdir(workflowDir, { recursive: true }) as string[];
                replayFiles = entries.filter(f => !f.endsWith(".py"));
              } catch { /* ignore */ }

              const replayResultForVerify: FullReplayResult = {
                stepResults: stepDisplayResults, scriptErrors: {}, filesCreated: replayFiles, sessionId: session.id, inputs
              };
              const verification = await runAgentVerification(replayWorkflow as any, replayResultForVerify, workflowDir, { model: verifyModel });

              emitAndPersist({
                type: "miniworkflow.replay.verified",
                payload: {
                  workflowId: replayWorkflow.id, sessionId: session.id, source: "runtime", verification,
                  replayArtifacts: { filesCreated: replayFiles, stepResults: stepDisplayResults, workspaceDir: workflowDir }
                }
              } as any);

              const verificationLines = verification.match
                ? [
                    "✅ Верификация пройдена: результат соответствует ожиданиям.",
                    verification.summary
                  ]
                : [
                    "⚠️ Верификация обнаружила расхождения.",
                    verification.summary,
                    ...(verification.discrepancies.length > 0
                      ? ["Расхождения:", ...verification.discrepancies.slice(0, 5).map((item) => `- ${item}`)]
                      : []),
                    ...(verification.suggestions.length > 0
                      ? ["Рекомендации:", ...verification.suggestions.slice(0, 3).map((item) => `- ${item}`)]
                      : [])
                  ];

              emitAndPersist({
                type: "stream.message",
                payload: {
                  sessionId: session.id,
                  message: {
                    type: "system",
                    subtype: "notice",
                    text: verificationLines.join("\n")
                  } as any
                }
              } as any);
            } catch (verifyErr) {
              emitStepProgress(`⚠️ Верификация не выполнена: ${String(verifyErr)}`);
            }
          }

          finalizeReplayLog("success");
          sessions.setAbortController(session.id, undefined);
          sessions.updateSession(session.id, { status: "completed" });
          emit({ type: "session.status", payload: { sessionId: session.id, status: "completed" } } as any);
        } catch (err) {
          if (String(err) === "__SESSION_STOPPED__") {
            finalizeReplayLog("aborted");
            sessions.setAbortController(session.id, undefined);
            runnerHandles.delete(session.id);
            return;
          }
          finalizeReplayLog("failed");
          sessions.setAbortController(session.id, undefined);
          sessions.updateSession(session.id, { status: "error" });
          emit({ type: "runner.error", payload: { sessionId: session.id, message: String(err) } } as any);
        }
      })();
      return;
    }

    case "oauth.login":
      handleOAuthLogin(event);
      return;
    case "oauth.logout":
      handleOAuthLogout(event);
      return;
    case "oauth.status.get":
      handleOAuthStatusGet(event);
      return;
    case "session.compact": {
      const { sessionId, sessionData, messages: historyMessages, llmProviderSettings, apiSettings } = (event as any).payload;
      
      // Restore session in memory if not present (same pattern as session.continue)
      let compactSession = sessions.getSession(sessionId);
      if (!compactSession && sessionData) {
        compactSession = sessions.restoreSession({
          id: sessionId,
          title: sessionData.title || "Restored Session",
          cwd: sessionData.cwd,
          model: sessionData.model,
          allowedTools: sessionData.allowedTools,
          temperature: sessionData.temperature,
        });
        if (historyMessages && Array.isArray(historyMessages)) {
          for (const msg of historyMessages) {
            const msgs = (sessions as any).messages.get(sessionId) || [];
            msgs.push(msg);
            (sessions as any).messages.set(sessionId, msgs);
          }
        }
      }

      void performCompact(sessionId, undefined, llmProviderSettings, apiSettings).catch((e) => {
        writeOut({ type: "log", level: "error", message: "[Compact] performCompact error", context: { error: String(e) } });
        sendRunnerError(`Compact failed: ${e}`, sessionId);
      });
      return;
    }
    default:
      // For now, emit a visible error so UI doesn't silently stall.
      sendRunnerError(`Sidecar: unhandled client event ${event.type}`);
      return;
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

writeOut({ type: "log", level: "info", message: "Sidecar started (in-memory mode)", context: {} });

rl.on("line", (line) => {
  if (!line.trim()) return;
  // Fail fast on invalid input: log the line, then let JSON.parse throw if invalid.
  const msg = JSON.parse(line) as SidecarInboundMessage;
  
  if (msg.type === "scheduler-response") {
    // Handle scheduler response from Rust
    const { requestId, result } = msg.payload;
    const pendingRequests = (global as any).schedulerPendingRequests || {};
    const resolve = pendingRequests[requestId];
    if (resolve) {
      resolve(result);
    }
    return;
  }
  
  if (msg.type !== "client-event") {
    throw new Error(`[sidecar] Unsupported inbound message type: ${(msg as any).type}`);
  }
  void handleClientEvent(msg.event).catch((error) => {
    writeOut({ type: "log", level: "error", message: "handleClientEvent failed", context: { error: String(error), eventType: (msg as any)?.event?.type } });
    // Fail fast on unexpected errors
    process.exit(1);
  });
});
