import Database from "better-sqlite3";
import type { SessionStatus, StreamMessage, FileChange } from "../types.js";

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
  threadId?: string; // Thread ID for multi-thread sessions
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
  threadId?: string; // Thread ID for multi-thread sessions
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

export type SessionHistoryPage = {
  session: StoredSession;
  messages: StreamMessage[];
  todos: TodoItem[];
  fileChanges?: FileChange[];
  nextCursor?: number;
  hasMore: boolean;
};

export class SessionStore {
  private sessions = new Map<string, Session>();
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
    this.loadSessions();
  }

  createSession(options: { cwd?: string; allowedTools?: string; prompt?: string; title: string; model?: string; threadId?: string; temperature?: number }): Session {
    const id = crypto.randomUUID();
    const now = Date.now();
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
    this.db
      .prepare(
        `insert into sessions
          (id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, model, thread_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        session.title,
        session.claudeSessionId ?? null,
        session.status,
        session.cwd ?? null,
        session.allowedTools ?? null,
        session.lastPrompt ?? null,
        session.model ?? null,
        session.threadId ?? null,
        now,
        now
      );
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(): StoredSession[] {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, model, thread_id, is_pinned, created_at, updated_at, input_tokens, output_tokens
         from sessions
         order by updated_at desc`
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: row.status as SessionStatus,
      cwd: row.cwd ? String(row.cwd) : undefined,
      allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
      lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
      model: row.model ? String(row.model) : undefined,
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      claudeSessionId: row.claude_session_id ? String(row.claude_session_id) : undefined,
      isPinned: row.is_pinned ? Boolean(row.is_pinned) : false,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      inputTokens: row.input_tokens ? Number(row.input_tokens) : undefined,
      outputTokens: row.output_tokens ? Number(row.output_tokens) : undefined
    }));
  }

  listRecentCwds(limit = 8): string[] {
    const rows = this.db
      .prepare(
        `select cwd, max(updated_at) as latest
         from sessions
         where cwd is not null and trim(cwd) != ''
         group by cwd
         order by latest desc
         limit ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.cwd));
  }

  getSessionHistory(id: string, threadId?: string): SessionHistory | null {
    const whereClause = threadId ? `where id = ? and thread_id = ?` : `where id = ?`;
    const params = threadId ? [id, threadId] : [id];

    const sessionRow = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, model, thread_id, is_pinned, created_at, updated_at, input_tokens, output_tokens, todos, file_changes
         from sessions
         ${whereClause}`
      )
      .get(...params) as Record<string, unknown> | undefined;
    if (!sessionRow) return null;

    const messages = (this.db
      .prepare(
        `select data from messages where session_id = ? order by created_at asc`
      )
      .all(id) as Array<Record<string, unknown>>)
      .map((row) => JSON.parse(String(row.data)) as StreamMessage);

    // Parse todos from JSON
    let todos: TodoItem[] = [];
    if (sessionRow.todos) {
      try {
        todos = JSON.parse(String(sessionRow.todos)) as TodoItem[];
      } catch (e) {
        console.error('Failed to parse todos:', e);
      }
    }

    // Parse fileChanges from JSON
    let fileChanges: FileChange[] = [];
    if (sessionRow.file_changes) {
      try {
        fileChanges = JSON.parse(String(sessionRow.file_changes)) as FileChange[];
      } catch (e) {
        console.error('Failed to parse fileChanges:', e);
      }
    }

    return {
      session: {
        id: String(sessionRow.id),
        title: String(sessionRow.title),
        status: sessionRow.status as SessionStatus,
        cwd: sessionRow.cwd ? String(sessionRow.cwd) : undefined,
        allowedTools: sessionRow.allowed_tools ? String(sessionRow.allowed_tools) : undefined,
        lastPrompt: sessionRow.last_prompt ? String(sessionRow.last_prompt) : undefined,
        model: sessionRow.model ? String(sessionRow.model) : undefined,
        threadId: sessionRow.thread_id ? String(sessionRow.thread_id) : undefined,
        claudeSessionId: sessionRow.claude_session_id ? String(sessionRow.claude_session_id) : undefined,
        isPinned: sessionRow.is_pinned ? Boolean(sessionRow.is_pinned) : false,
        createdAt: Number(sessionRow.created_at),
        updatedAt: Number(sessionRow.updated_at),
        inputTokens: sessionRow.input_tokens ? Number(sessionRow.input_tokens) : undefined,
        outputTokens: sessionRow.output_tokens ? Number(sessionRow.output_tokens) : undefined,
        fileChanges
      },
      messages,
      todos,
      fileChanges
    };
  }

  getSessionHistoryPage(id: string, limit: number, beforeCreatedAt?: number): SessionHistoryPage | null {
    const sessionRow = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, model, thread_id, is_pinned, created_at, updated_at, input_tokens, output_tokens, todos, file_changes
         from sessions
         where id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!sessionRow) return null;

    const messageRows = (this.db
      .prepare(
        beforeCreatedAt
          ? `select data, created_at from messages where session_id = ? and created_at < ? order by created_at desc limit ?`
          : `select data, created_at from messages where session_id = ? order by created_at desc limit ?`
      )
      .all(
        ...(beforeCreatedAt ? [id, beforeCreatedAt, limit] : [id, limit])
      ) as Array<Record<string, unknown>>);

    const messagesDesc = messageRows.map((row) => ({
      data: JSON.parse(String(row.data)) as StreamMessage,
      createdAt: Number(row.created_at)
    }));

    const messages = messagesDesc.map((row) => row.data).reverse();
    const oldestCreatedAt = messagesDesc.length > 0 ? messagesDesc[messagesDesc.length - 1].createdAt : undefined;

    let hasMore = false;
    if (oldestCreatedAt !== undefined) {
      const countRow = this.db
        .prepare(`select count(1) as count from messages where session_id = ? and created_at < ?`)
        .get(id, oldestCreatedAt) as { count?: number } | undefined;
      hasMore = Number(countRow?.count || 0) > 0;
    }

    // Parse todos from JSON
    let todos: TodoItem[] = [];
    if (sessionRow.todos) {
      try {
        todos = JSON.parse(String(sessionRow.todos)) as TodoItem[];
      } catch (e) {
        console.error('Failed to parse todos:', e);
      }
    }

    // Parse fileChanges from JSON
    let fileChanges: FileChange[] = [];
    if (sessionRow.file_changes) {
      try {
        fileChanges = JSON.parse(String(sessionRow.file_changes)) as FileChange[];
      } catch (e) {
        console.error('Failed to parse fileChanges:', e);
      }
    }

    return {
      session: {
        id: String(sessionRow.id),
        title: String(sessionRow.title),
        status: sessionRow.status as SessionStatus,
        cwd: sessionRow.cwd ? String(sessionRow.cwd) : undefined,
        allowedTools: sessionRow.allowed_tools ? String(sessionRow.allowed_tools) : undefined,
        lastPrompt: sessionRow.last_prompt ? String(sessionRow.last_prompt) : undefined,
        model: sessionRow.model ? String(sessionRow.model) : undefined,
        threadId: sessionRow.thread_id ? String(sessionRow.thread_id) : undefined,
        claudeSessionId: sessionRow.claude_session_id ? String(sessionRow.claude_session_id) : undefined,
        isPinned: sessionRow.is_pinned ? Boolean(sessionRow.is_pinned) : false,
        createdAt: Number(sessionRow.created_at),
        updatedAt: Number(sessionRow.updated_at),
        inputTokens: sessionRow.input_tokens ? Number(sessionRow.input_tokens) : undefined,
        outputTokens: sessionRow.output_tokens ? Number(sessionRow.output_tokens) : undefined,
        fileChanges
      },
      messages,
      todos,
      fileChanges,
      nextCursor: oldestCreatedAt,
      hasMore
    };
  }

  /**
   * Get all threads for a session (by session ID without threadId)
   * Returns an array of threads grouped by a common session ID
   */
  getThreads(sessionId: string): Array<{ threadId: string; model: string; status: SessionStatus; createdAt: number; updatedAt: number }> {
    // For now, sessions with thread_id are considered threads of a "parent" session
    // The parent session has thread_id = null or undefined
    const rows = this.db
      .prepare(
        `select id as thread_id, model, status, created_at, updated_at
         from sessions
         where id = ? or id like ? || '-%'
         order by created_at asc`
      )
      .all(sessionId, sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      threadId: String(row.thread_id),
      model: row.model ? String(row.model) : 'unknown',
      status: row.status as SessionStatus,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    }));
  }

  saveTodos(sessionId: string, todos: TodoItem[]): void {
    this.db
      .prepare(`update sessions set todos = ?, updated_at = ? where id = ?`)
      .run(JSON.stringify(todos), Date.now(), sessionId);
  }

  getTodos(sessionId: string): TodoItem[] {
    const row = this.db
      .prepare(`select todos from sessions where id = ?`)
      .get(sessionId) as { todos: string | null } | undefined;
    if (!row?.todos) return [];
    try {
      return JSON.parse(row.todos) as TodoItem[];
    } catch {
      return [];
    }
  }

  saveFileChanges(sessionId: string, fileChanges: FileChange[]): void {
    this.db
      .prepare(`update sessions set file_changes = ?, updated_at = ? where id = ?`)
      .run(JSON.stringify(fileChanges), Date.now(), sessionId);
  }

  getFileChanges(sessionId: string): FileChange[] {
    const row = this.db
      .prepare(`select file_changes from sessions where id = ?`)
      .get(sessionId) as { file_changes: string | null } | undefined;
    if (!row?.file_changes) return [];
    try {
      return JSON.parse(row.file_changes) as FileChange[];
    } catch {
      return [];
    }
  }

  addFileChanges(sessionId: string, newChanges: FileChange[]): void {
    const currentChanges = this.getFileChanges(sessionId);
    const changesMap = new Map<string, FileChange>();

    // Add current changes to map
    for (const change of currentChanges) {
      changesMap.set(change.path, change);
    }

    // Add/update new changes
    for (const newChange of newChanges) {
      const existing = changesMap.get(newChange.path);
      if (existing) {
        // Update stats
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
    this.persistSession(id, updates);
    return session;
  }

  setAbortController(id: string, controller: AbortController | undefined): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.abortController = controller;
  }

  recordMessage(sessionId: string, message: StreamMessage): void {
    const id = ('uuid' in message && message.uuid) ? String(message.uuid) : crypto.randomUUID();
    this.db
      .prepare(
        `insert or ignore into messages (id, session_id, data, created_at) values (?, ?, ?, ?)`
      )
      .run(id, sessionId, JSON.stringify(message), Date.now());
  }

  truncateHistoryAfter(sessionId: string, messageIndex: number): void {
    // Get all messages for this session
    const rows = this.db
      .prepare(`select id, data, created_at from messages where session_id = ? order by created_at asc`)
      .all(sessionId) as Array<{ id: string; data: string; created_at: number }>;
    
    // Keep only messages up to and including messageIndex
    const messagesToKeep = rows.slice(0, messageIndex + 1);
    const idsToKeep = messagesToKeep.map(r => r.id);
    
    // Delete all messages after messageIndex
    if (idsToKeep.length > 0) {
      const placeholders = idsToKeep.map(() => '?').join(',');
      this.db
        .prepare(`delete from messages where session_id = ? and id not in (${placeholders})`)
        .run(sessionId, ...idsToKeep);
    } else {
      // If no messages to keep, delete all
      this.db.prepare(`delete from messages where session_id = ?`).run(sessionId);
    }
  }

  updateMessageAt(sessionId: string, messageIndex: number, updates: Partial<StreamMessage>): void {
    // Get all messages for this session
    const rows = this.db
      .prepare(`select id, data from messages where session_id = ? order by created_at asc`)
      .all(sessionId) as Array<{ id: string; data: string }>;
    
    if (messageIndex >= rows.length) {
      console.warn(`Message index ${messageIndex} out of bounds for session ${sessionId}`);
      return;
    }
    
    const targetRow = rows[messageIndex];
    const message = JSON.parse(targetRow.data) as StreamMessage;
    
    // Update the message with new data
    const updatedMessage = { ...message, ...updates };
    
    // Save back to database
    this.db
      .prepare(`update messages set data = ? where id = ?`)
      .run(JSON.stringify(updatedMessage), targetRow.id);
  }

  deleteSession(id: string): boolean {
    const existing = this.sessions.get(id);
    if (existing) {
      this.sessions.delete(id);
    }
    this.db.prepare(`delete from messages where session_id = ?`).run(id);
    const result = this.db.prepare(`delete from sessions where id = ?`).run(id);
    const removedFromDb = result.changes > 0;
    return removedFromDb || Boolean(existing);
  }

  setPinned(id: string, isPinned: boolean): void {
    this.db
      .prepare(`update sessions set is_pinned = ?, updated_at = ? where id = ?`)
      .run(isPinned ? 1 : 0, Date.now(), id);
  }

  updateTokens(id: string, inputTokens: number, outputTokens: number): void {
    // Сначала получаем текущие значения токенов из базы
    const current = this.db
      .prepare(`select input_tokens, output_tokens from sessions where id = ?`)
      .get(id) as { input_tokens: number | null; output_tokens: number | null } | undefined;

    const currentInput = current?.input_tokens ?? 0;
    const currentOutput = current?.output_tokens ?? 0;

    // Прибавляем новые токены к текущим значениям
    this.db
      .prepare(`update sessions set input_tokens = ?, output_tokens = ?, updated_at = ? where id = ?`)
      .run(currentInput + inputTokens, currentOutput + outputTokens, Date.now(), id);
  }

  private persistSession(id: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const updatable = {
      title: "title",
      claudeSessionId: "claude_session_id",
      status: "status",
      cwd: "cwd",
      allowedTools: "allowed_tools",
      lastPrompt: "last_prompt",
      model: "model",
      threadId: "thread_id"
    } as const;

    for (const key of Object.keys(updates) as Array<keyof typeof updatable>) {
      const column = updatable[key];
      if (!column) continue;
      fields.push(`${column} = ?`);
      const value = updates[key];
      values.push(value === undefined ? null : (value as string));
    }

    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    this.db
      .prepare(`update sessions set ${fields.join(", ")} where id = ?`)
      .run(...values);
  }

  private initialize(): void {
    this.db.exec(`pragma journal_mode = WAL;`);
    this.db.exec(
      `create table if not exists sessions (
        id text primary key,
        title text,
        claude_session_id text,
        status text not null,
        cwd text,
        allowed_tools text,
        last_prompt text,
        is_pinned integer default 0,
        created_at integer not null,
        updated_at integer not null,
        input_tokens integer default 0,
        output_tokens integer default 0,
        todos text,
        model text,
        thread_id text
      )`
    );
    this.db.exec(
      `create table if not exists messages (
        id text primary key,
        session_id text not null,
        data text not null,
        created_at integer not null,
        foreign key (session_id) references sessions(id)
      )`
    );
    this.db.exec(`create index if not exists messages_session_id on messages(session_id)`);

    // Migration: Add is_pinned column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column is_pinned integer default 0`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Migration: Add input_tokens column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column input_tokens integer default 0`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Migration: Add output_tokens column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column output_tokens integer default 0`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Migration: Add todos column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column todos text`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Create scheduled_tasks table
    this.db.exec(
      `create table if not exists scheduled_tasks (
        id text primary key,
        title text not null,
        prompt text,
        schedule text not null,
        next_run integer not null,
        is_recurring integer default 0,
        notify_before integer,
        enabled integer default 1,
        created_at integer not null,
        updated_at integer not null
      )`
    );
    this.db.exec(`create index if not exists scheduled_tasks_next_run on scheduled_tasks(next_run)`);
    this.db.exec(`create index if not exists scheduled_tasks_enabled on scheduled_tasks(enabled)`);

    // Migration: Add model column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column model text`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Migration: Add file_changes column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column file_changes text`);
    } catch (e) {
      // Column already exists, ignore
    }

    // Migration: Add thread_id column if it doesn't exist
    try {
      this.db.exec(`alter table sessions add column thread_id text`);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  private loadSessions(): void {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, model, thread_id
         from sessions`
      )
      .all();
    for (const row of rows as Array<Record<string, unknown>>) {
      const session: Session = {
        id: String(row.id),
        title: String(row.title),
        claudeSessionId: row.claude_session_id ? String(row.claude_session_id) : undefined,
        status: row.status as SessionStatus,
        cwd: row.cwd ? String(row.cwd) : undefined,
        allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
        lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
        model: row.model ? String(row.model) : undefined,
        threadId: row.thread_id ? String(row.thread_id) : undefined,
        pendingPermissions: new Map()
      };
      this.sessions.set(session.id, session);
    }
  }
}
