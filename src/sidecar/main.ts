import readline from "node:readline";
import type { ClientEvent } from "../ui/types.js";
import type { ServerEvent } from "../agent/types.js";
import type { SidecarInboundMessage, SidecarOutboundMessage } from "./protocol.js";

// Use in-memory session store - no SQLite/better-sqlite3 dependency
import { MemorySessionStore } from "./session-store-memory.js";

import { runClaude as runClaudeSDK } from "../agent/libs/runner.js";
import { runClaude as runOpenAI } from "../agent/libs/runner-openai.js";
import { loadApiSettings, saveApiSettings } from "../agent/libs/settings-store.js";
import { loadLLMProviderSettings, saveLLMProviderSettings } from "../agent/libs/llm-providers-store.js";
import { fetchModelsFromProvider, checkModelsAvailability } from "../agent/libs/llm-providers.js";
import { loadSkillsSettings, toggleSkill, setMarketplaceUrl } from "../agent/libs/skills-store.js";
import { fetchSkillsFromMarketplace } from "../agent/libs/skills-loader.js";
import { webCache } from "../agent/libs/web-cache.js";
import * as gitUtils from "../agent/git-utils.js";

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
const multiThreadTasks = new Map<string, any>();

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

function emitAndPersist(event: ServerEvent) {
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
  startRunner(session.id, event.payload.prompt);
}

function handleSessionContinue(event: Extract<ClientEvent, { type: "session.continue" }>) {
  const { sessionId, prompt, sessionData, messages: historyMessages, todos: historyTodos } = event.payload as any;
  let session = sessions.getSession(sessionId);
  
  // If session not in memory, try to restore from sessionData (provided by Rust)
  if (!session && sessionData) {
    session = sessions.createSession({
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

  sessions.updateSession(sessionId, { status: "running", lastPrompt: prompt });
  emit({
    type: "session.status",
    payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model, temperature: session.temperature },
  } as any);

  emitAndPersist({ type: "stream.user_prompt", payload: { sessionId: session.id, prompt } } as any);
  startRunner(session.id, prompt);
}

function handleSessionStop(event: Extract<ClientEvent, { type: "session.stop" }>) {
  const { sessionId } = event.payload;
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
    session = sessions.createSession({
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

function handleSkillsGet() {
  const settings = loadSkillsSettings();
  emit({
    type: "skills.loaded",
    payload: { skills: settings.skills, marketplaceUrl: settings.marketplaceUrl, lastFetched: settings.lastFetched },
  } as any);
}

function handleSkillsRefresh() {
  fetchSkillsFromMarketplace()
    .then(() => {
      handleSkillsGet();
    })
    .catch((error) => {
      emit({ type: "skills.error", payload: { message: String(error) } } as any);
    });
}

function handleSkillsToggle(event: Extract<ClientEvent, { type: "skills.toggle" }>) {
  const { skillId, enabled } = event.payload as any;
  toggleSkill(skillId, enabled);
}

function handleSkillsSetMarketplace(event: Extract<ClientEvent, { type: "skills.set-marketplace" }>) {
  const { url } = event.payload as any;
  setMarketplaceUrl(url);
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

