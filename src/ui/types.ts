import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { MiniWorkflow, MiniWorkflowSummary } from "../shared/mini-workflow-types.js";
export type { MiniWorkflow, MiniWorkflowSummary, MiniWorkflowTestResult } from "../shared/mini-workflow-types.js";
export { detectPermissions } from "../shared/mini-workflow-types.js";
export type { DetectedPermissions } from "../shared/mini-workflow-types.js";

export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
};

export type MiniAppStepProgressMessage = {
  type: "miniapp_step_progress";
  stepId?: string;
  stepIndex?: number;
  totalSteps?: number;
  title: string;
  text: string;
};

export type MiniAppStepResultMessage = {
  type: "miniapp_step_result";
  stepId: string;
  stepIndex?: number;
  totalSteps?: number;
  title: string;
  status: "success" | "failed";
  summary: string;
  fullText?: string;
  artifactPaths?: string[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
};

export type StreamMessage =
  | SDKMessage
  | UserPromptMessage
  | MiniAppStepProgressMessage
  | MiniAppStepResultMessage;

export type SessionStatus = "idle" | "running" | "completed" | "error";

// Todo types
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

// Skill types
export type SkillRepositoryType = "github" | "local" | "http" | "skillsbd";

export interface SkillRepository {
  id: string;
  name: string;
  type: SkillRepositoryType;
  url: string; // GitHub API URL | local path | http base URL
  enabled: boolean;
}

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
  repositoryId: string;
  enabled: boolean;
  lastUpdated?: number;
  // Skillsbd-specific optional fields
  owner?: string;
  repo?: string;
  installs?: number;
  trending24h?: number;
  tags?: string[];
  featured?: boolean;
  authorName?: string;
  telegramLink?: string;
}

export type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  claudeSessionId?: string;
  cwd?: string;
  model?: string;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  threadId?: string; // Thread ID for multi-thread sessions
};

export type ThreadInfo = {
  threadId: string; // Session ID (threads are stored as sessions)
  model: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
};

// Task creation types
export type TaskMode = 'consensus' | 'different_tasks' | 'role_group';

export type RoleGroupRoleId =
  | 'product_manager'
  | 'team_lead'
  | 'backend_dev'
  | 'frontend_dev'
  | 'analyst'
  | 'qa'
  | 'devops'
  | 'architect';

export type RoleGroupRoleConfig = {
  id: RoleGroupRoleId;
  name: string;
  enabled: boolean;
  model?: string;
  prompt: string;
};

export type RoleGroupSettings = {
  roles: RoleGroupRoleConfig[];
};

export type ThreadTask = {
  id: string;
  model: string;
  prompt: string;
  roleId?: RoleGroupRoleId;
  roleName?: string;
};


export type CreateTaskPayload = {
  mode: TaskMode;
  title: string;
  cwd?: string;
  allowedTools?: string;
  shareWebCache?: boolean;

  // For consensus mode
  consensusModel?: string;
  consensusQuantity?: number;
  consensusPrompt?: string;
  autoSummary?: boolean;

  // For different_tasks mode
  tasks?: ThreadTask[];

  // For role_group mode
  roleGroupPrompt?: string;
  roleGroupModel?: string;
};

export type CreatedThreadInfo = {
  threadId: string;
  model: string;
  status: string;
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
  summaryThreadId?: string;  // ID of summary thread if created
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
  useGitForDiff?: boolean; // Use git for diff (true) or file snapshots (false)
  useBuiltinViewer?: boolean; // Use built-in file preview panel (true) or open in OS app (false)
  llmProviders?: LLMProviderSettings; // LLM providers and models configuration
  roleGroupSettings?: RoleGroupSettings; // Default role group configuration
  requestTimeoutMs?: number; // API request timeout in ms (default: 300000 = 5 min)
  locale?: string; // UI language (e.g. 'en', 'ru')
};

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
};

// LLM Provider types
export type LLMProviderType = 'openai' | 'openrouter' | 'zai' | 'ollama' | 'claude-code' | 'codex';

export type ZaiApiUrlPrefix = 'default' | 'coding';

