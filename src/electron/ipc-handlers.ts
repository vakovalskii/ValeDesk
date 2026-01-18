import { BrowserWindow, shell } from "electron";
import type { ClientEvent, ServerEvent } from "./types.js";
// import { runClaude, type RunnerHandle } from "./libs/runner.js"; // Old Claude SDK runner
import { runClaude, type RunnerHandle } from "./libs/runner-openai.js"; // New OpenAI SDK runner
import { SessionStore } from "./libs/session-store.js";
import { loadApiSettings, saveApiSettings } from "./libs/settings-store.js";
import { app } from "electron";
import { join } from "path";

const DB_PATH = join(app.getPath("userData"), "sessions.db");
const sessions = new SessionStore(DB_PATH);
const runnerHandles = new Map<string, RunnerHandle>();

// Make sessionStore globally available for runner
(global as any).sessionStore = sessions;

function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("server-event", payload);
  }
}

function emit(event: ServerEvent) {
  if (event.type === "session.status") {
    sessions.updateSession(event.payload.sessionId, { status: event.payload.status });
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
    sessions.recordMessage(event.payload.sessionId, event.payload.message);
  }
  if (event.type === "stream.user_prompt") {
    sessions.recordMessage(event.payload.sessionId, {
      type: "user_prompt",
      prompt: event.payload.prompt
    });
  }
  broadcast(event);
}

export function handleClientEvent(event: ClientEvent) {
  if (event.type === "session.list") {
    emit({
      type: "session.list",
      payload: { sessions: sessions.listSessions() }
    });
    return;
  }

  if (event.type === "session.history") {
    const history = sessions.getSessionHistory(event.payload.sessionId);
    if (!history) {
      emit({
        type: "runner.error",
        payload: { message: "Unknown session" }
      });
      return;
    }
    emit({
      type: "session.history",
      payload: {
        sessionId: history.session.id,
        status: history.session.status,
        messages: history.messages,
        inputTokens: history.session.inputTokens,
        outputTokens: history.session.outputTokens
      }
    });
    return;
  }

  if (event.type === "session.start") {
    const session = sessions.createSession({
      cwd: event.payload.cwd,
      title: event.payload.title,
      allowedTools: event.payload.allowedTools,
      prompt: event.payload.prompt
    });

    // If prompt is empty, just create session without running AI
    if (!event.payload.prompt || event.payload.prompt.trim() === '') {
      sessions.updateSession(session.id, {
        status: "idle",
        lastPrompt: ""
      });
      emit({
        type: "session.status",
        payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd }
      });
      return;
    }

    // Normal flow with prompt
    sessions.updateSession(session.id, {
      status: "running",
      lastPrompt: event.payload.prompt
    });
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
    });

    emit({
      type: "stream.user_prompt",
      payload: { sessionId: session.id, prompt: event.payload.prompt }
    });

    runClaude({
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
        emit({
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
            error: String(error)
          }
        });
      });

    return;
  }

  if (event.type === "session.continue") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) {
      emit({
        type: "runner.error",
        payload: { message: "Unknown session" }
      });
      return;
    }

    // If session has no claudeSessionId yet (was created empty), treat this as first run
    const isFirstRun = !session.claudeSessionId;

    sessions.updateSession(session.id, { status: "running", lastPrompt: event.payload.prompt });
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
    });

    emit({
      type: "stream.user_prompt",
      payload: { sessionId: session.id, prompt: event.payload.prompt }
    });

    runClaude({
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
        emit({
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
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
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd }
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
    emit({
      type: "session.deleted",
      payload: { sessionId }
    });
    return;
  }

  if (event.type === "session.pin") {
    const { sessionId, isPinned } = event.payload;
    sessions.setPinned(sessionId, isPinned);
    emit({
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
      emit({
        type: "session.status",
        payload: { sessionId: session.id, status: session.status, title: session.title, cwd: session.cwd }
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
      emit({
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

    // Get updated history and send to UI
    const updatedHistory = sessions.getSessionHistory(sessionId);
    if (updatedHistory) {
      emit({
        type: "session.history",
        payload: {
          sessionId: updatedHistory.session.id,
          status: updatedHistory.session.status,
          messages: updatedHistory.messages
        }
      });
    }

    // Update session status
    sessions.updateSession(sessionId, { status: "running", lastPrompt: newPrompt });
    
    // Emit status update
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
    });

    // Re-run from this point
    runClaude({
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
            error: String(error)
          }
        });
      });

    return;
  }

  if (event.type === "settings.get") {
    const settings = loadApiSettings();
    emit({
      type: "settings.loaded",
      payload: { settings }
    });
    return;
  }

  if (event.type === "settings.save") {
    try {
      saveApiSettings(event.payload.settings);
      emit({
        type: "settings.loaded",
        payload: { settings: event.payload.settings }
      });
    } catch (error) {
      emit({
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

export { sessions };
