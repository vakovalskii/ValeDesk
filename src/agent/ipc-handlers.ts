import { BrowserWindow, powerMonitor, shell } from "electron";
import type { ClientEvent, ServerEvent, MultiThreadTask } from "./types.js";
import { runClaude as runClaudeSDK, type RunnerHandle } from "./libs/runner.js"; // Claude Code SDK runner (subscription)
import { runClaude as runOpenAI } from "./libs/runner-openai.js"; // OpenAI SDK runner
import { SessionStore } from "./libs/session-store.js";
import type { SessionHistoryPage } from "./libs/session-store.js";
import { SchedulerStore } from "./libs/scheduler-store.js";
import { SchedulerService } from "./libs/scheduler-service.js";
import { loadApiSettings, saveApiSettings } from "./libs/settings-store.js";
import { generateSessionTitle } from "./libs/util.js";
import { app } from "electron";
import { join } from "path";
import { sessionManager } from "./session-manager.js";
import * as gitUtils from "./git-utils.js";
import type { CreateTaskPayload, ThreadTask } from "./types.js";
import { webCache } from "./libs/web-cache.js";
import { loadLLMProviderSettings, saveLLMProviderSettings } from "./libs/llm-providers-store.js";
import { fetchModelsFromProvider, checkModelsAvailability, validateProvider, createProvider } from "./libs/llm-providers.js";
import { loadSkillsSettings, saveSkillsSettings, toggleSkill, setMarketplaceUrl } from "./libs/skills-store.js";
import { fetchSkillsFromMarketplace } from "./libs/skills-loader.js";

const DB_PATH = join(app.getPath("userData"), "sessions.db");
const sessions = new SessionStore(DB_PATH);
const schedulerStore = new SchedulerStore(sessions['db']); // Access the database
const runnerHandles = new Map<string, RunnerHandle>();
const multiThreadTasks = new Map<string, MultiThreadTask>();
let suppressStreamEvents = false;

app.on("ready", () => {
  powerMonitor.on("lock-screen", () => {
    suppressStreamEvents = true;
  });
  powerMonitor.on("unlock-screen", () => {
    suppressStreamEvents = false;
  });
});

// Make sessionStore and schedulerStore globally available for runner
(global as any).sessionStore = sessions;
(global as any).schedulerStore = schedulerStore;

/**
 * Select appropriate runner based on model/provider type
 * - claude-code:: prefix -> use Claude Code SDK (subscription)
 * - otherwise -> use OpenAI SDK compatible runner
 */
function selectRunner(model: string | undefined) {
  if (model?.startsWith('claude-code::')) {
    console.log('[IPC] Using Claude Code SDK runner for model:', model);
    return runClaudeSDK;
  }
  console.log('[IPC] Using OpenAI SDK runner for model:', model);
  return runOpenAI;
}

// Broadcast function for events without sessionId (session.list, models.loaded, etc.)
function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("server-event", payload);
  }
}

function emit(event: ServerEvent) {
  const isStreamEventMessage =
    event.type === "stream.message" &&
    (event.payload.message as any)?.type === "stream_event";
  if (event.type === "session.status") {
    sessions.updateSession(event.payload.sessionId, { status: event.payload.status });

    // Save token usage if provided in session.status payload
    const payload = event.payload as any;
    if (payload.usage) {
      const { input_tokens, output_tokens } = payload.usage;
      if (input_tokens !== undefined || output_tokens !== undefined) {
        sessions.updateTokens(
          event.payload.sessionId,
          input_tokens || 0,
          output_tokens || 0
        );
      }
    }

    // Check if this session is part of a multi-thread task and update task status
    checkAndUpdateMultiThreadTaskStatus(event.payload.sessionId, emit);
  }
  if (event.type === "stream.message") {
    const message = event.payload.message as any;
    // Check if this is a result message with token usage
    if (message.type === "result" && message.usage) {
      const { input_tokens, output_tokens } = message.usage;
      if (input_tokens !== undefined || output_tokens !== undefined) {
        sessions.updateTokens(
          event.payload.sessionId,
          input_tokens || 0,
          output_tokens || 0
        );
      }
    }
    if (!isStreamEventMessage) {
      sessions.recordMessage(event.payload.sessionId, event.payload.message);
    }
  }
  if (event.type === "stream.user_prompt") {
    sessions.recordMessage(event.payload.sessionId, {
      type: "user_prompt",
      prompt: event.payload.prompt
    });
  }
  if (isStreamEventMessage && suppressStreamEvents) {
    return;
  }
  // Route event through SessionManager
  sessionManager.emit(event, broadcast);
}

