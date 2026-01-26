import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeSettingsEnv = {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_MODEL: string;
  API_TIMEOUT_MS: string;
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: string;
};

export type WebSearchProvider = 'tavily' | 'zai';

export type ZaiApiUrl = 'default' | 'coding';

export type ZaiReaderApiUrl = 'default' | 'coding';

export type ApiSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;  // Optional temperature for vLLM/OpenAI-compatible APIs
  tavilyApiKey?: string; // Optional Tavily API key for web search
  enableTavilySearch?: boolean; // Enable/disable Tavily search even with API key
  zaiApiKey?: string; // Optional Z.AI API key for web search
  webSearchProvider?: WebSearchProvider; // Web search provider: 'tavily' or 'zai'
  zaiApiUrl?: ZaiApiUrl; // Z.AI API URL variant: 'default' or 'coding'
  permissionMode?: 'default' | 'ask'; // Permission mode: 'default' = auto-execute, 'ask' = require confirmation
  enableMemory?: boolean; // Enable long-term memory tool
  enableZaiReader?: boolean; // Enable Z.AI Web Reader tool
  zaiReaderApiUrl?: ZaiReaderApiUrl; // Z.AI Reader API URL variant: 'default' or 'coding'
  // New tool group toggles
  enableGitTools?: boolean; // Enable git_* tools (11 tools)
  enableBrowserTools?: boolean; // Enable browser_* tools (11 tools)
  enableDuckDuckGo?: boolean; // Enable search/search_news/search_images (no API key needed)
  enableFetchTools?: boolean; // Enable fetch/fetch_json/download tools
  enableImageTools?: boolean; // Enable attach_image tool
  llmProviders?: LLMProviderSettings; // LLM providers and models configuration
};

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
};

// LLM Provider types
export type LLMProviderType = 'openai' | 'openrouter' | 'zai' | 'claude-code';

export type ZaiApiUrlPrefix = 'default' | 'coding';

export interface LLMProvider {
  id: string;
  type: LLMProviderType;
  name: string;
  apiKey: string;
  baseUrl?: string;
  zaiApiPrefix?: ZaiApiUrlPrefix; // Only for zai provider
  enabled: boolean;
}

export interface LLMModel {
  id: string;
  name: string;
  providerId: string;
  providerType: LLMProviderType;
  description?: string;
  enabled: boolean;
  contextLength?: number;
}

export interface LLMProviderSettings {
  providers: LLMProvider[];
  models: LLMModel[];
}

export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
};

export type StreamMessage = SDKMessage | UserPromptMessage;

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  claudeSessionId?: string;
  cwd?: string;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  threadId?: string; // Thread ID for multi-thread sessions
};

// Todo item type
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

// File change tracking type
export type ChangeStatus = 'pending' | 'confirmed';
export interface FileChange {
  path: string;              // Relative path from project root
  additions: number;         // Number of lines added
  deletions: number;         // Number of lines deleted
  status: ChangeStatus;      // 'pending' = can be rolled back, 'confirmed' = cannot rollback
}

// Thread info for listing threads in a session
export type ThreadInfo = {
  threadId: string;
  model: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
};

// Multi-thread task types
export type MultiThreadTask = {
  id: string;
  title: string;
  mode: TaskMode;
  createdAt: number;
  updatedAt: number;
  status: 'created' | 'running' | 'completed' | 'error';
  threadIds: string[];
  shareWebCache?: boolean;
  consensusModel?: string;
  consensusQuantity?: number;
  consensusPrompt?: string;
  autoSummary?: boolean;
  tasks?: ThreadTask[];
};