export interface LLMProvider {
  id: string;
  type: LLMProviderType;
  name: string;
  apiKey: string;
  baseUrl?: string;
  zaiApiPrefix?: ZaiApiUrlPrefix; // Only for zai provider
  proxyUrl?: string; // HTTP/HTTPS/SOCKS5 proxy URL
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

// Server -> Client events
export type ServerEvent =
  | { type: "stream.message"; payload: { sessionId: string; message: StreamMessage; threadId?: string } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string; threadId?: string } }
  | { type: "session.status"; payload: { sessionId: string; status: SessionStatus; title?: string; cwd?: string; error?: string; model?: string; temperature?: number; threadId?: string } }
  | { type: "session.list"; payload: { sessions: SessionInfo[] } }
  | { type: "session.history"; payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[]; inputTokens?: number; outputTokens?: number; todos?: TodoItem[]; model?: string; fileChanges?: FileChange[]; hasMore?: boolean; nextCursor?: number; page?: "initial" | "prepend" } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown; explanation?: string } }
  | { type: "runner.error"; payload: { sessionId?: string; message: string } }
  | { type: "settings.loaded"; payload: { settings: ApiSettings | null } }
  | { type: "models.loaded"; payload: { models: ModelInfo[] } }
  | { type: "models.error"; payload: { message: string } }
  | { type: "todos.updated"; payload: { sessionId: string; todos: TodoItem[] } }
  | { type: "file_changes.updated"; payload: { sessionId: string; fileChanges: FileChange[] } }
  | { type: "file_changes.confirmed"; payload: { sessionId: string } }
  | { type: "file_changes.rolledback"; payload: { sessionId: string; fileChanges: FileChange[] } }
  | { type: "file_changes.error"; payload: { sessionId: string; message: string } }
  | { type: "thread.list"; payload: { sessionId: string; threads: ThreadInfo[] } }
  | { type: "task.created"; payload: { task: MultiThreadTask; threads: CreatedThreadInfo[] } }
  | { type: "task.status"; payload: { taskId: string; status: 'created' | 'running' | 'completed' | 'error' } }
  | { type: "task.error"; payload: { message: string } }
  | { type: "task.deleted"; payload: { taskId: string } }
  | { type: "llm.providers.loaded"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.providers.saved"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.models.fetched"; payload: { providerId: string; models: LLMModel[] } }
  | { type: "llm.models.error"; payload: { providerId: string; message: string } }
  | { type: "llm.models.checked"; payload: { unavailableModels: string[] } }
  // Skills events
  | { type: "skills.loaded"; payload: { skills: Skill[]; repositories: SkillRepository[]; lastFetched?: number } }
  | { type: "skills.error"; payload: { message: string } }
  // Mini workflow events
  | { type: "miniworkflow.list"; payload: { workflows: MiniWorkflowSummary[] } }
  | { type: "miniworkflow.loaded"; payload: { workflow: MiniWorkflow } }
  | { type: "miniworkflow.distill.progress"; payload: { sessionId: string; step: number; totalSteps: number; label: string; usage?: { input_tokens: number; output_tokens: number } } }
  | { type: "miniworkflow.distill.result"; payload: { sessionId: string; usage?: { input_tokens: number; output_tokens: number }; debugLogPath?: string; result: { status: "success"; workflow: MiniWorkflow } | { status: "needs_clarification"; questions: string[] } | { status: "not_suitable"; reason: string; suggest_prompt_preset: boolean } | { status: "cancelled" } } }
  | { type: "miniworkflow.replay.started"; payload: { workflowId: string; sessionId: string } }
  | { type: "miniworkflow.replay.verified"; payload: { workflowId: string; sessionId: string; source?: "runtime" | "editor_verify" | "distill"; verification: { match: boolean; summary: string; discrepancies: string[]; suggestions: string[] }; verifyCycles?: { used: number; max: number }; replayArtifacts?: { filesCreated: string[]; stepResults: Record<string, string>; workspaceDir?: string } } }
  | { type: "miniworkflow.refine.result"; payload: { sessionId: string; result: { status: "success"; message: string; workflow: MiniWorkflow } | { status: "error"; message: string } } }
  | { type: "miniworkflow.error"; payload: { message: string } }
  // Compact events
  | { type: "session.compacting"; payload: { sessionId: string } }
  | { type: "session.compacted"; payload: { oldSessionId: string; newSessionId: string } }
  // Scheduler events
  | { type: "scheduler.notification"; payload: { title: string; body: string } }
  | { type: "scheduler.task_execute"; payload: { taskId: string; title: string; prompt?: string } }
  | { type: "scheduler.default_model.loaded"; payload: { modelId: string | null } }
  | { type: "scheduler.default_temperature.loaded"; payload: { temperature: number; sendTemperature: boolean } }
  // OAuth events
  | { type: "oauth.flow.started"; payload: { authorizeUrl: string; flowId: string } }
  | { type: "oauth.flow.completed"; payload: { provider: string; email?: string; accountId?: string } }
  | { type: "oauth.flow.error"; payload: { message: string } }
  | { type: "oauth.status"; payload: { provider: string; loggedIn: boolean; email?: string; accountId?: string; expiresAt?: string } };

