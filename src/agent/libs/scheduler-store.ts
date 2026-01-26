import Database from "better-sqlite3";

export type ScheduledTask = {
  id: string;
  title: string;
  prompt?: string;
  schedule: string;
  nextRun: number;
  isRecurring: boolean;
  notifyBefore?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export class SchedulerStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createTask(task: Omit<ScheduledTask, 'createdAt' | 'updatedAt'>): ScheduledTask {
    const now = Date.now();
    this.db
      .prepare(
        `insert into scheduled_tasks
          (id, title, prompt, schedule, next_run, is_recurring, notify_before, enabled, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.title,
        task.prompt ?? null,
        task.schedule,
        task.nextRun,
        task.isRecurring ? 1 : 0,
        task.notifyBefore ?? null,
        task.enabled ? 1 : 0,
        now,
        now
      );

    return { ...task, createdAt: now, updatedAt: now };
  }

  getTask(id: string): ScheduledTask | null {
    const row = this.db
      .prepare(
        `select id, title, prompt, schedule, next_run, is_recurring, notify_before, enabled, created_at, updated_at
         from scheduled_tasks
         where id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToTask(row);
  }

  listTasks(includeDisabled = true): ScheduledTask[] {
    const query = includeDisabled
      ? `select * from scheduled_tasks order by next_run asc`
      : `select * from scheduled_tasks where enabled = 1 order by next_run asc`;

    const rows = this.db.prepare(query).all() as Array<Record<string, unknown>>;
    return rows.map(row => this.rowToTask(row));
  }

  getTasksDueNow(now: number): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `select * from scheduled_tasks
         where enabled = 1 and next_run <= ?
         order by next_run asc`
      )
      .all(now) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToTask(row));
  }

  getTasksForNotification(now: number): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `select * from scheduled_tasks
         where enabled = 1 
         and notify_before is not null 
         and next_run <= ?
         and next_run > ?
         order by next_run asc`
      )
      .all(now, now - 60 * 1000) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToTask(row));
  }

  updateTask(
    id: string,
    updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>>
  ): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.prompt !== undefined) {
      fields.push('prompt = ?');
      values.push(updates.prompt ?? null);
    }
    if (updates.schedule !== undefined) {
      fields.push('schedule = ?');
      values.push(updates.schedule);
    }
    if (updates.nextRun !== undefined) {
      fields.push('next_run = ?');
      values.push(updates.nextRun);
    }
    if (updates.isRecurring !== undefined) {
      fields.push('is_recurring = ?');
      values.push(updates.isRecurring ? 1 : 0);
    }
    if (updates.notifyBefore !== undefined) {
      fields.push('notify_before = ?');
      values.push(updates.notifyBefore ?? null);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    const result = this.db
      .prepare(
        `update scheduled_tasks set ${fields.join(', ')} where id = ?`
      )
      .run(...values);

    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const result = this.db
      .prepare(`delete from scheduled_tasks where id = ?`)
      .run(id);

    return result.changes > 0;
  }

  private rowToTask(row: Record<string, unknown>): ScheduledTask {
    return {
      id: String(row.id),
      title: String(row.title),
      prompt: row.prompt ? String(row.prompt) : undefined,
      schedule: String(row.schedule),
      nextRun: Number(row.next_run),
      isRecurring: Boolean(row.is_recurring),
      notifyBefore: row.notify_before ? Number(row.notify_before) : undefined,
      enabled: Boolean(row.enabled),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }
}
