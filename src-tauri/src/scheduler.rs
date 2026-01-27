use crate::db::{Database, ScheduledTask, UpdateScheduledTaskParams};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use serde_json::json;
use regex::Regex;
use chrono::{Local, NaiveTime, TimeZone};

pub struct SchedulerService {
    db: Arc<Database>,
    running: Arc<Mutex<bool>>,
    notified_tasks: Arc<Mutex<HashSet<String>>>,
}

impl SchedulerService {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            running: Arc::new(Mutex::new(false)),
            notified_tasks: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Start the scheduler service in a background thread
    pub fn start(&self, app: AppHandle) {
        let mut running = self.running.lock().unwrap();
        if *running {
            eprintln!("[Scheduler] Already running");
            return;
        }
        *running = true;
        drop(running);

        let db = self.db.clone();
        let running_flag = self.running.clone();
        let notified_tasks = self.notified_tasks.clone();

        thread::spawn(move || {
            eprintln!("[Scheduler] Started scheduler service");
            
            // Wait for UI to be ready before first check
            thread::sleep(Duration::from_secs(3));
            
            // Check immediately after delay
            check_tasks(&db, &app, &notified_tasks);
            
            // Then check every 30 seconds
            loop {
                thread::sleep(Duration::from_secs(30));
                
                let is_running = *running_flag.lock().unwrap();
                if !is_running {
                    eprintln!("[Scheduler] Stopped scheduler service");
                    break;
                }
                
                check_tasks(&db, &app, &notified_tasks);
            }
        });
    }

    /// Stop the scheduler service
    pub fn stop(&self) {
        let mut running = self.running.lock().unwrap();
        *running = false;
    }
}

fn check_tasks(db: &Arc<Database>, app: &AppHandle, notified_tasks: &Arc<Mutex<HashSet<String>>>) {
    let now = chrono::Utc::now().timestamp_millis();
    
    // Check for tasks that need notifications
    check_notifications(db, app, notified_tasks, now);
    
    // Check for tasks due to execute
    match db.get_tasks_due_now(now) {
        Ok(due_tasks) => {
            if !due_tasks.is_empty() {
                eprintln!("[Scheduler] Found {} due tasks", due_tasks.len());
            }
            
            for task in due_tasks {
                execute_task(db, app, notified_tasks, &task, now);
            }
        }
        Err(e) => {
            eprintln!("[Scheduler] Error getting due tasks: {}", e);
        }
    }
}