// Check if all threads in a multi-thread task are completed
function checkAndUpdateMultiThreadTaskStatus(sessionId: string, emitFn: (event: ServerEvent) => void) {
  // Find which task contains this session
  for (const [taskId, task] of multiThreadTasks.entries()) {
    if (!task.threadIds.includes(sessionId)) continue;

    // Get status of all threads in this task
    const threadStatuses = task.threadIds.map(id => {
      const thread = sessions.getSession(id);
      return thread?.status || 'idle';
    });

    // Count threads by status
    const total = threadStatuses.length;
    const completed = threadStatuses.filter(s => s === 'completed').length;
    const error = threadStatuses.filter(s => s === 'error').length;
    const running = threadStatuses.filter(s => s === 'running').length;

    // Determine task status
    let newStatus: 'created' | 'running' | 'completed' | 'error' = task.status;

    if (running === 0) {
      // All threads stopped - check if completed or had errors
      if (error > 0) {
        newStatus = 'error';
      } else if (completed === total) {
        newStatus = 'completed';
      }
    }

    // Emit task status update if changed
    if (newStatus !== task.status) {
      task.status = newStatus;
      task.updatedAt = Date.now();
      emitFn({
        type: "task.status",
        payload: { taskId, status: newStatus }
      });
      console.log(`[IPC] Task ${taskId} status updated to ${newStatus} (${completed}/${total} completed, ${error} errors)`);

      // If task completed and auto-summary is enabled, create summary thread
      if (newStatus === 'completed' && task.autoSummary) {
        createSummaryThread(taskId, task, emitFn);
      }
    }
    break;
  }
}

// Create a summary thread after all threads complete
async function createSummaryThread(taskId: string, task: MultiThreadTask, emitFn: (event: ServerEvent) => void) {
  console.log(`[IPC] Creating summary thread for task ${taskId}...`);

  // Collect all thread responses
  const threadResponses: { threadId: string; model: string; messages: any[] }[] = [];

  for (const threadId of task.threadIds) {
    const history = sessions.getSessionHistory(threadId);
    if (history && history.messages) {
      const thread = sessions.getSession(threadId);
      threadResponses.push({
        threadId,
        model: thread?.model || 'unknown',
        messages: history.messages
      });
    }
  }

  // Build summary prompt
  const summaryPrompt = `You are a summarization assistant. Here are ${threadResponses.length} responses from different AI models working on the same task.

Task: "${task.title}"

${threadResponses.map((r, i) => `
--- Thread ${i + 1} (${r.model}) ---
${r.messages.map(m => {
  if (m.type === 'user_prompt') return `User: ${m.prompt}`;
  if (m.type === 'result' && m.content) return `Response: ${JSON.stringify(m.content)}`;
  return '';
}).join('\n')}
--- End Thread ${i + 1} ---
`).join('\n')}

Please provide:
1. A comprehensive summary of what all threads accomplished
2. Key findings or insights from each thread
3. Any contradictions or differences between threads
4. A final consolidated result or recommendation

Format your response clearly with sections.`;

  // Create summary session
  const summarySession = sessions.createSession({
    title: `${task.title} - Summary`,
    cwd: undefined,
    allowedTools: '', // No tools for summary
    model: task.consensusModel || 'gpt-4',
    threadId: 'summary'
  });

  // Add summary thread to task
  task.threadIds.push(summarySession.id);
  task.updatedAt = Date.now();

  // Get session
  const session = sessions.getSession(summarySession.id);
  if (!session) {
    console.error('[IPC] Failed to create summary session');
    return;
  }

  // Start the summary thread
  sessions.updateSession(summarySession.id, { status: "running", lastPrompt: summaryPrompt });
  emitFn({
    type: "stream.user_prompt",
    payload: { sessionId: summarySession.id, threadId: 'summary', prompt: summaryPrompt }
  });

  try {
    const runClaude = selectRunner(session.model);
    const handle = await runClaude({
      prompt: summaryPrompt,
      session,
      resumeSessionId: undefined,
      onEvent: emitFn,
      onSessionUpdate: (updates) => {
        sessions.updateSession(summarySession.id, updates);
      }
    });

    runnerHandles.set(summarySession.id, handle);
    sessions.setAbortController(summarySession.id, undefined);

    // Broadcast session creation so UI shows the summary thread
    emitFn({
      type: "session.status",
      payload: {
        sessionId: summarySession.id,
        status: "running",
        title: `${task.title} - Summary`,
        model: task.consensusModel || 'gpt-4'
      }
    });
  } catch (error) {
    sessions.updateSession(summarySession.id, { status: "error" });
    emitFn({
      type: "runner.error",
      payload: { sessionId: summarySession.id, message: String(error) }
    });
  }
}

