/**
 * In-memory session store for sidecar
 * Persistent data is stored in Rust/Tauri via rusqlite
 * This store only keeps runtime state
 */

import type { SessionStatus, StreamMessage, FileChange } from "../agent/types.js";

export type PendingPermission = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  resolve: (result: { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }) => void;
};

export type Session = {
  id: string;
  title: string;
  claudeSessionId?: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  model?: string;
  temperature?: number;
  threadId?: string;
  fileChanges?: FileChange[];
  pendingPermissions: Map<string, PendingPermission>;
  abortController?: AbortController;
  inputTokens?: number;
  outputTokens?: number;
};

export type StoredSession = {
  id: string;
  title: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  model?: string;
  threadId?: string;
  claudeSessionId?: string;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  fileChanges?: FileChange[];
};

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  createdAt?: number;
  updatedAt?: number;
};

export type SessionHistory = {
  session: StoredSession;
  messages: StreamMessage[];
  todos: TodoItem[];
  fileChanges?: FileChange[];
};

export type SyncCallback = (type: 'create' | 'update' | 'message' | 'todos', sessionId: string, data: any) => void;

/**
 * In-memory session store - no SQLite dependency
 * Used only for runtime state during LLM operations
 * Syncs changes to Rust DB via callback
 */
export class MemorySessionStore {
  private sessions = new Map<string, Session>();
  private messages = new Map<string, StreamMessage[]>();
  private todos = new Map<string, TodoItem[]>();
  private fileChanges = new Map<string, FileChange[]>();
  private syncCallback?: SyncCallback;

  setSyncCallback(callback: SyncCallback): void {
    this.syncCallback = callback;
  }

