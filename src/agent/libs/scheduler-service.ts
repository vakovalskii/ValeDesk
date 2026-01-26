
import type { SchedulerStore, ScheduledTask } from './scheduler-store.js';

export type SchedulerCallback = (task: ScheduledTask) => Promise<void>;

/**
 * SchedulerService manages the execution of scheduled tasks
 * It checks for due tasks every minute and executes them
 */
export class SchedulerService {
  private schedulerStore: SchedulerStore;
  private intervalId: NodeJS.Timeout | null = null;
  private onTaskExecute: SchedulerCallback;
  private notifiedTasks = new Set<string>(); // Track tasks that have been notified

  constructor(schedulerStore: SchedulerStore, onTaskExecute: SchedulerCallback) {
    this.schedulerStore = schedulerStore;
    this.onTaskExecute = onTaskExecute;
  }

  /**
   * Start the scheduler service
   * Checks for due tasks every 30 seconds
   */
  start() {
    if (this.intervalId) {
      console.log('[Scheduler] Already running');
      return;
    }

    console.log('[Scheduler] Starting scheduler service');

    // Check immediately
    this.checkTasks();

    // Then check every 30 seconds
    this.intervalId = setInterval(() => {
      this.checkTasks();
    }, 30 * 1000);
  }

  /**
   * Stop the scheduler service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Scheduler] Stopped scheduler service');
    }
  }

  /**
   * Check for due tasks and execute them
   */
  private async checkTasks() {
    const now = Date.now();

    // Check for tasks that need notifications
    await this.checkNotifications(now);

    // Check for tasks due to execute
    const dueTasks = this.schedulerStore.getTasksDueNow(now);

    if (dueTasks.length > 0) {
      console.log(`[Scheduler] Found ${dueTasks.length} due tasks`);
    }

    for (const task of dueTasks) {
      await this.executeTask(task);
    }
  }

  /**
   * Check for tasks that need pre-execution notifications
   */
  private async checkNotifications(now: number) {
    const allTasks = this.schedulerStore.listTasks(false); // Only enabled tasks

    for (const task of allTasks) {
      if (task.notifyBefore && !this.notifiedTasks.has(task.id)) {
        const notifyTime = task.nextRun - (task.notifyBefore * 60 * 1000);

        // If current time is past notify time but before execution time
        if (now >= notifyTime && now < task.nextRun) {
          this.sendNotification(
            `Upcoming Task: ${task.title}`,
            `Task will execute in ${task.notifyBefore} minutes`
          );
          this.notifiedTasks.add(task.id);
        }
      }
    }
  }

  /**
   * Execute a scheduled task
   */
  private async executeTask(task: ScheduledTask) {
    console.log(`[Scheduler] Executing task: ${task.title} (${task.id})`);

    try {
      // Show single reminder notification
      this.sendNotification(
        'Reminder',
        task.title
      );

      // Execute the task callback if there's a prompt (silently, no extra notifications)
      if (task.prompt) {
        await this.onTaskExecute(task);
      }

      // Remove from notified set
      this.notifiedTasks.delete(task.id);

      // Update next run time if recurring
      if (task.isRecurring) {
        const nextRun = this.calculateNextRun(task.schedule, Date.now());
        if (nextRun) {
          this.schedulerStore.updateTask(task.id, { nextRun });
          console.log(`[Scheduler] Rescheduled recurring task ${task.id} for ${new Date(nextRun).toLocaleString()}`);
        } else {
          console.error(`[Scheduler] Failed to reschedule recurring task ${task.id}`);
        }
      } else {
        // One-time task, disable it
        this.schedulerStore.updateTask(task.id, { enabled: false });
        console.log(`[Scheduler] Disabled one-time task ${task.id}`);
      }
    } catch (error) {
      console.error(`[Scheduler] Error executing task ${task.id}:`, error);
      this.sendNotification(
        'Error',
        `Failed to execute: ${task.title}`
      );
    }
  }

  /**
   * Send a desktop notification
   */
  /**
   * Send a desktop notification
   */
  private sendNotification(title: string, body: string) {
    try {
      // In sidecar mode, we don't have access to Electron Notification
      // Use console log for now (will appear in sidecar output)
      console.log(`[Notification] ${title}: ${body}`);

      // TODO: Send event to UI so it can show a notification
    } catch (error) {
      console.error('[Scheduler] Failed to send notification:', error);
    }
  }

  /**
   * Calculate the next run time for a recurring task
   */
  private calculateNextRun(schedule: string, from: number): number | null {
    // Repeating intervals
    const everyMatch = schedule.match(/^every (\d+)([mhd])$/);
    if (everyMatch) {
      const [, amount, unit] = everyMatch;
      const multiplier = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
      return from + parseInt(amount) * multiplier[unit as keyof typeof multiplier];
    }

    // Daily at specific time
    const dailyMatch = schedule.match(/^daily (\d{2}):(\d{2})$/);
    if (dailyMatch) {
      const [, hours, minutes] = dailyMatch;
      const target = new Date(from);
      target.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      // If the time has passed today, schedule for tomorrow
      if (target.getTime() <= from) {
        target.setDate(target.getDate() + 1);
      }

      return target.getTime();
    }

    return null;
  }
}
