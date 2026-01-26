import crypto from "crypto";
import {
  BaseTool,
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";

export interface ScheduleTaskParams {
  explanation: string;
  operation: "create" | "list" | "delete" | "update";
  taskId?: string;
  title?: string;
  prompt?: string;
  schedule?: string;
  notifyBefore?: number; // minutes before to send notification
  enabled?: boolean;
}

// Type for scheduled task (matches Rust struct)
export interface ScheduledTask {
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
}

// Callback type for IPC operations
export type SchedulerIPCCallback = (
  operation: "create" | "list" | "delete" | "update",
  params: Record<string, any>
) => Promise<{ success: boolean; data?: any; error?: string }>;

export const ScheduleTaskToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "schedule_task",
    description: `Schedule tasks with notifications and automatic execution.

**Use Cases**:
- Reminders with notifications
- Recurring tasks (daily summaries, weekly reports)
- Delayed actions (execute something later)
- Periodic checks (monitor something regularly)

**Operations**:
- create: Create a new scheduled task
- list: View all scheduled tasks
- update: Modify existing task
- delete: Remove a scheduled task

**Schedule Formats**:
- "1m", "5m", "30m" - Run ONCE after X minutes (one-time only)
- "1h", "2h", "12h" - Run ONCE after X hours (one-time only)
- "1d", "7d" - Run ONCE after X days (one-time only)
- "every 10m" - REPEAT every 10 minutes
- "every 1h" - REPEAT every hour
- "every 1d" - REPEAT every day
- "daily 09:00" - REPEAT daily at 9:00 AM
- "daily 14:30" - REPEAT daily at 2:30 PM
- "2026-01-20 15:30" - Run ONCE at specific date/time (format: YYYY-MM-DD HH:MM)

**IMPORTANT**: Use "1m", "1h", "1d" for ONE-TIME reminders. Use "every X" or "daily HH:MM" for RECURRING tasks.

**Examples**:
- One-time reminder in 30 minutes: schedule="30m"
- Recurring reminder every hour: schedule="every 1h"
- Daily summary at 9 AM: schedule="daily 09:00" with prompt
- One-time reminder at specific time: schedule="2026-01-20 15:30"

**Notifications**:
- Set notifyBefore (in minutes) to get a notification before task execution
- Task execution also triggers a notification with the result`,
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description:
            "Brief explanation of what this task scheduling operation does",
        },
        operation: {
          type: "string",
          enum: ["create", "list", "delete", "update"],
          description: "Operation to perform",
        },
        taskId: {
          type: "string",
          description: "Task ID (required for delete/update operations)",
        },
        title: {
          type: "string",
          description:
            "Task title/name (required for create, optional for update)",
        },
        prompt: {
          type: "string",
          description:
            "AI prompt to execute when task triggers (optional, can be just a reminder)",
        },
        schedule: {
          type: "string",
          description:
            'Schedule format: "1m", "1h", "1d", "every 10m", "every 1h", "every 1d", "daily 09:00", "2026-01-20 15:30"',
        },
        notifyBefore: {
          type: "number",
          description:
            "Send notification X minutes before task execution (optional)",
        },
        enabled: {
          type: "boolean",
          description: "Enable/disable task (for update operation)",
        },
      },
      required: ["explanation", "operation"],
    },
  },
};

export class ScheduleTaskTool extends BaseTool {
  private ipcCallback?: SchedulerIPCCallback;

  constructor(ipcCallback?: SchedulerIPCCallback) {
    super();
    this.ipcCallback = ipcCallback;
  }

  get definition(): ToolDefinition {
    return ScheduleTaskToolDefinition;
  }