// Server -> Client events
export type ServerEvent =
  | { type: "stream.message"; payload: { sessionId: string; threadId?: string; message: StreamMessage } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; threadId?: string; prompt: string } }
  | { type: "session.status"; payload: { sessionId: string; threadId?: string; status: SessionStatus; title?: string; cwd?: string; error?: string; model?: string; temperature?: number } }
  | { type: "session.list"; payload: { sessions: SessionInfo[] } }
  | { type: "session.history"; payload: { sessionId: string; threadId?: string; status: SessionStatus; messages: StreamMessage[]; inputTokens?: number; outputTokens?: number; todos?: TodoItem[]; model?: string; fileChanges?: FileChange[]; hasMore?: boolean; nextCursor?: number; page?: "initial" | "prepend" } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "thread.list"; payload: { sessionId: string; threads: ThreadInfo[] } }
  | { type: "task.created"; payload: { task: MultiThreadTask; threads: ThreadInfo[] } }
  | { type: "task.status"; payload: { taskId: string; status: 'created' | 'running' | 'completed' | 'error' } }
  | { type: "task.error"; payload: { message: string } }
  | { type: "task.deleted"; payload: { taskId: string } }
  | { type: "permission.request"; payload: { sessionId: string; threadId?: string; toolUseId: string; toolName: string; input: unknown; explanation?: string } }
  | { type: "runner.error"; payload: { sessionId?: string; threadId?: string; message: string } }
  | { type: "settings.loaded"; payload: { settings: ApiSettings | null } }
  | { type: "models.loaded"; payload: { models: ModelInfo[] } }
  | { type: "models.error"; payload: { message: string } }
  | { type: "todos.updated"; payload: { sessionId: string; threadId?: string; todos: TodoItem[] } }
  | { type: "file_changes.updated"; payload: { sessionId: string; threadId?: string; fileChanges: FileChange[] } }
  | { type: "file_changes.confirmed"; payload: { sessionId: string; threadId?: string } }
  | { type: "file_changes.rolledback"; payload: { sessionId: string; threadId?: string; fileChanges: FileChange[] } }
  | { type: "file_changes.error"; payload: { sessionId: string; threadId?: string; message: string } }
  | { type: "llm.providers.loaded"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.providers.saved"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.models.fetched"; payload: { providerId: string; models: LLMModel[] } }
  | { type: "llm.models.error"; payload: { providerId: string; message: string } }
  | { type: "llm.models.checked"; payload: { unavailableModels: string[] } }
  // Skills events
  | { type: "skills.loaded"; payload: { skills: Skill[]; marketplaceUrl: string; lastFetched?: number } }
  | { type: "skills.error"; payload: { message: string } };

// Skill types
export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
  author?: string;
  version?: string;
  license?: string;
  compatibility?: string;
  repoPath: string;
  enabled: boolean;
  lastUpdated?: number;
}

// Task creation types
export type TaskMode = 'consensus' | 'different_tasks';

export type ThreadTask = {
  model: string;
  prompt: string;
  threadId?: string; // Assigned after creation
};

export type CreateTaskPayload = {
  mode: TaskMode;
  title: string;
  cwd?: string;
  allowedTools?: string;
  // For consensus mode: single model and quantity
  consensusModel?: string;
  consensusQuantity?: number; // 2-10
  autoSummary?: boolean; // Same model creates summary after all threads complete
  // For different tasks mode: array of tasks
  tasks?: ThreadTask[];
  shareWebCache?: boolean; // Share web requests between threads
};

// Client -> Server events
export type ClientEvent =
  | { type: "session.start"; payload: { title: string; prompt: string; cwd?: string; allowedTools?: string; model?: string; temperature?: number } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string; retry?: boolean; retryReason?: string } }
  | { type: "session.stop"; payload: { sessionId: string } }
  | { type: "session.delete"; payload: { sessionId: string } }
  | { type: "session.pin"; payload: { sessionId: string; isPinned: boolean } }
  | { type: "session.update-cwd"; payload: { sessionId: string; cwd: string } }
  | { type: "session.update"; payload: { sessionId: string; model?: string; temperature?: number; sendTemperature?: boolean; title?: string } }
  | { type: "session.list" }
  | { type: "session.history"; payload: { sessionId: string; threadId?: string; limit?: number; before?: number } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: PermissionResult } }
  | { type: "message.edit"; payload: { sessionId: string; messageIndex: number; newPrompt: string } }
  | { type: "settings.get" }
  | { type: "settings.save"; payload: { settings: ApiSettings } }
  | { type: "open.external"; payload: { url: string } }
  | { type: "models.get" }
  | { type: "task.create"; payload: CreateTaskPayload }
  | { type: "task.start"; payload: { taskId: string } }
  | { type: "task.delete"; payload: { taskId: string } }
  | { type: "thread.list"; payload: { sessionId: string } }
  | { type: "file_changes.confirm"; payload: { sessionId: string; threadId?: string } }
  | { type: "file_changes.rollback"; payload: { sessionId: string; threadId?: string } }
  | { type: "llm.providers.get" }
  | { type: "llm.providers.save"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.models.fetch"; payload: { providerId: string } }
  | { type: "llm.models.test"; payload: { provider: LLMProvider } }
  | { type: "llm.models.check" }
  // Skills events
  | { type: "skills.get" }
  | { type: "skills.refresh" }
  | { type: "skills.toggle"; payload: { skillId: string; enabled: boolean } }
  | { type: "skills.set-marketplace"; payload: { url: string } };