export async function handleClientEvent(event: ClientEvent, windowId: number) {
  if (event.type === "session.list") {
    sessionManager.emitToWindow(windowId, {
      type: "session.list",
      payload: { sessions: sessions.listSessions() }
    });
    return;
  }

  if (event.type === "session.history") {
    const sessionId = event.payload.sessionId;
    const limit = event.payload.limit;
    const before = event.payload.before;
    const history = typeof limit === "number"
      ? sessions.getSessionHistoryPage(sessionId, limit, before)
      : sessions.getSessionHistory(sessionId);
    if (!history) {
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: "Unknown session" }
      });
      return;
    }

    // Subscribe this window to the session
    sessionManager.setWindowSession(windowId, sessionId);

    // Send history only to this window (including todos)
    const paged = (typeof limit === "number" && "hasMore" in history)
      ? (history as SessionHistoryPage)
      : null;
    sessionManager.emitToWindow(windowId, {
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
        hasMore: paged?.hasMore ?? false,
        nextCursor: paged?.nextCursor,
        page: paged ? (before ? "prepend" : "initial") : "initial"
      }
    });
    return;
  }

  if (event.type === "session.start") {
    const session = sessions.createSession({
      cwd: event.payload.cwd,
      title: event.payload.title,
      allowedTools: event.payload.allowedTools,
      prompt: event.payload.prompt,
      model: event.payload.model,
      temperature: event.payload.temperature
    });

    // Subscribe this window to the session
    sessionManager.setWindowSession(windowId, session.id);

    // If prompt is empty, just create session without running AI
    if (!event.payload.prompt || event.payload.prompt.trim() === '') {
      sessions.updateSession(session.id, {
        status: "idle",
        lastPrompt: ""
      });
      sessionManager.emitToWindow(windowId, {
        type: "session.status",
        payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd, model: session.model }
      });
      return;
    }

    // Normal flow with prompt
    sessions.updateSession(session.id, {
      status: "running",
      lastPrompt: event.payload.prompt
    });
    sessionManager.emitToWindow(windowId, {
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model }
    });

    // Use emit() to save user_prompt to DB AND send to UI
    emit({
      type: "stream.user_prompt",
      payload: { sessionId: session.id, prompt: event.payload.prompt }
    });

    selectRunner(session.model)({
      prompt: event.payload.prompt,
      session,
      resumeSessionId: session.claudeSessionId,
      onEvent: emit,
      onSessionUpdate: (updates) => {
        sessions.updateSession(session.id, updates);
      }
    })
      .then((handle) => {
        runnerHandles.set(session.id, handle);
        sessions.setAbortController(session.id, undefined);
      })
      .catch((error) => {
        sessions.updateSession(session.id, { status: "error" });
        sessionManager.emitToWindow(windowId, {
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
            model: session.model,
            error: String(error)
          }
        });
      });

    return;
  }

  if (event.type === "session.continue") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) {
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: "Unknown session" }
      });
      return;
    }

    // Subscribe this window to the session
    sessionManager.setWindowSession(windowId, session.id);

    // If session has no claudeSessionId yet (was created empty), treat this as first run
    const isFirstRun = !session.claudeSessionId;
    
    // Generate title for empty chats on first real prompt
    let sessionTitle = session.title;
    if (isFirstRun && session.title === "New Chat" && event.payload.prompt) {
      // Generate title asynchronously but don't block
      generateSessionTitle(event.payload.prompt)
        .then((newTitle) => {
          if (newTitle && newTitle !== "New Chat") {
            sessions.updateSession(session.id, { title: newTitle });
            emit({
              type: "session.status",
              payload: { sessionId: session.id, status: session.status, title: newTitle, cwd: session.cwd, model: session.model }
            });
          }
        })
        .catch((err) => {
          console.error('Failed to generate title for continued session:', err);
        });
    }

    const isSamePrompt = session.lastPrompt === event.payload.prompt;
    sessions.updateSession(session.id, { status: "running", lastPrompt: event.payload.prompt });
    sessionManager.emitToWindow(windowId, {
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: sessionTitle, cwd: session.cwd, model: session.model }
    });

    if (event.payload.retry) {
      emit({
        type: "stream.message",
        payload: {
          sessionId: session.id,
          message: {
            type: "system",
            subtype: "notice",
            text: "Retrying the last request..."
          } as any
        }
      });
    }

    if (!isSamePrompt) {
      emit({
        type: "stream.user_prompt",
        payload: { sessionId: session.id, prompt: event.payload.prompt }
      });
    }

    selectRunner(session.model)({
      prompt: event.payload.prompt,
      session,
      resumeSessionId: isFirstRun ? undefined : session.claudeSessionId,
      onEvent: emit,
      onSessionUpdate: (updates) => {
        sessions.updateSession(session.id, updates);
      }
    })
      .then((handle) => {
        runnerHandles.set(session.id, handle);
      })
      .catch((error) => {
        sessions.updateSession(session.id, { status: "error" });
        sessionManager.emitToWindow(windowId, {
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
            model: session.model,
            error: String(error)
          }
        });
      });

    return;
  }

  if (event.type === "session.stop") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) return;

    const handle = runnerHandles.get(session.id);
    if (handle) {
      handle.abort();
      runnerHandles.delete(session.id);
    }

    sessions.updateSession(session.id, { status: "idle" });
    sessionManager.emitToWindow(windowId, {
      type: "session.status",
      payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd, model: session.model }
    });
    return;
  }

  if (event.type === "session.delete") {
    const sessionId = event.payload.sessionId;
    const handle = runnerHandles.get(sessionId);
    if (handle) {
      handle.abort();
      runnerHandles.delete(sessionId);
    }

    // Always try to delete and emit deleted event
    // Don't emit error if session doesn't exist - it may have already been deleted
    sessions.deleteSession(sessionId);

    // Broadcast session.deleted since it should update all windows' session lists
    broadcast({
      type: "session.deleted",
      payload: { sessionId }
    });
    return;
  }

  if (event.type === "session.pin") {
    const { sessionId, isPinned } = event.payload;
    sessions.setPinned(sessionId, isPinned);
    // Broadcast session.list since pinning affects all windows' session lists
    broadcast({
      type: "session.list",
      payload: { sessions: sessions.listSessions() }
    });
    return;
  }

  if (event.type === "session.update-cwd") {
    const { sessionId, cwd } = event.payload;
    sessions.updateSession(sessionId, { cwd });
    const session = sessions.getSession(sessionId);
    if (session) {
      // Use emit to route only to subscribed windows
      emit({
        type: "session.status",
        payload: { sessionId: session.id, status: session.status, title: session.title, cwd: session.cwd, model: session.model }
      });
    }
    return;
  }

  if (event.type === "session.update") {
    const { sessionId, model, temperature, title } = event.payload;
    const updates: any = {};
    if (model !== undefined) updates.model = model;
    if (temperature !== undefined) updates.temperature = temperature;
    if (title !== undefined) updates.title = title;
    
    sessions.updateSession(sessionId, updates);
    const session = sessions.getSession(sessionId);
    if (session) {
      console.log(`[IPC] Session ${sessionId} updated:`, updates);
      emit({
        type: "session.status",
        payload: { 
          sessionId: session.id, 
          status: session.status, 
          title: session.title, 
          cwd: session.cwd, 
          model: session.model,
          temperature: session.temperature
        }
      });
    }
    return;
  }

  if (event.type === "permission.response") {
    const { sessionId, toolUseId, result } = event.payload;
    const handle = runnerHandles.get(sessionId);
    
    if (handle && handle.resolvePermission) {
      const approved = result.behavior === 'allow';
      console.log(`[IPC] Permission response for ${toolUseId}: ${approved ? 'APPROVED' : 'DENIED'}`);
      handle.resolvePermission(toolUseId, approved);
    } else {
      console.warn(`[IPC] No runner handle found for session ${sessionId}`);
    }
    return;
  }

  if (event.type === "message.edit") {
    const { sessionId, messageIndex, newPrompt } = event.payload;
    const session = sessions.getSession(sessionId);

    if (!session) {
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: "Unknown session" }
      });
      return;
    }

    // Stop current runner if running
    const handle = runnerHandles.get(sessionId);
    if (handle) {
      handle.abort();
      runnerHandles.delete(sessionId);
    }

    // Truncate history after the edited message
    sessions.truncateHistoryAfter(sessionId, messageIndex);
    
    // Update the message with new prompt
    sessions.updateMessageAt(sessionId, messageIndex, { prompt: newPrompt });

    // Get updated history and send to UI (only to this window)
    const updatedHistory = sessions.getSessionHistory(sessionId);
    if (updatedHistory) {
      sessionManager.emitToWindow(windowId, {
        type: "session.history",
        payload: {
          sessionId: updatedHistory.session.id,
          status: updatedHistory.session.status,
          messages: updatedHistory.messages,
          todos: updatedHistory.todos || [],
          model: updatedHistory.session.model
        }
      });
    }

    // Update session status
    sessions.updateSession(sessionId, { status: "running", lastPrompt: newPrompt });
    
    // Emit status update
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd, model: session.model }
    });

    // Re-run from this point
    selectRunner(session.model)({
      prompt: newPrompt,
      session,
      resumeSessionId: session.claudeSessionId,
      onEvent: emit,
      onSessionUpdate: (updates) => {
        sessions.updateSession(session.id, updates);
      }
    })
      .then((newHandle) => {
        runnerHandles.set(session.id, newHandle);
      })
      .catch((error) => {
        sessions.updateSession(session.id, { status: "error" });
        emit({
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
            model: session.model,
            error: String(error)
          }
        });
      });

    return;
  }

  if (event.type === "settings.get") {
    const settings = loadApiSettings();
    sessionManager.emitToWindow(windowId, {
      type: "settings.loaded",
      payload: { settings }
    });
    return;
  }

  if (event.type === "settings.save") {
    try {
      saveApiSettings(event.payload.settings);
      sessionManager.emitToWindow(windowId, {
        type: "settings.loaded",
        payload: { settings: event.payload.settings }
      });
    } catch (error) {
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: `Failed to save settings: ${error}` }
      });
    }
    return;
  }

  if (event.type === "open.external") {
    shell.openExternal(event.payload.url);
    return;
  }

  if (event.type === "models.get") {
    fetchModels().then(models => {
      emit({
        type: "models.loaded",
        payload: { models }
      });
    }).catch(error => {
      console.error('[IPC] Failed to fetch models:', error);
      emit({
        type: "models.error",
        payload: { message: String(error) }
      });
    });
    return;
  }

  if (event.type === "thread.list") {
    const { sessionId } = event.payload;
    const threads = sessions.getThreads(sessionId);
    sessionManager.emitToWindow(windowId, {
      type: "thread.list",
      payload: { sessionId, threads }
    });
    return;
  }

  if (event.type === "task.delete") {
    const { taskId } = event.payload;
    const task = multiThreadTasks.get(taskId);

    if (task) {
      // Delete all associated sessions
      for (const threadId of task.threadIds) {
        const handle = runnerHandles.get(threadId);
        if (handle) {
          handle.abort();
          runnerHandles.delete(threadId);
        }
        sessions.deleteSession(threadId);
      }

      // Remove task from memory
      multiThreadTasks.delete(taskId);

      // Emit deleted event
      broadcast({
        type: "task.deleted",
        payload: { taskId }
      });
    }
    return;
  }

  if (event.type === "task.create") {
    const payload = event.payload;
    const { mode, title, cwd, allowedTools, shareWebCache } = payload;

    // Clear web cache if sharing is disabled
    if (!shareWebCache) {
      webCache.clear();
    }

    const createdThreads: Array<{ threadId: string; model: string; status: "idle" | "running" | "completed" | "error"; createdAt: number; updatedAt: number }> = [];
    const threadIds: string[] = [];
    const now = Date.now();

    if (mode === 'consensus') {
      // Create N threads with the same model and prompt - DON'T START THEM YET
      const consensusModel = payload.consensusModel || 'gpt-4';
      const quantity = payload.consensusQuantity || 5;
      const consensusPrompt = (payload as any).consensusPrompt || '';

      for (let i = 0; i < quantity; i++) {
        const threadTitle = `${title} [${i + 1}/${quantity}]`;

        const thread = sessions.createSession({
          title: threadTitle,
          cwd,
          allowedTools,
          model: consensusModel,
          threadId: `thread-${i + 1}`
        });

        threadIds.push(thread.id);

        createdThreads.push({
          threadId: thread.id,
          model: consensusModel,
          status: 'idle',
          createdAt: now,
          updatedAt: now
        });
      }
    } else if (mode === 'different_tasks' && payload.tasks) {
      // Create threads with different models and tasks - DON'T START THEM YET
      const tasks = payload.tasks as ThreadTask[];

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const threadTitle = `${title} [${i + 1}/${tasks.length}]`;

        const thread = sessions.createSession({
          title: threadTitle,
          cwd,
          allowedTools,
          model: task.model,
          threadId: `thread-${i + 1}`
        });

        threadIds.push(thread.id);

        createdThreads.push({
          threadId: thread.id,
          model: task.model,
          status: 'idle',
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Create MultiThreadTask object - status is 'created' initially
    const taskId = `task-${now}`;
    const task = {
      id: taskId,
      title,
      mode,
      createdAt: now,
      updatedAt: now,
      status: 'created' as const,  // Start with 'created' not 'running'
      threadIds,
      shareWebCache,
      consensusModel: payload.consensusModel,
      consensusQuantity: payload.consensusQuantity,
      consensusPrompt: (payload as any).consensusPrompt,
      autoSummary: payload.autoSummary,
      tasks: payload.tasks
    };

    multiThreadTasks.set(taskId, task);

    // Emit task.created event with task object and created threads
    sessionManager.emitToWindow(windowId, {
      type: "task.created",
      payload: { task, threads: createdThreads }
    });

    // Broadcast session.list to update UI with new thread sessions
    const allSessions = sessions.listSessions();
    broadcast({
      type: "session.list",
      payload: { sessions: allSessions }
    });

    // Auto-start task immediately
    // Update task status to 'running'
    (task as any).status = 'running';
    (task as any).updatedAt = Date.now();

    // Broadcast task status update
    broadcast({
      type: "task.status",
      payload: { taskId, status: 'running' }
    });

    // Start all threads
    if (task.mode === 'consensus') {
      const consensusPrompt = task.consensusPrompt || '';

      for (const threadId of task.threadIds) {
        const thread = sessions.getSession(threadId);
        if (!thread) continue;

        // Start the thread with the prompt
        if (consensusPrompt && consensusPrompt.trim() !== '') {
          sessions.updateSession(threadId, { status: "running", lastPrompt: consensusPrompt });
          emit({
            type: "stream.user_prompt",
            payload: { sessionId: threadId, threadId, prompt: consensusPrompt }
          });

          selectRunner(thread.model)({
            prompt: consensusPrompt,
            session: thread,
            resumeSessionId: thread.claudeSessionId,
            onEvent: emit,
            onSessionUpdate: (updates) => {
              sessions.updateSession(threadId, updates);
            }
          })
            .then((handle) => {
              runnerHandles.set(threadId, handle);
              sessions.setAbortController(threadId, undefined);
            })
            .catch((error) => {
              sessions.updateSession(threadId, { status: "error" });
              emit({
                type: "runner.error",
                payload: { sessionId: threadId, message: error.message }
              });
            });
        }
      }
    } else if (task.mode === 'different_tasks' && task.tasks) {
      for (let i = 0; i < task.threadIds.length; i++) {
        const threadId = task.threadIds[i];
        const taskPrompt = task.tasks[i]?.prompt || '';
        const thread = sessions.getSession(threadId);
        if (!thread) continue;

        // Start thread with its prompt
        if (taskPrompt && taskPrompt.trim() !== '') {
          sessions.updateSession(threadId, { status: "running", lastPrompt: taskPrompt });
          emit({
            type: "stream.user_prompt",
            payload: { sessionId: threadId, threadId, prompt: taskPrompt }
          });

          selectRunner(thread.model)({
            prompt: taskPrompt,
            session: thread,
            resumeSessionId: thread.claudeSessionId,
            onEvent: emit,
            onSessionUpdate: (updates) => {
              sessions.updateSession(threadId, updates);
            }
          })
            .then((handle) => {
              runnerHandles.set(threadId, handle);
              sessions.setAbortController(threadId, undefined);
            })
            .catch((error) => {
              sessions.updateSession(threadId, { status: "error" });
              emit({
                type: "runner.error",
                payload: { sessionId: threadId, message: error.message }
              });
            });
        }
      }
    }
    return;
  }

  if (event.type === "task.start") {
    const { taskId } = event.payload;
    const task = multiThreadTasks.get(taskId);

    if (!task) {
      sessionManager.emitToWindow(windowId, {
        type: "task.error",
        payload: { message: `Task ${taskId} not found` }
      });
      return;
    }

    // Update task status to 'running'
    task.status = 'running';
    task.updatedAt = Date.now();

    // Broadcast task status update
    broadcast({
      type: "task.status",
      payload: { taskId, status: 'running' }
    });

    // Start all threads
    if (task.mode === 'consensus') {
      const consensusPrompt = task.consensusPrompt || '';

      for (const threadId of task.threadIds) {
        const thread = sessions.getSession(threadId);
        if (!thread) continue;

        // Start the thread with the prompt
        if (consensusPrompt && consensusPrompt.trim() !== '') {
          sessions.updateSession(threadId, { status: "running", lastPrompt: consensusPrompt });
          emit({
            type: "stream.user_prompt",
            payload: { sessionId: threadId, threadId, prompt: consensusPrompt }
          });

          selectRunner(thread.model)({
            prompt: consensusPrompt,
            session: thread,
            resumeSessionId: thread.claudeSessionId,
            onEvent: emit,
            onSessionUpdate: (updates) => {
              sessions.updateSession(threadId, updates);
            }
          })
            .then((handle) => {
              runnerHandles.set(threadId, handle);
              sessions.setAbortController(threadId, undefined);
            })
            .catch((error) => {
              sessions.updateSession(threadId, { status: "error" });
              emit({
                type: "runner.error",
                payload: { sessionId: threadId, message: String(error) }
              });
            });
        }
      }
    } else if (task.mode === 'different_tasks' && task.tasks) {
      for (let i = 0; i < task.threadIds.length; i++) {
        const threadId = task.threadIds[i];
        const taskPrompt = task.tasks[i]?.prompt || '';
        const thread = sessions.getSession(threadId);
        if (!thread) continue;

        // Start the thread with its prompt
        if (taskPrompt && taskPrompt.trim() !== '') {
          sessions.updateSession(threadId, { status: "running", lastPrompt: taskPrompt });
          emit({
            type: "stream.user_prompt",
            payload: { sessionId: threadId, threadId, prompt: taskPrompt }
          });

          selectRunner(thread.model)({
            prompt: taskPrompt,
            session: thread,
            resumeSessionId: thread.claudeSessionId,
            onEvent: emit,
            onSessionUpdate: (updates) => {
              sessions.updateSession(threadId, updates);
            }
          })
            .then((handle) => {
              runnerHandles.set(threadId, handle);
              sessions.setAbortController(threadId, undefined);
            })
            .catch((error) => {
              sessions.updateSession(threadId, { status: "error" });
              emit({
                type: "runner.error",
                payload: { sessionId: threadId, message: String(error) }
              });
            });
        }
      }
    }
    return;
  }

  if (event.type === "file_changes.confirm") {
    const { sessionId } = event.payload;
    const session = sessions.getSession(sessionId);

    if (!session) {
      sessionManager.emitToWindow(windowId, {
        type: "file_changes.error",
        payload: { sessionId, message: "Session not found" }
      });
      return;
    }

    // Mark all file changes as confirmed
    sessions.confirmFileChanges(sessionId);

    // Emit confirmation event
    emit({
      type: "file_changes.confirmed",
      payload: { sessionId }
    });
    return;
  }

  if (event.type === "file_changes.rollback") {
    const { sessionId } = event.payload;
    const session = sessions.getSession(sessionId);

    if (!session || !session.cwd) {
      sessionManager.emitToWindow(windowId, {
        type: "file_changes.error",
        payload: { sessionId, message: "Session not found or no working directory" }
      });
      return;
    }

    // Check if this is a git repository
    if (!gitUtils.isGitRepo(session.cwd)) {
      sessionManager.emitToWindow(windowId, {
        type: "file_changes.error",
        payload: { sessionId, message: "Not a git repository" }
      });
      return;
    }

    // Get pending file changes (status: pending)
    const allChanges = sessions.getFileChanges(sessionId);
    const pendingChanges = allChanges.filter(c => c.status === 'pending');

    if (pendingChanges.length === 0) {
      sessionManager.emitToWindow(windowId, {
        type: "file_changes.error",
        payload: { sessionId, message: "No pending changes to rollback" }
      });
      return;
    }

    // Rollback all pending files using git checkout
    const filePaths = pendingChanges.map(c => c.path);
    const { succeeded, failed } = gitUtils.checkoutFiles(filePaths, session.cwd);

    if (failed.length > 0) {
      console.warn(`Failed to checkout files: ${failed.join(', ')}`);
    }

    // Clear file changes from database
    sessions.clearFileChanges(sessionId);

    // Emit rollback event with remaining changes (failed ones)
    const remainingChanges = allChanges.filter(c => failed.includes(c.path));
    emit({
      type: "file_changes.rolledback",
      payload: { sessionId, fileChanges: remainingChanges }
    });
    return;
  }

  // LLM Providers handlers
  if (event.type === "llm.providers.get") {
    const settings = loadLLMProviderSettings();
    sessionManager.emitToWindow(windowId, {
      type: "llm.providers.loaded",
      payload: { settings: settings || { providers: [], models: [] } }
    });
    return;
  }

  if (event.type === "llm.providers.save") {
    try {
      console.log('[IPC] Received llm.providers.save event');
      console.log('[IPC] Settings to save:', JSON.stringify(event.payload.settings, null, 2));
      console.log('[IPC] Providers count:', event.payload.settings.providers?.length || 0);
      console.log('[IPC] Models count:', event.payload.settings.models?.length || 0);
      
      saveLLMProviderSettings(event.payload.settings);
      
      console.log('[IPC] Settings saved successfully');
      
      sessionManager.emitToWindow(windowId, {
        type: "llm.providers.saved",
        payload: { settings: event.payload.settings }
      });
    } catch (error) {
      console.error('[IPC] Failed to save LLM providers:', error);
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: `Failed to save LLM providers: ${error}` }
      });
    }
    return;
  }

  if (event.type === "llm.models.test") {
    const { provider } = event.payload;
    
    fetchModelsFromProvider(provider)
      .then(models => {
        sessionManager.emitToWindow(windowId, {
          type: "llm.models.fetched",
          payload: { providerId: provider.id, models }
        });
      })
      .catch(error => {
        console.error('[IPC] Failed to test provider connection:', error);
        sessionManager.emitToWindow(windowId, {
          type: "llm.models.error",
          payload: { providerId: provider.id, message: String(error) }
        });
      });
    return;
  }

  if (event.type === "llm.models.fetch") {
    const { providerId } = event.payload;
    const settings = loadLLMProviderSettings();
    
    if (!settings) {
      sessionManager.emitToWindow(windowId, {
        type: "llm.models.error",
        payload: { providerId, message: "No settings found" }
      });
      return;
    }

    const provider = settings.providers.find(p => p.id === providerId);
    if (!provider) {
      sessionManager.emitToWindow(windowId, {
        type: "llm.models.error",
        payload: { providerId, message: "Provider not found" }
      });
      return;
    }

    fetchModelsFromProvider(provider)
      .then(models => {
        // Merge with existing models
        const existingSettings = loadLLMProviderSettings() || { providers: [], models: [] };
        
        // Remove old models for this provider
        const existingModels = existingSettings.models.filter(m => m.providerId !== providerId);
        
        // Add new models
        const updatedModels = [...existingModels, ...models];
        
        // Update settings
        const updatedSettings = {
          ...existingSettings,
          models: updatedModels
        };
        
        saveLLMProviderSettings(updatedSettings);
        
        sessionManager.emitToWindow(windowId, {
          type: "llm.models.fetched",
          payload: { providerId, models }
        });
      })
      .catch(error => {
        console.error('[IPC] Failed to fetch models:', error);
        sessionManager.emitToWindow(windowId, {
          type: "llm.models.error",
          payload: { providerId, message: String(error) }
        });
      });
    return;
  }

  if (event.type === "llm.models.check") {
    const settings = loadLLMProviderSettings();
    if (!settings) {
      sessionManager.emitToWindow(windowId, {
        type: "runner.error",
        payload: { message: "No LLM provider settings found" }
      });
      return;
    }

    const unavailableModels: string[] = [];
    const enabledProviders = settings.providers.filter(p => p.enabled);

    // Check each provider
    for (const provider of enabledProviders) {
      const providerModels = settings.models.filter(m => m.providerId === provider.id && m.enabled);
      const unavailable = await checkModelsAvailability(provider, providerModels);
      unavailableModels.push(...unavailable);
    }

    // Disable unavailable models
    if (unavailableModels.length > 0) {
      const updatedModels = settings.models.map(m => 
        unavailableModels.includes(m.id) ? { ...m, enabled: false } : m
      );
      
      const updatedSettings = { ...settings, models: updatedModels };
      saveLLMProviderSettings(updatedSettings);
    }

    sessionManager.emitToWindow(windowId, {
      type: "llm.models.checked",
      payload: { unavailableModels }
    });
    return;
  }

  // Skills handlers
  if (event.type === "skills.get") {
    const settings = loadSkillsSettings();
    sessionManager.emitToWindow(windowId, {
      type: "skills.loaded",
      payload: {
        skills: settings.skills,
        marketplaceUrl: settings.marketplaceUrl,
        lastFetched: settings.lastFetched
      }
    });
    return;
  }

  if (event.type === "skills.refresh") {
    fetchSkillsFromMarketplace()
      .then(skills => {
        const settings = loadSkillsSettings();
        sessionManager.emitToWindow(windowId, {
          type: "skills.loaded",
          payload: {
            skills: settings.skills,
            marketplaceUrl: settings.marketplaceUrl,
            lastFetched: settings.lastFetched
          }
        });
      })
      .catch(error => {
        console.error('[IPC] Failed to refresh skills:', error);
        sessionManager.emitToWindow(windowId, {
          type: "skills.error",
          payload: { message: String(error) }
        });
      });
    return;
  }

  if (event.type === "skills.toggle") {
    const { skillId, enabled } = event.payload;
    toggleSkill(skillId, enabled);
    return;
  }

  if (event.type === "skills.set-marketplace") {
    const { url } = event.payload;
    setMarketplaceUrl(url);
    return;
  }
}