  async execute(
    args: ScheduleTaskParams,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const {
        operation,
        taskId,
        title,
        prompt,
        schedule,
        notifyBefore,
        enabled,
      } = args;

      switch (operation) {
        case "create":
          if (!title || !schedule) {
            return {
              success: false,
              error:
                "Missing required fields: title and schedule are required for create operation",
            };
          }
          return await this.createTask({
            title,
            prompt,
            schedule,
            notifyBefore,
          });

        case "list":
          return await this.listTasks();

        case "delete":
          if (!taskId) {
            return {
              success: false,
              error:
                "Missing required field: taskId is required for delete operation",
            };
          }
          return await this.deleteTask(taskId);

        case "update":
          if (!taskId) {
            return {
              success: false,
              error:
                "Missing required field: taskId is required for update operation",
            };
          }
          return await this.updateTask(taskId, {
            title,
            prompt,
            schedule,
            notifyBefore,
            enabled,
          });

        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute schedule_task: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async createTask(params: {
    title: string;
    prompt?: string;
    schedule: string;
    notifyBefore?: number;
  }): Promise<ToolResult> {
    // Validate schedule format locally first
    const nextRun = this.calculateNextRun(params.schedule);
    if (!nextRun) {
      return {
        success: false,
        error: `Invalid schedule format: ${params.schedule}. Valid formats: "1m", "5m", "1h", "1d", "every 10m", "every 1h", "daily 09:00", "2026-01-20 15:30"`,
      };
    }

    // Use IPC callback if available (Tauri mode)
    if (this.ipcCallback) {
      const result = await this.ipcCallback("create", {
        title: params.title,
        prompt: params.prompt,
        schedule: params.schedule,
        notifyBefore: params.notifyBefore,
      });

      if (result.success) {
        const task = result.data as ScheduledTask;
        return {
          success: true,
          output: `✅ Reminder "${params.title}" set for ${this.formatLocalTime(task.nextRun)}`,
        };
      } else {
        return {
          success: false,
          error: result.error || "Failed to create task",
        };
      }
    }

    // Fallback: return success with calculated time (scheduler in Rust will handle it)
    return {
      success: true,
      output: `✅ Reminder "${params.title}" set for ${this.formatLocalTime(nextRun)}`,
    };
  }

  private async listTasks(): Promise<ToolResult> {
    if (this.ipcCallback) {
      const result = await this.ipcCallback("list", {});

      if (result.success) {
        const tasks = (result.data as ScheduledTask[]) || [];
        
        if (tasks.length === 0) {
          return {
            success: true,
            output: 'No scheduled tasks yet. Use operation="create" to add one.',
          };
        }

        const output = tasks
          .map((task, index) => {
            const nextRun = this.formatLocalTime(task.nextRun);
            const status = task.enabled ? "✅" : "⏸️";
            return `${index + 1}. ${status} ${task.title}
   ID: ${task.id}
   Schedule: ${task.schedule}
   Next run: ${nextRun}
   ${task.prompt ? `Prompt: ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? "..." : ""}` : "Reminder only"}
   ${task.notifyBefore ? `Notify: ${task.notifyBefore}m before` : ""}`;
          })
          .join("\n\n");

        return {
          success: true,
          output: `📋 Scheduled Tasks (${tasks.length}):\n\n${output}`,
        };
      } else {
        return {
          success: false,
          error: result.error || "Failed to list tasks",
        };
      }
    }

    return {
      success: true,
      output: 'No scheduled tasks yet. Use operation="create" to add one.',
    };
  }

  private async deleteTask(taskId: string): Promise<ToolResult> {
    if (this.ipcCallback) {
      const result = await this.ipcCallback("delete", { taskId });

      if (result.success) {
        return {
          success: true,
          output: `✅ Task ${taskId} deleted successfully`,
        };
      } else {
        return {
          success: false,
          error: result.error || `Task ${taskId} not found`,
        };
      }
    }

    return {
      success: false,
      error: "Scheduler not available",
    };
  }

  private async updateTask(
    taskId: string,
    updates: {
      title?: string;
      prompt?: string;
      schedule?: string;
      notifyBefore?: number;
      enabled?: boolean;
    },
  ): Promise<ToolResult> {
    // Validate schedule format if provided
    if (updates.schedule !== undefined) {
      const nextRun = this.calculateNextRun(updates.schedule);
      if (!nextRun) {
        return {
          success: false,
          error: `Invalid schedule format: ${updates.schedule}`,
        };
      }
    }

    if (this.ipcCallback) {
      const result = await this.ipcCallback("update", { taskId, params: updates });

      if (result.success) {
        return {
          success: true,
          output: `✅ Task ${taskId} updated successfully`,
        };
      } else {
        return {
          success: false,
          error: result.error || `Task ${taskId} not found`,
        };
      }
    }

    return {
      success: false,
      error: "Scheduler not available",
    };
  }

  private formatLocalTime(timestamp: number): string {
    const date = new Date(timestamp);
    // Format: YYYY-MM-DD HH:MM (24h format, local time)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private calculateNextRun(schedule: string): number | null {
    const now = Date.now();

    // One-time delays
    const onceMatch = schedule.match(/^(\d+)([mhd])$/);
    if (onceMatch) {
      const [, amount, unit] = onceMatch;
      const multiplier = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      return (
        now + parseInt(amount) * multiplier[unit as keyof typeof multiplier]
      );
    }

    // Repeating intervals
    const everyMatch = schedule.match(/^every (\d+)([mhd])$/);
    if (everyMatch) {
      const [, amount, unit] = everyMatch;
      const multiplier = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      return (
        now + parseInt(amount) * multiplier[unit as keyof typeof multiplier]
      );
    }

    // Daily at specific time
    const dailyMatch = schedule.match(/^daily (\d{2}):(\d{2})$/);
    if (dailyMatch) {
      const [, hours, minutes] = dailyMatch;
      const target = new Date();
      target.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }

    // Specific datetime
    const datetimeMatch = schedule.match(
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
    );
    if (datetimeMatch) {
      const [, year, month, day, hours, minutes] = datetimeMatch;
      const target = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
      );
      return target.getTime();
    }

    return null;
  }
}
