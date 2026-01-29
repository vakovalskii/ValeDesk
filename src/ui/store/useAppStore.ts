import { create } from 'zustand';
import type { ServerEvent, SessionStatus, StreamMessage, TodoItem, FileChange, MultiThreadTask, LLMModel, LLMProvider, LLMProviderSettings, ApiSettings } from "../types";
import { getPlatform } from "../platform";

export type PermissionRequest = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  explanation?: string;
};

export type SessionView = {
  id: string;
  title: string;
  status: SessionStatus;
  cwd?: string;
  model?: string;
  temperature?: number;
  isPinned?: boolean;
  messages: StreamMessage[];
  permissionRequests: PermissionRequest[];
  lastPrompt?: string;
  createdAt?: number;
  updatedAt?: number;
  hydrated: boolean;
  inputTokens?: number;
  outputTokens?: number;
  todos?: TodoItem[];
  fileChanges?: FileChange[];
  historyHasMore?: boolean;
  historyCursor?: number;
  historyLoading?: boolean;
  historyLoadType?: "initial" | "prepend";
  historyLoadId?: number;
};

interface AppState {
  sessions: Record<string, SessionView>;
  activeSessionId: string | null;
  prompt: string;
  cwd: string;
  pendingStart: boolean;
  globalError: string | null;
  sessionsLoaded: boolean;
  showStartModal: boolean;
  historyRequested: Set<string>;
  autoScrollEnabled: boolean;
  selectedModel: string | null;
  selectedTemperature: number;
  sendTemperature: boolean;
  availableModels: Array<{ id: string; name: string; description?: string }>;
  multiThreadTasks: Record<string, MultiThreadTask>;
  llmProviders: LLMProvider[];
  llmModels: LLMModel[];
  llmProviderSettings: LLMProviderSettings | null;
  apiSettings: ApiSettings | null;
  schedulerDefaultModel: string | null;
  schedulerDefaultTemperature: number | null;
  schedulerDefaultSendTemperature: boolean | null;

  setPrompt: (prompt: string) => void;
  setCwd: (cwd: string) => void;
  setPendingStart: (pending: boolean) => void;
  setGlobalError: (error: string | null) => void;
  setShowStartModal: (show: boolean) => void;
  setActiveSessionId: (id: string | null) => void;
  markHistoryRequested: (sessionId: string) => void;
  setHistoryLoading: (sessionId: string, loading: boolean) => void;
  resolvePermissionRequest: (sessionId: string, toolUseId: string) => void;
  sendEvent: (event: any) => void;
  handleServerEvent: (event: ServerEvent) => void;
  setAutoScrollEnabled: (enabled: boolean) => void;
  setSelectedModel: (model: string | null) => void;
  setSelectedTemperature: (temp: number) => void;
  setSendTemperature: (send: boolean) => void;
  setAvailableModels: (models: Array<{ id: string; name: string; description?: string }>) => void;
  deleteMultiThreadTask: (taskId: string) => void;
  setLLMProviders: (providers: LLMProvider[]) => void;
  setLLMModels: (models: LLMModel[]) => void;
  setLLMProviderSettings: (settings: LLMProviderSettings) => void;
}