// Client -> Server events
export type ClientEvent =
  | { type: "session.start"; payload: { title: string; prompt: string; cwd?: string; model?: string; allowedTools?: string; threadId?: string; temperature?: number } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string; retry?: boolean; retryReason?: string } }
  | { type: "session.stop"; payload: { sessionId: string; } }
  | { type: "session.delete"; payload: { sessionId: string; } }
  | { type: "session.pin"; payload: { sessionId: string; isPinned: boolean; } }
  | { type: "session.update-cwd"; payload: { sessionId: string; cwd: string; } }
  | { type: "session.update"; payload: { sessionId: string; model?: string; temperature?: number; sendTemperature?: boolean; title?: string; } }
  | { type: "session.list" }
  | { type: "session.history"; payload: { sessionId: string; limit?: number; before?: number } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: PermissionResult; } }
  | { type: "message.edit"; payload: { sessionId: string; messageIndex: number; newPrompt: string; } }
  | { type: "settings.get" }
  | { type: "settings.save"; payload: { settings: ApiSettings; } }
  | { type: "open.external"; payload: { url: string; } }
  | { type: "open.path"; payload: { path: string; cwd?: string } }
  | { type: "models.get" }
  | { type: "file_changes.confirm"; payload: { sessionId: string; } }
  | { type: "file_changes.rollback"; payload: { sessionId: string; } }
  | { type: "thread.list"; payload: { sessionId: string } }
  | { type: "task.create"; payload: CreateTaskPayload }
  | { type: "task.start"; payload: { taskId: string } }
  | { type: "task.delete"; payload: { taskId: string } }
  | { type: "task.stop"; payload: { sessionId: string } }
  | { type: "llm.providers.get" }
  | { type: "llm.providers.save"; payload: { settings: LLMProviderSettings } }
  | { type: "llm.models.fetch"; payload: { providerId: string } }
  | { type: "llm.models.test"; payload: { provider: LLMProvider } }
  | { type: "llm.models.check" }
  // Skills events
  | { type: "skills.get" }
  | { type: "skills.refresh" }
  | { type: "skills.toggle"; payload: { skillId: string; enabled: boolean } }
  | { type: "skills.set-marketplace"; payload: { url: string } }
  | { type: "skills.add-repository"; payload: { repo: Omit<SkillRepository, "id"> } }
  | { type: "skills.update-repository"; payload: { id: string; updates: Partial<Omit<SkillRepository, "id">> } }
  | { type: "skills.remove-repository"; payload: { id: string } }
  | { type: "skills.toggle-repository"; payload: { id: string; enabled: boolean } }
  // Mini workflow events
  | { type: "miniworkflow.list"; payload?: { cwd?: string; global?: boolean; includeArchived?: boolean } }
  | { type: "miniworkflow.get"; payload: { workflowId: string; cwd?: string } }
  | { type: "miniworkflow.distill"; payload: { sessionId: string; validationErrors?: string[]; model?: string; maxVerifyCycles?: number } }
  | { type: "miniworkflow.distill.cancel"; payload: { sessionId: string } }
  | { type: "miniworkflow.archive"; payload: { workflowId: string; cwd?: string } }
  | { type: "miniworkflow.restore"; payload: { workflowId: string; cwd?: string } }
  | { type: "miniworkflow.save"; payload: { workflow: MiniWorkflow; scope?: "global" | "project"; cwd?: string } }
  | { type: "miniworkflow.delete"; payload: { workflowId: string; scope?: "global" | "project" | "both"; cwd?: string } }
  | { type: "miniworkflow.replay"; payload: { workflowId: string; inputs: Record<string, unknown>; cwd?: string; model?: string } }
  | { type: "miniworkflow.refine"; payload: { sessionId: string; workflow: MiniWorkflow; userMessage: string } }
  | { type: "miniworkflow.refine.cancel"; payload: { sessionId: string } }
  | { type: "miniworkflow.verify"; payload: { sessionId: string; workflow: MiniWorkflow } }
  | { type: "miniworkflow.fix-discrepancies"; payload: { sessionId: string; workflow: MiniWorkflow; discrepancies: string[]; suggestions: string[] } }
  // Compact events
  | { type: "session.compact"; payload: { sessionId: string } }
  // Scheduler events
  | { type: "scheduler.default_model.get" }
  | { type: "scheduler.default_model.set"; payload: { modelId: string } }
  | { type: "scheduler.default_temperature.get" }
  | { type: "scheduler.default_temperature.set"; payload: { temperature: number; sendTemperature: boolean } }
  // OAuth events
  | { type: "oauth.login"; payload: { provider: string; method?: 'browser' | 'device_code' | 'token'; token?: string } }
  | { type: "oauth.logout"; payload: { provider: string } }
  | { type: "oauth.status.get"; payload: { provider: string } };