async function fetchModels(): Promise<Array<{ id: string; name: string; description?: string }>> {
  const settings = loadApiSettings();

  if (!settings || !settings.baseUrl || !settings.apiKey) {
    throw new Error('API settings not configured');
  }

  // Build the models URL
  // For standard OpenAI-compatible APIs, add /v1/models
  // For z.ai URLs that already contain /v4, extract the base URL and append /models
  let modelsURL: string;
  const baseURL = settings.baseUrl;

  // Check if baseURL already ends with /v1 (standard OpenAI format)
  if (baseURL.endsWith('/v1')) {
    modelsURL = `${baseURL}/models`;
  }
  // Check if baseURL contains /v4 (z.ai format)
  else if (baseURL.includes('/v4')) {
    // Extract base URL up to /v4
    const v4Index = baseURL.indexOf('/v4');
    const baseURLUpToV4 = baseURL.substring(0, v4Index + 3); // Include /v4
    modelsURL = `${baseURLUpToV4}/models`;
  }
  // Check if baseURL ends with / (trailing slash)
  else if (baseURL.endsWith('/')) {
    modelsURL = `${baseURL}v1/models`;
  }
  // Default: add /v1/models
  else {
    modelsURL = `${baseURL}/v1/models`;
  }

  console.log('[IPC] Fetching models from:', modelsURL);

  try {
    const response = await fetch(modelsURL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    
    // Handle different response formats
    if (data.data && Array.isArray(data.data)) {
      // OpenAI-style response: { data: [{ id, ... }] }
      return data.data.map((model: any) => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description
      }));
    } else if (Array.isArray(data)) {
      // Simple array response: [{ id, ... }]
      return data.map((model: any) => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description
      }));
    } else {
      console.warn('[IPC] Unexpected models response format:', data);
      return [];
    }
  } catch (error) {
    console.error('[IPC] Error fetching models:', error);
    throw error;
  }
}