  createSession(options: { 
    cwd?: string; 
    allowedTools?: string; 
    prompt?: string; 
    title: string; 
    model?: string; 
    threadId?: string; 
    temperature?: number;
    id?: string; // Allow external ID
  }): Session {
    const id = options.id || crypto.randomUUID();
    const session: Session = {
      id,
      title: options.title,
      status: "idle",
      cwd: options.cwd,
      allowedTools: options.allowedTools,
      lastPrompt: options.prompt,
      model: options.model,
      temperature: options.temperature,
      threadId: options.threadId,
      pendingPermissions: new Map()
    };
    this.sessions.set(id, session);
    this.messages.set(id, []);
    this.todos.set(id, []);
    this.fileChanges.set(id, []);
    
    // Sync to Rust DB
    this.syncCallback?.('create', id, {
      title: session.title,
      cwd: session.cwd,
      allowedTools: session.allowedTools,
      model: session.model,
      threadId: session.threadId
    });
    
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(): StoredSession[] {
    const now = Date.now();
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      title: session.title,
      status: session.status,
      cwd: session.cwd,
      allowedTools: session.allowedTools,
      lastPrompt: session.lastPrompt,
      model: session.model,
      threadId: session.threadId,
      claudeSessionId: session.claudeSessionId,
      isPinned: false,
      createdAt: now,
      updatedAt: now,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      fileChanges: session.fileChanges
    }));
  }

  getSessionHistory(id: string): SessionHistory | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const now = Date.now();
    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        cwd: session.cwd,
        allowedTools: session.allowedTools,
        lastPrompt: session.lastPrompt,
        model: session.model,
        threadId: session.threadId,
        claudeSessionId: session.claudeSessionId,
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        fileChanges: session.fileChanges
      },
      messages: this.messages.get(id) || [],
      todos: this.todos.get(id) || [],
      fileChanges: this.fileChanges.get(id) || []
    };
  }

  saveTodos(sessionId: string, todos: TodoItem[]): void {
    this.todos.set(sessionId, todos);
    
    // Sync todos to Rust DB
    this.syncCallback?.('todos', sessionId, todos);
  }

  getTodos(sessionId: string): TodoItem[] {
    return this.todos.get(sessionId) || [];
  }

  saveFileChanges(sessionId: string, fileChanges: FileChange[]): void {
    this.fileChanges.set(sessionId, fileChanges);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.fileChanges = fileChanges;
    }
  }

  getFileChanges(sessionId: string): FileChange[] {
    return this.fileChanges.get(sessionId) || [];
  }

  addFileChanges(sessionId: string, newChanges: FileChange[]): void {
    const currentChanges = this.getFileChanges(sessionId);
    const changesMap = new Map<string, FileChange>();

    for (const change of currentChanges) {
      changesMap.set(change.path, change);
    }

    for (const newChange of newChanges) {
      const existing = changesMap.get(newChange.path);
      if (existing) {
        existing.additions += newChange.additions;
        existing.deletions += newChange.deletions;
      } else {
        changesMap.set(newChange.path, { ...newChange });
      }
    }

    this.saveFileChanges(sessionId, Array.from(changesMap.values()));
  }

  confirmFileChanges(sessionId: string): void {
    const changes = this.getFileChanges(sessionId);
    const confirmedChanges = changes.map(c => ({ ...c, status: 'confirmed' as const }));
    this.saveFileChanges(sessionId, confirmedChanges);
  }

  clearFileChanges(sessionId: string): void {
    this.saveFileChanges(sessionId, []);
  }

  updateSession(id: string, updates: Partial<Session>): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    
    Object.assign(session, updates);
    
    // Sync important updates to Rust DB
    const syncUpdates: Record<string, any> = {};
    if (updates.title !== undefined) syncUpdates.title = updates.title;
    if (updates.status !== undefined) syncUpdates.status = updates.status;
    if (updates.cwd !== undefined) syncUpdates.cwd = updates.cwd;
    if (updates.model !== undefined) syncUpdates.model = updates.model;
    if (updates.inputTokens !== undefined) syncUpdates.inputTokens = session.inputTokens;
    if (updates.outputTokens !== undefined) syncUpdates.outputTokens = session.outputTokens;
    
    if (Object.keys(syncUpdates).length > 0) {
      this.syncCallback?.('update', id, syncUpdates);
    }
    
    return session;
  }

  setAbortController(id: string, controller: AbortController | undefined): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.abortController = controller;
  }

  recordMessage(sessionId: string, message: StreamMessage): void {
    const messages = this.messages.get(sessionId) || [];
    messages.push(message);
    this.messages.set(sessionId, messages);
    
    // Sync message to Rust DB
    this.syncCallback?.('message', sessionId, message);
  }

  truncateHistoryAfter(sessionId: string, messageIndex: number): void {
    const messages = this.messages.get(sessionId) || [];
    this.messages.set(sessionId, messages.slice(0, messageIndex + 1));
  }

  updateMessageAt(sessionId: string, messageIndex: number, updates: Partial<StreamMessage>): void {
    const messages = this.messages.get(sessionId) || [];
    if (messageIndex < messages.length) {
      messages[messageIndex] = { ...messages[messageIndex], ...updates } as StreamMessage;
      this.messages.set(sessionId, messages);
    }
  }

  deleteSession(id: string): boolean {
    this.messages.delete(id);
    this.todos.delete(id);
    this.fileChanges.delete(id);
    return this.sessions.delete(id);
  }

  updateTokens(id: string, inputTokens: number, outputTokens: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.inputTokens = (session.inputTokens || 0) + inputTokens;
    session.outputTokens = (session.outputTokens || 0) + outputTokens;
  }

  listRecentCwds(_limit = 8): string[] {
    // In-memory store doesn't persist CWDs
    return [];
  }

  getThreads(_sessionId: string): Array<{ threadId: string; model: string; status: SessionStatus; createdAt: number; updatedAt: number }> {
    // Simplified - return empty for now
    return [];
  }

  // Compatibility methods
  setPinned(_id: string, _isPinned: boolean): void {
    // No-op in memory store
  }
}