fn check_notifications(db: &Arc<Database>, app: &AppHandle, notified_tasks: &Arc<Mutex<HashSet<String>>>, now: i64) {
    match db.list_scheduled_tasks(false) {
        Ok(tasks) => {
            let mut notified = notified_tasks.lock().unwrap();
            
            for task in tasks {
                if let Some(notify_before) = task.notify_before {
                    if !notified.contains(&task.id) {
                        let notify_time = task.next_run - (notify_before * 60 * 1000);
                        
                        // If current time is past notify time but before execution time
                        if now >= notify_time && now < task.next_run {
                            send_notification(
                                app,
                                &format!("Upcoming Task: {}", task.title),
                                &format!("Task will execute in {} minutes", notify_before),
                            );
                            notified.insert(task.id.clone());
                        }
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("[Scheduler] Error listing tasks for notifications: {}", e);
        }
    }
}

fn execute_task(db: &Arc<Database>, app: &AppHandle, notified_tasks: &Arc<Mutex<HashSet<String>>>, task: &ScheduledTask, now: i64) {
    eprintln!("[Scheduler] Executing task: {} ({})", task.title, task.id);
    
    // Show reminder notification
    send_notification(app, "Reminder", &task.title);
    
    // Emit task execution event to frontend (for prompt execution if needed)
    if task.prompt.is_some() {
        if let Err(e) = emit_task_execute(app, task) {
            eprintln!("[Scheduler] Error emitting task execute event: {}", e);
        }
    }
    
    // Remove from notified set
    {
        let mut notified = notified_tasks.lock().unwrap();
        notified.remove(&task.id);
    }
    
    // Update next run time if recurring, otherwise disable
    if task.is_recurring {
        if let Some(next_run) = calculate_next_run(&task.schedule, now) {
            let params = UpdateScheduledTaskParams {
                next_run: Some(next_run),
                ..Default::default()
            };
            if let Err(e) = db.update_scheduled_task(&task.id, &params) {
                eprintln!("[Scheduler] Error rescheduling task {}: {}", task.id, e);
            } else {
                eprintln!("[Scheduler] Rescheduled recurring task {} for {}", task.id, 
                    chrono::DateTime::from_timestamp_millis(next_run)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_default());
            }
        } else {
            eprintln!("[Scheduler] Failed to calculate next run for recurring task {}", task.id);
        }
    } else {
        // One-time task, disable it
        let params = UpdateScheduledTaskParams {
            enabled: Some(false),
            ..Default::default()
        };
        if let Err(e) = db.update_scheduled_task(&task.id, &params) {
            eprintln!("[Scheduler] Error disabling one-time task {}: {}", task.id, e);
        } else {
            eprintln!("[Scheduler] Disabled one-time task {}", task.id);
        }
    }
}

fn send_notification(app: &AppHandle, title: &str, body: &str) {
    eprintln!("[Notification] 🔔 {}: {}", title, body);
    
    // Send native system notification
    match app.notification()
        .builder()
        .title(title)
        .body(body)
        .show() 
    {
        Ok(_) => eprintln!("[Notification] ✓ sent"),
        Err(e) => eprintln!("[Notification] ✗ failed: {}", e),
    }
}

fn emit_task_execute(app: &AppHandle, task: &ScheduledTask) -> Result<(), String> {
    eprintln!("[Scheduler] ▶ Executing prompt for: {}", task.title);
    
    let event_json = serde_json::to_string(&json!({
        "type": "scheduler.task_execute",
        "payload": {
            "taskId": task.id,
            "title": task.title,
            "prompt": task.prompt
        }
    })).map_err(|e| format!("Failed to serialize: {}", e))?;
    
    app.emit("server-event", event_json)
        .map_err(|e| format!("Failed to emit: {}", e))
}

/// Calculate the next run time for a schedule
/// Supports: "1m", "5m", "1h", "1d", "every 10m", "every 1h", "daily 09:00", "2026-01-20 15:30"
pub fn calculate_next_run(schedule: &str, from: i64) -> Option<i64> {
    // One-time delays: "1m", "5m", "1h", "2h", "1d", "7d"
    let once_re = Regex::new(r"^(\d+)([mhd])$").ok()?;
    if let Some(caps) = once_re.captures(schedule) {
        let amount: i64 = caps.get(1)?.as_str().parse().ok()?;
        let unit = caps.get(2)?.as_str();
        let multiplier: i64 = match unit {
            "m" => 60 * 1000,
            "h" => 60 * 60 * 1000,
            "d" => 24 * 60 * 60 * 1000,
            _ => return None,
        };
        return Some(from + amount * multiplier);
    }
    
    // Repeating intervals: "every 10m", "every 1h", "every 1d"
    let every_re = Regex::new(r"^every (\d+)([mhd])$").ok()?;
    if let Some(caps) = every_re.captures(schedule) {
        let amount: i64 = caps.get(1)?.as_str().parse().ok()?;
        let unit = caps.get(2)?.as_str();
        let multiplier: i64 = match unit {
            "m" => 60 * 1000,
            "h" => 60 * 60 * 1000,
            "d" => 24 * 60 * 60 * 1000,
            _ => return None,
        };
        return Some(from + amount * multiplier);
    }
    
    // Daily at specific time: "daily 09:00", "daily 14:30"
    let daily_re = Regex::new(r"^daily (\d{2}):(\d{2})$").ok()?;
    if let Some(caps) = daily_re.captures(schedule) {
        let hours: u32 = caps.get(1)?.as_str().parse().ok()?;
        let minutes: u32 = caps.get(2)?.as_str().parse().ok()?;
        
        let from_dt = chrono::DateTime::from_timestamp_millis(from)?;
        let local_dt = from_dt.with_timezone(&Local);
        
        let target_time = NaiveTime::from_hms_opt(hours, minutes, 0)?;
        let mut target = local_dt.date_naive().and_time(target_time);
        
        // If the time has passed today, schedule for tomorrow
        if Local.from_local_datetime(&target).single()?.timestamp_millis() <= from {
            target = target + chrono::Duration::days(1);
        }
        
        return Some(Local.from_local_datetime(&target).single()?.timestamp_millis());
    }
    
    // Specific datetime: "2026-01-20 15:30"
    let datetime_re = Regex::new(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$").ok()?;
    if let Some(caps) = datetime_re.captures(schedule) {
        let year: i32 = caps.get(1)?.as_str().parse().ok()?;
        let month: u32 = caps.get(2)?.as_str().parse().ok()?;
        let day: u32 = caps.get(3)?.as_str().parse().ok()?;
        let hours: u32 = caps.get(4)?.as_str().parse().ok()?;
        let minutes: u32 = caps.get(5)?.as_str().parse().ok()?;
        
        let target = chrono::NaiveDate::from_ymd_opt(year, month, day)?
            .and_hms_opt(hours, minutes, 0)?;
        
        return Some(Local.from_local_datetime(&target).single()?.timestamp_millis());
    }
    
    None
}

/// Check if a schedule format is valid
pub fn is_valid_schedule(schedule: &str) -> bool {
    calculate_next_run(schedule, chrono::Utc::now().timestamp_millis()).is_some()
}

/// Check if a schedule is recurring
pub fn is_recurring_schedule(schedule: &str) -> bool {
    schedule.starts_with("every") || schedule.starts_with("daily")
}