// Initialize scheduler service
let schedulerService: SchedulerService | null = null;

async function executeScheduledTask(task: any) {
  console.log(`[Scheduler] Executing scheduled task: ${task.title}`);
  
  if (!task.prompt) {
    // Just a reminder, no action needed
    return;
  }

  // Execute the prompt in a temporary session
  const apiSettings = loadApiSettings();
  if (!apiSettings) {
    console.error('[Scheduler] No API settings found');
    return;
  }

  // Create a temporary session for scheduled task
  const tempSession = sessions.createSession({
    title: `Scheduled: ${task.title}`,
    cwd: '', // No workspace for scheduled tasks
    allowedTools: 'default',
    prompt: task.prompt
  });

  const session = sessions.getSession(tempSession.id);
  if (!session) {
    console.error('[Scheduler] Failed to create session');
    return;
  }

  try {
    // Run the prompt
    await selectRunner(session.model)({
      prompt: task.prompt,
      session,
      onEvent: emit
    });
  } catch (error) {
    console.error(`[Scheduler] Error executing task ${task.id}:`, error);
  }
}

export function startScheduler() {
  if (schedulerService) {
    console.log('[Scheduler] Already started');
    return;
  }

  schedulerService = new SchedulerService(schedulerStore, executeScheduledTask);
  schedulerService.start();
  console.log('[Scheduler] Service started');
}

export function stopScheduler() {
  if (schedulerService) {
    schedulerService.stop();
    schedulerService = null;
    console.log('[Scheduler] Service stopped');
  }
}

export { sessions, schedulerStore };