function createSession(id: string): SessionView {
  return { id, title: "", status: "idle", messages: [], permissionRequests: [], hydrated: false, todos: [], historyHasMore: false, historyLoading: false, historyLoadId: 0 };
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  prompt: "",
  cwd: "",
  pendingStart: false,
  globalError: null,
  sessionsLoaded: false,
  showStartModal: false,
  historyRequested: new Set(),
  autoScrollEnabled: true,
  selectedModel: null,
  selectedTemperature: 0.3,
  sendTemperature: true,
  availableModels: [],
  multiThreadTasks: {},
  llmProviders: [],
  llmModels: [],
  llmProviderSettings: null,
  apiSettings: null,
  schedulerDefaultModel: null,
  schedulerDefaultTemperature: null,
  schedulerDefaultSendTemperature: null,

  setPrompt: (prompt) => set({ prompt }),
  setCwd: (cwd) => set({ cwd }),
  setPendingStart: (pendingStart) => set({ pendingStart }),
  setGlobalError: (globalError) => set({ globalError }),
  setShowStartModal: (showStartModal) => set({ showStartModal }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  setAutoScrollEnabled: (autoScrollEnabled) => set({ autoScrollEnabled }),
  setHistoryLoading: (sessionId, loading) => {
    set((state) => {
      const existing = state.sessions[sessionId] ?? createSession(sessionId);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            historyLoading: loading
          }
        }
      };
    });
  },
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSelectedTemperature: (selectedTemperature) => set({ selectedTemperature }),
  setSendTemperature: (sendTemperature) => set({ sendTemperature }),
  setAvailableModels: (availableModels) => set({ availableModels }),
  setLLMProviders: (llmProviders) => set({ llmProviders }),
  setLLMModels: (llmModels) => set({ llmModels }),
  setLLMProviderSettings: (llmProviderSettings) => set({ llmProviderSettings }),
  deleteMultiThreadTask: (taskId) => {
    set((state) => {
      const nextTasks = { ...state.multiThreadTasks };
      delete nextTasks[taskId];
      return { multiThreadTasks: nextTasks };
    });
  },
  sendEvent: (event) => {
    getPlatform().sendClientEvent(event);
  },

  markHistoryRequested: (sessionId) => {
    set((state) => {
      const next = new Set(state.historyRequested);
      next.add(sessionId);
      return { historyRequested: next };
    });
  },

  resolvePermissionRequest: (sessionId, toolUseId) => {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return {};
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            permissionRequests: existing.permissionRequests.filter(req => req.toolUseId !== toolUseId)
          }
        }
      };
    });
  },

  handleServerEvent: (event) => {
    const state = get();

    switch (event.type) {
      case "session.list": {
        const nextSessions: Record<string, SessionView> = {};
        for (const session of event.payload.sessions) {
          const existing = state.sessions[session.id] ?? createSession(session.id);
          nextSessions[session.id] = {
            ...existing,
            status: session.status,
            title: session.title,
            cwd: session.cwd,
            model: session.model,
            isPinned: session.isPinned,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            inputTokens: session.inputTokens,
            outputTokens: session.outputTokens
          };
        }

        set({ sessions: nextSessions, sessionsLoaded: true });

        const hasSessions = event.payload.sessions.length > 0;
        set({ showStartModal: !hasSessions });

        if (!hasSessions) {
          get().setActiveSessionId(null);
        }

        if (!state.activeSessionId && event.payload.sessions.length > 0) {
          const sorted = [...event.payload.sessions].sort((a, b) => {
            const aTime = a.updatedAt ?? a.createdAt ?? 0;
            const bTime = b.updatedAt ?? b.createdAt ?? 0;
            return aTime - bTime;
          });
          const latestSession = sorted[sorted.length - 1];
          if (latestSession) {
            get().setActiveSessionId(latestSession.id);
          }
        } else if (state.activeSessionId) {
          const stillExists = event.payload.sessions.some(
            (session) => session.id === state.activeSessionId
          );
          if (!stillExists) {
            get().setActiveSessionId(null);
          }
        }
        break;
      }

      case "session.history": {
        const { sessionId, messages, status, inputTokens, outputTokens, todos, model, fileChanges, hasMore, nextCursor, page } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          const loadType = page ?? "initial";
          const mergedMessages = loadType === "prepend"
            ? [...messages, ...(existing.messages || [])]
            : messages;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                status,
                messages: mergedMessages,
                model: model ?? existing.model,
                hydrated: true,
                // Use token counts from payload (from DB), fallback to existing values
                inputTokens: inputTokens ?? existing.inputTokens,
                outputTokens: outputTokens ?? existing.outputTokens,
                // Load todos from DB (use empty array if none, don't inherit from previous session)
                todos: todos ?? [],
                // Load fileChanges from DB
                fileChanges: fileChanges ?? [],
                historyHasMore: hasMore ?? existing.historyHasMore,
                historyCursor: nextCursor ?? existing.historyCursor,
                historyLoading: false,
                historyLoadType: loadType,
                historyLoadId: (existing.historyLoadId ?? 0) + 1
              }
            }
          };
        });
        break;
      }

      case "session.status": {
        const { sessionId, status, title, cwd, model, temperature } = event.payload;
        const isPendingStart = state.pendingStart;

        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                status,
                title: title ?? existing.title,
                cwd: cwd ?? existing.cwd,
                model: model ?? existing.model,
                temperature: temperature ?? existing.temperature,
                updatedAt: Date.now(),
                // Mark as hydrated if this is a new session we just started
                // This prevents session.history from overwriting new messages
                hydrated: isPendingStart ? true : existing.hydrated
              }
            }
          };
        });

        if (isPendingStart) {
          get().setActiveSessionId(sessionId);
          set({ pendingStart: false, showStartModal: false });
        }
        break;
      }

      case "session.deleted": {
        const { sessionId } = event.payload;
        const state = get();
        if (!state.sessions[sessionId]) break;
        const nextSessions = { ...state.sessions };
        delete nextSessions[sessionId];
        set({
          sessions: nextSessions,
          showStartModal: Object.keys(nextSessions).length === 0
        });
        if (state.activeSessionId === sessionId) {
          const remaining = Object.values(nextSessions).sort(
            (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          );
          get().setActiveSessionId(remaining[0]?.id ?? null);
        }
        break;
      }

      case "stream.message": {
        const { sessionId, message } = event.payload;

        // OPTIMIZATION: Don't store stream_event messages in store
        // They are only used for live streaming preview in App.tsx (partialMessage)
        // Storing them causes 1000+ state updates per response
        if ((message as any).type === 'stream_event') {
          // Skip - handled by handlePartialMessages in App.tsx
          break;
        }

        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);

          // Check if this is an update to an existing message (for tool_use with diffSnapshot)
          const msgAny = message as any;
          if (msgAny._update && msgAny._updateToolUseId) {
            const toolUseIdToUpdate = msgAny._updateToolUseId;
            console.log(`[AppStore] ========== RECEIVED UPDATE EVENT ==========`);
            console.log(`[AppStore] Tool Use ID to update:`, toolUseIdToUpdate);
            console.log(`[AppStore] Has message.message:`, !!msgAny.message);
            console.log(`[AppStore] Has message.message.content:`, !!msgAny.message?.content);
            console.log(`[AppStore] Content length:`, msgAny.message?.content?.length);
            console.log(`[AppStore] First content type:`, msgAny.message?.content?.[0]?.type);
            console.log(`[AppStore] First content ID:`, msgAny.message?.content?.[0]?.id);
            console.log(`[AppStore] Has diffSnapshot in input:`, !!msgAny.message?.content?.[0]?.input?.diffSnapshot);
            if (msgAny.message?.content?.[0]?.input?.diffSnapshot) {
              console.log(`[AppStore] DiffSnapshot details:`, {
                filePath: msgAny.message.content[0].input.diffSnapshot.filePath,
                additions: msgAny.message.content[0].input.diffSnapshot.additions,
                deletions: msgAny.message.content[0].input.diffSnapshot.deletions
              });
            }
            console.log(`[AppStore] ==============================================`);
            
            // Find and update existing message
            const updatedMessages = existing.messages.map((msg: any) => {
              // Check if this is an assistant message with tool_use content
              if (msg.type === 'assistant' && msg.message?.content) {
                const assistantMsg = msg as any;
                console.log(`[AppStore] Checking assistant message with ${assistantMsg.message.content.length} content items`);
                console.log(`[AppStore] Looking for tool_use with ID:`, toolUseIdToUpdate);
                console.log(`[AppStore] Looking for tool_use with ID (type):`, typeof toolUseIdToUpdate);
                const toolUseIds = assistantMsg.message.content
                  .filter((c: any) => c.type === 'tool_use')
                  .map((c: any) => ({ id: c.id, idType: typeof c.id, name: c.name }));
                console.log(`[AppStore] Available tool_use IDs in this message:`, toolUseIds);
                console.log(`[AppStore] ID match check:`, toolUseIds.map((t: any) => ({
                  id: t.id,
                  matches: t.id === toolUseIdToUpdate,
                  strictEqual: t.id === toolUseIdToUpdate,
                  looseEqual: t.id == toolUseIdToUpdate
                })));
                const updatedContent = assistantMsg.message.content.map((content: any) => {
                  // Check if this is the tool_use we need to update
                  const idMatches = content.type === 'tool_use' && content.id === toolUseIdToUpdate;
                  if (idMatches) {
                    console.log(`[AppStore] ✓ FOUND tool_use to update!`);
                    console.log(`[AppStore] Current content:`, {
                      id: content.id,
                      name: content.name,
                      oldInputKeys: Object.keys(content.input || {}),
                      hasOldDiffSnapshot: !!(content.input?.diffSnapshot)
                    });
                    console.log(`[AppStore] New input data:`, {
                      newInputKeys: Object.keys(msgAny.message?.content?.[0]?.input || {}),
                      hasDiffSnapshot: !!(msgAny.message?.content?.[0]?.input?.diffSnapshot)
                    });
                    
                    // Update the tool_use content with new input (merge, not replace)
                    const newInput = msgAny.message?.content?.[0]?.input || {};
                    const updatedInput = {
                      ...content.input,
                      ...newInput
                    };
                    
                    console.log(`[AppStore] Merged input keys:`, Object.keys(updatedInput));
                    console.log(`[AppStore] Has diffSnapshot in merged:`, !!updatedInput.diffSnapshot);
                    
                    return {
                      ...content,
                      input: updatedInput
                    };
                  }
                  return content;
                });
                
                    // Check if any content was updated
                const wasUpdated = updatedContent.some((c: any, i: number) => {
                  const oldContent = assistantMsg.message.content[i];
                  return oldContent && (
                    JSON.stringify(c.input) !== JSON.stringify(oldContent.input)
                  );
                });
                
                if (wasUpdated) {
                  console.log(`[AppStore] ✓ Updated tool_use message in assistant message`);
                  // Force new object creation for React to detect change
                  return {
                    ...assistantMsg,
                    message: {
                      ...assistantMsg.message,
                      content: updatedContent,
                      // Add timestamp to force React to see this as a new object
                      _lastUpdated: Date.now()
                    }
                  };
                } else {
                  console.warn(`[AppStore] ⚠ Tool_use message not updated - no changes detected`);
                }
              }
              return msg;
            });
            
            // Check if we actually updated anything
            const anyUpdated = updatedMessages.some((msg: any, i: number) => {
              const oldMsg = existing.messages[i];
              return oldMsg && JSON.stringify(msg) !== JSON.stringify(oldMsg);
            });
            
            if (!anyUpdated) {
              console.warn(`[AppStore] ⚠ No messages were updated for tool_use id: ${toolUseIdToUpdate}`);
              console.log(`[AppStore] Existing messages:`, existing.messages.map((m: any) => ({
                type: m.type,
                hasContent: !!(m.message?.content),
                toolUseIds: m.message?.content?.filter((c: any) => c.type === 'tool_use').map((c: any) => c.id)
              })));
            }
            
            // Extract token usage from result messages
            let inputTokens = existing.inputTokens;
            let outputTokens = existing.outputTokens;
            if (message.type === "result" && (message as any).usage) {
              const { input_tokens, output_tokens } = (message as any).usage;
              if (input_tokens !== undefined) {
                inputTokens = input_tokens;
              }
              if (output_tokens !== undefined) {
                outputTokens = output_tokens;
              }
            }

            return {
              sessions: {
                ...state.sessions,
                [sessionId]: {
                  ...existing,
                  messages: updatedMessages,
                  inputTokens,
                  outputTokens
                }
              }
            };
          }

          // Extract token usage from result messages
          let inputTokens = existing.inputTokens;
          let outputTokens = existing.outputTokens;
          if (message.type === "result" && message.usage) {
            const { input_tokens, output_tokens } = message.usage;
            if (input_tokens !== undefined) {
              inputTokens = input_tokens;
            }
            if (output_tokens !== undefined) {
              outputTokens = output_tokens;
            }
          }

          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                messages: [...existing.messages, message],
                inputTokens,
                outputTokens
              }
            }
          };
        });
        break;
      }

      case "stream.user_prompt": {
        const { sessionId, prompt } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                messages: [...existing.messages, { type: "user_prompt", prompt }]
              }
            }
          };
        });
        break;
      }

      case "permission.request": {
        const { sessionId, toolUseId, toolName, input, explanation } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                permissionRequests: [...existing.permissionRequests, { toolUseId, toolName, input, explanation }]
              }
            }
          };
        });
        break;
      }

      case "runner.error": {
        set({ globalError: event.payload.message });
        break;
      }

      case "todos.updated": {
        const { sessionId, todos } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                todos
              }
            }
          };
        });
        break;
      }

      case "models.loaded": {
        const { models } = event.payload;
        set({ availableModels: models });
        console.log('[AppStore] Models loaded:', models);
        break;
      }

      case "models.error": {
        const { message } = event.payload;
        console.error('[AppStore] Failed to load models:', message);
        break;
      }

      case "file_changes.updated": {
        const { sessionId, fileChanges } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId] ?? createSession(sessionId);
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                fileChanges
              }
            }
          };
        });
        break;
      }

      case "file_changes.confirmed": {
        const { sessionId } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId];
          if (!existing || !existing.fileChanges) return {};
          const confirmedChanges = existing.fileChanges.map(c => ({ ...c, status: 'confirmed' as const }));
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                fileChanges: confirmedChanges
              }
            }
          };
        });
        break;
      }

      case "file_changes.rolledback": {
        const { sessionId, fileChanges } = event.payload;
        set((state) => {
          const existing = state.sessions[sessionId];
          if (!existing) return {};
          // Remaining fileChanges (failed rollback) or empty array if all succeeded
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...existing,
                fileChanges: fileChanges ?? []
              }
            }
          };
        });
        break;
      }

      case "file_changes.error": {
        const { message } = event.payload;
        set({ globalError: message });
        break;
      }

      case "task.created": {
        const { task } = event.payload;
        set((state) => ({
          multiThreadTasks: {
            ...state.multiThreadTasks,
            [task.id]: task
          }
        }));
        break;
      }

      case "task.status": {
        const { taskId, status } = event.payload;
        set((state) => {
          const existing = state.multiThreadTasks[taskId];
          if (!existing) return {};
          return {
            multiThreadTasks: {
              ...state.multiThreadTasks,
              [taskId]: {
                ...existing,
                status,
                updatedAt: Date.now()
              }
            }
          };
        });
        break;
      }

      case "task.error": {
        const { message } = event.payload;
        set({ globalError: message });
        break;
      }

      case "task.deleted": {
        const { taskId } = event.payload;
        set((state) => {
          const nextTasks = { ...state.multiThreadTasks };
          delete nextTasks[taskId];
          return { multiThreadTasks: nextTasks };
        });
        break;
      }

      case "llm.providers.loaded": {
        const { settings } = event.payload;
        set({ 
          llmProviders: settings.providers, 
          llmModels: settings.models,
          llmProviderSettings: settings
        });
        console.log('[AppStore] LLM providers loaded:', settings);
        break;
      }

      case "llm.providers.saved": {
        const { settings } = event.payload;
        set({ 
          llmProviders: settings.providers, 
          llmModels: settings.models,
          llmProviderSettings: settings
        });
        console.log('[AppStore] LLM providers saved:', settings);
        break;
      }

      case "llm.models.fetched": {
        const { models } = event.payload;
        console.log('[AppStore] LLM models fetched:', models);
        break;
      }

      case "llm.models.error": {
        const { message } = event.payload;
        console.error('[AppStore] LLM models error:', message);
        break;
      }

      case "llm.models.checked": {
        const { unavailableModels } = event.payload;
        console.log('[AppStore] LLM models checked, unavailable:', unavailableModels);
        break;
      }

      case "settings.loaded": {
        const { settings } = event.payload;
        set({ apiSettings: settings });
        console.log('[AppStore] Settings loaded:', settings);
        break;
      }

      // Scheduler default model loaded
      case "scheduler.default_model.loaded": {
        const { modelId } = event.payload;
        set({ schedulerDefaultModel: modelId });
        break;
      }

      // Scheduler default temperature loaded
      case "scheduler.default_temperature.loaded": {
        const { temperature, sendTemperature } = event.payload;
        set({
          schedulerDefaultTemperature: temperature,
          schedulerDefaultSendTemperature: sendTemperature
        });
        break;
      }

      // Scheduler task execution - auto-start session with prompt
      case "scheduler.task_execute": {
        const { title, prompt } = event.payload as any;
        if (prompt) {
          // Use scheduler default model, or fallback to first enabled model
          const { schedulerDefaultModel, llmModels } = get();
          let model = schedulerDefaultModel;
          
          if (!model) {
            const enabledModels = llmModels.filter(m => m.enabled);
            model = enabledModels.length > 0 ? enabledModels[0].id : null;
          }
          
          if (!model) {
            console.warn(`[scheduler] ✗ No model configured for task: ${title}`);
            break;
          }
          
          console.log(`[scheduler] ▶ Executing task: ${title} (model: ${model})`);
          getPlatform().sendClientEvent({
            type: "session.start",
            payload: {
              title: `Scheduled: ${title}`,
              prompt: prompt,
              model: model,
              cwd: undefined,
            }
          });
        }
        break;
      }
    }
  }
}));
