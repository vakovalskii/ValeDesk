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
  zaiApiKey?: string; // Optional Z.AI API key for web search
  webSearchProvider?: WebSearchProvider; // Web search provider: 'tavily' or 'zai'
  zaiApiUrl?: ZaiApiUrl; // Z.AI API URL variant: 'default' or 'coding'
  permissionMode?: 'default' | 'ask'; // Permission mode: 'default' = auto-execute, 'ask' = require confirmation
  enableMemory?: boolean; // Enable long-term memory tool
  enableZaiReader?: boolean; // Enable Z.AI Web Reader tool
  zaiReaderApiUrl?: ZaiReaderApiUrl; // Z.AI Reader API URL variant: 'default' or 'coding'
};

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
};

// Server -> Client events
export type ServerEvent =
  | { type: "stream.message"; payload: { sessionId: string; message: StreamMessage } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string } }
  | { type: "session.status"; payload: { sessionId: string; status: SessionStatus; title?: string; cwd?: string; error?: string } }
  | { type: "session.list"; payload: { sessions: SessionInfo[] } }
  | { type: "session.history"; payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[] } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown; explanation?: string } }
  | { type: "runner.error"; payload: { sessionId?: string; message: string } }
  | { type: "settings.loaded"; payload: { settings: ApiSettings | null } };

// Client -> Server events
export type ClientEvent =
  | { type: "session.start"; payload: { title: string; prompt: string; cwd?: string; allowedTools?: string } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string } }
  | { type: "session.stop"; payload: { sessionId: string } }
  | { type: "session.delete"; payload: { sessionId: string } }
  | { type: "session.pin"; payload: { sessionId: string; isPinned: boolean } }
  | { type: "session.update-cwd"; payload: { sessionId: string; cwd: string } }
  | { type: "session.list" }
  | { type: "session.history"; payload: { sessionId: string } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: PermissionResult } }
  | { type: "message.edit"; payload: { sessionId: string; messageIndex: number; newPrompt: string } }
  | { type: "settings.get" }
  | { type: "settings.save"; payload: { settings: ApiSettings } }
  | { type: "open.external"; payload: { url: string } };
