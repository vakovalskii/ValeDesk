#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)] // TODO: remove after migration complete

mod db;
mod sandbox;
mod scheduler;

use db::{ApiSettings, CreateSessionParams, Database, FileChange, LLMModel, LLMProvider, LLMProviderSettings, Session, SessionHistory, TodoItem, UpdateSessionParams, VoiceSettings, ScheduledTask, CreateScheduledTaskParams, UpdateScheduledTaskParams};
use base64::Engine;
use scheduler::SchedulerService;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileItem {
  name: String,
  path: String,
  is_directory: bool,
  size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
  version: String,
  commit: String,
  commit_short: String,
  build_time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpResult {
  success: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

fn now_ms() -> Result<u64, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .map_err(|error| {
      let msg = format!("[time] now_ms failed: {error}");
      eprintln!("{msg}");
      msg
    })
}

fn now_ns() -> Result<u128, String> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .map_err(|error| {
      let msg = format!("[time] now_ns failed: {error}");
      eprintln!("{msg}");
      msg
    })
}

fn home_dir() -> Result<PathBuf, String> {
  #[cfg(target_os = "windows")]
  {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
      if !user_profile.trim().is_empty() {
        return Ok(PathBuf::from(user_profile));
      }
    }

    let home_drive = std::env::var("HOMEDRIVE")
      .map_err(|_| "[path] HOME directory is not available (missing HOMEDRIVE)".to_string())?;
    let home_path = std::env::var("HOMEPATH")
      .map_err(|_| "[path] HOME directory is not available (missing HOMEPATH)".to_string())?;
    let combined = format!("{home_drive}{home_path}");
    if combined.trim().is_empty() {
      return Err("[path] HOME directory is not available (USERPROFILE/HOMEDRIVE+HOMEPATH)".to_string());
    }
    return Ok(PathBuf::from(combined));
  }

  #[cfg(not(target_os = "windows"))]
  {
    let home = std::env::var("HOME").map_err(|_| "[path] HOME is not set".to_string())?;
    if home.trim().is_empty() {
      return Err("[path] HOME is empty".to_string());
    }
    Ok(PathBuf::from(home))
  }
}

fn app_data_dir() -> Result<PathBuf, String> {
  // We intentionally keep this independent of Electron/Tauri internal APIs to keep behavior predictable.
  // The directory name matches the product name used in the existing Electron build.
  const APP_DIR: &str = "ValeDesk";

  #[cfg(target_os = "windows")]
  {
    let appdata = std::env::var("APPDATA").map_err(|_| "[path] APPDATA is not set".to_string())?;
    if appdata.trim().is_empty() {
      return Err("[path] APPDATA is empty".to_string());
    }
    return Ok(PathBuf::from(appdata).join(APP_DIR));
  }

  #[cfg(target_os = "macos")]
  {
    let home = home_dir()?;
    return Ok(home.join("Library").join("Application Support").join(APP_DIR));
  }

  #[cfg(target_os = "linux")]
  {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
      if !xdg.trim().is_empty() {
        return Ok(PathBuf::from(xdg).join(APP_DIR));
      }
    }
    let home = home_dir()?;
    return Ok(home.join(".config").join(APP_DIR));
  }
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| format!("[fs] Path has no parent: {}", path.display()))?;
  fs::create_dir_all(parent).map_err(|error| {
    let msg = format!("[fs] Failed to create dir {}: {error}", parent.display());
    eprintln!("{msg}");
    msg
  })
}

fn read_json_file(path: &Path) -> Result<Option<Value>, String> {
  if !path.exists() {
    return Ok(None);
  }

  let raw = fs::read_to_string(path).map_err(|error| {
    let msg = format!("[fs] Failed to read {}: {error}", path.display());
    eprintln!("{msg}");
    msg
  })?;

  if raw.trim().is_empty() {
    return Ok(None);
  }

  serde_json::from_str::<Value>(&raw).map(Some).map_err(|error| {
    let msg = format!("[fs] Failed to parse JSON {}: {error}", path.display());
    eprintln!("{msg}");
    msg
  })
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
  ensure_parent_dir(path)?;
  let raw = serde_json::to_string_pretty(value).map_err(|error| {
    let msg = format!("[json] Failed to serialize JSON for {}: {error}", path.display());
    eprintln!("{msg}");
    msg
  })?;
  fs::write(path, raw).map_err(|error| {
    let msg = format!("[fs] Failed to write {}: {error}", path.display());
    eprintln!("{msg}");
    msg
  })
}

fn emit_server_event_app(app: &tauri::AppHandle, event: &Value) -> Result<(), String> {
  let payload = serde_json::to_string(event).map_err(|error| {
    let msg = format!("[ipc] Failed to serialize server event: {error}");
    eprintln!("{msg}");
    msg
  })?;

  app.emit("server-event", payload).map_err(|error| {
    let msg = format!("[ipc] Failed to emit server-event: {error}");
    eprintln!("{msg}");
    msg
  })
}

#[derive(Default)]
struct VoiceBuffer {
  bytes: Vec<u8>,
  last_sent_ms: u64,
  audio_mime: String,
  last_partial_text: Option<String>,
  last_partial_ms: u64,
  last_partial_bytes_len: usize,
}

#[derive(Default)]
struct VoiceState {
  buffers: Mutex<HashMap<String, VoiceBuffer>>,
  last_status: Mutex<Option<bool>>,
  // Prevent spamming warmups:
  // - allow only one warmup at a time (warmup_in_flight)
  // - skip if the last SUCCESSFUL warmup was for the same (base_url, model)
  warmup_last_success_key: Mutex<Option<(String, String)>>,
  warmup_in_flight: Mutex<bool>,
}

fn memory_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".valera").join("memory.md"))
}

/// Handle scheduler.request events from sidecar - execute scheduler operations
fn handle_scheduler_request(_app: &tauri::AppHandle, db: &Arc<Database>, sidecar_state: &SidecarState, payload: &Value) {
  let request_id = payload.get("requestId").and_then(|v| v.as_str()).unwrap_or("");
  let operation = payload.get("operation").and_then(|v| v.as_str()).unwrap_or("");
  let params = payload.get("params").cloned().unwrap_or(Value::Null);
  
  eprintln!("[scheduler] {} request", operation);
  
  let result = match operation {
    "create" => {
      let create_params: Result<db::CreateScheduledTaskParams, _> = serde_json::from_value(params.clone());
      match create_params {
        Ok(p) => {
          let now = chrono::Utc::now().timestamp_millis();
          match scheduler::calculate_next_run(&p.schedule, now) {
            Some(next_run) => {
              let is_recurring = scheduler::is_recurring_schedule(&p.schedule);
              match db.create_scheduled_task(&p, next_run, is_recurring) {
                Ok(task) => json!({ "success": true, "data": task }),
                Err(e) => json!({ "success": false, "error": format!("{}", e) })
              }
            }
            None => json!({ "success": false, "error": format!("Invalid schedule format: {}", p.schedule) })
          }
        }
        Err(e) => json!({ "success": false, "error": format!("Invalid params: {}", e) })
      }
    }
    "list" => {
      match db.list_scheduled_tasks(true) {
        Ok(tasks) => json!({ "success": true, "data": tasks }),
        Err(e) => json!({ "success": false, "error": format!("{}", e) })
      }
    }
    "delete" => {
      let task_id = params.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
      match db.delete_scheduled_task(task_id) {
        Ok(deleted) => {
          if deleted {
            json!({ "success": true })
          } else {
            json!({ "success": false, "error": format!("Task {} not found", task_id) })
          }
        }
        Err(e) => json!({ "success": false, "error": format!("{}", e) })
      }
    }
    "update" => {
      let task_id = params.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
      let update_params: Result<db::UpdateScheduledTaskParams, _> = 
        serde_json::from_value(params.get("params").cloned().unwrap_or(Value::Object(Default::default())));
      
      match update_params {
        Ok(mut p) => {
          // If schedule is being updated, recalculate next_run
          if let Some(ref schedule) = p.schedule {
            let now = chrono::Utc::now().timestamp_millis();
            if let Some(next_run) = scheduler::calculate_next_run(schedule, now) {
              p.next_run = Some(next_run);
              p.is_recurring = Some(scheduler::is_recurring_schedule(schedule));
            }
          }
          
          match db.update_scheduled_task(task_id, &p) {
            Ok(updated) => {
              if updated {
                json!({ "success": true })
              } else {
                json!({ "success": false, "error": format!("Task {} not found", task_id) })
              }
            }
            Err(e) => json!({ "success": false, "error": format!("{}", e) })
          }
        }
        Err(e) => json!({ "success": false, "error": format!("Invalid params: {}", e) })
      }
    }
    _ => json!({ "success": false, "error": format!("Unknown operation: {}", operation) })
  };
  
  // Log result
  let success = result.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
  if success {
    eprintln!("[scheduler] ✓ {}", operation);
  } else {
    let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
    eprintln!("[scheduler] ✗ {}: {}", operation, err);
  }
  
  // Send response back to sidecar through stdin
  let response_msg = json!({
    "type": "scheduler-response",
    "payload": {
      "requestId": request_id,
      "result": result
    }
  });
  
  if let Err(e) = send_to_sidecar_raw(sidecar_state, &response_msg) {
    eprintln!("[scheduler] ✗ send response: {}", e);
  }
}

fn send_to_sidecar_raw(sidecar_state: &SidecarState, msg: &Value) -> Result<(), String> {
  let mut guard = sidecar_state.child.lock().map_err(|_| "[sidecar] state lock poisoned".to_string())?;
  let child = guard.as_mut().ok_or_else(|| "[sidecar] sidecar is not running".to_string())?;

  let raw = serde_json::to_string(msg).map_err(|error| format!("[sidecar] Failed to serialize message: {error}"))?;

  child
    .stdin
    .write_all(format!("{raw}\n").as_bytes())
    .map_err(|error| format!("[sidecar] Failed to write to stdin: {error}"))?;
  child.stdin.flush().map_err(|error| format!("[sidecar] Failed to flush stdin: {error}"))?;
  Ok(())
}

/// Handle session.sync events from sidecar - save to DB
fn handle_session_sync(db: &Arc<Database>, payload: &Value) {
  let sync_type = payload.get("syncType").and_then(|v| v.as_str()).unwrap_or("");
  let session_id = match payload.get("sessionId").and_then(|v| v.as_str()) {
    Some(id) => id,
    None => return,
  };
  let data = payload.get("data").cloned().unwrap_or(Value::Null);
  
  match sync_type {
    "create" => {
      let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("New Chat");
      let params = CreateSessionParams {
        id: Some(session_id.to_string()),
        cwd: data.get("cwd").and_then(|v| v.as_str()).map(String::from),
        allowed_tools: data.get("allowedTools").and_then(|v| v.as_str()).map(String::from),
        prompt: None,
        title: title.to_string(),
        model: data.get("model").and_then(|v| v.as_str()).map(String::from),
        thread_id: data.get("threadId").and_then(|v| v.as_str()).map(String::from),
        temperature: None,
      };
      if let Err(e) = db.create_session(&params) {
        eprintln!("[session.sync:create] Failed: {}", e);
      }
    }
    "update" => {
      let params = UpdateSessionParams {
        title: data.get("title").and_then(|v| v.as_str()).map(String::from),
        status: data.get("status").and_then(|v| v.as_str()).map(String::from),
        cwd: data.get("cwd").and_then(|v| v.as_str()).map(String::from),
        model: data.get("model").and_then(|v| v.as_str()).map(String::from),
        input_tokens: data.get("inputTokens").and_then(|v| v.as_i64()),
        output_tokens: data.get("outputTokens").and_then(|v| v.as_i64()),
        ..Default::default()
      };
      if let Err(e) = db.update_session(session_id, &params) {
        eprintln!("[session.sync:update] Failed: {}", e);
      }
    }
    "message" => {
      if let Err(e) = db.record_message(session_id, &data) {
        eprintln!("[session.sync:message] Failed: {}", e);
      }
    }
    "todos" => {
      if let Ok(todos) = serde_json::from_value::<Vec<TodoItem>>(data) {
        if let Err(e) = db.save_todos(session_id, &todos) {
          eprintln!("[session.sync:todos] Failed: {}", e);
        }
      }
    }
    _ => {
      eprintln!("[session.sync] Unknown syncType: {}", sync_type);
    }
  }
}

fn normalize_llm_provider_settings(value: Option<Value>) -> Value {
  let mut obj = match value {
    Some(Value::Object(o)) => o,
    _ => return json!({ "providers": [], "models": [] }),
  };

  let providers_ok = matches!(obj.get("providers"), Some(Value::Array(_)));
  if !providers_ok {
    obj.insert("providers".to_string(), Value::Array(Vec::new()));
  }

  let models_ok = matches!(obj.get("models"), Some(Value::Array(_)));
  if !models_ok {
    obj.insert("models".to_string(), Value::Array(Vec::new()));
  }

  Value::Object(obj)
}

fn open_target(target: &str) -> Result<(), String> {
  if target.trim().is_empty() {
    return Err("[shell] target is empty".to_string());
  }

  #[cfg(target_os = "windows")]
  {
    let status = Command::new("cmd")
      .args(["/C", "start", "", target])
      .status()
      .map_err(|error| format!("[shell] Failed to spawn cmd to open target: {error}"))?;
    if !status.success() {
      return Err(format!("[shell] cmd start failed: {status}"));
    }
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    let status = Command::new("open")
      .arg(target)
      .status()
      .map_err(|error| format!("[shell] Failed to spawn open: {error}"))?;
    if !status.success() {
      return Err(format!("[shell] open failed: {status}"));
    }
    return Ok(());
  }

  #[cfg(target_os = "linux")]
  {
    let status = Command::new("xdg-open")
      .arg(target)
      .status()
      .map_err(|error| format!("[shell] Failed to spawn xdg-open: {error}"))?;
    if !status.success() {
      return Err(format!("[shell] xdg-open failed: {status}"));
    }
    return Ok(());
  }
}

struct AppState {
  db: Arc<Database>,
  sidecar: SidecarState,
  voice: VoiceState,
  scheduler: SchedulerService,
}

#[derive(Default)]
struct SidecarState {
  child: Mutex<Option<SidecarChild>>,
}

struct SidecarChild {
  stdin: std::process::ChildStdin,
  #[allow(dead_code)]
  child: Child,
}

fn resolve_sidecar_entry() -> Result<PathBuf, String> {
  if let Ok(p) = std::env::var("VALERA_SIDECAR_ENTRY") {
    if !p.trim().is_empty() {
      return Ok(PathBuf::from(p));
    }
  }

  #[cfg(debug_assertions)]
  {
    // Dev default: run from workspace root (ValeDesk/)
    let candidate = PathBuf::from("dist-sidecar/sidecar/main.js");
    if candidate.exists() {
      return Ok(candidate);
    }
    return Err("dist-sidecar/sidecar/main.js not found. Run npm run transpile:sidecar".to_string());
  }

  #[cfg(not(debug_assertions))]
  {
      // Prod: Look for sidecar binary in the executables directory
      // Name formatting: valera-sidecar-<target-triple>
      // For now, we search for a file starting with valera-sidecar
      let exe = std::env::current_exe().map_err(|e| format!("[sidecar] Failed to get current exe: {e}"))?;
      let dir = exe.parent().ok_or("[sidecar] Failed to get exe parent")?;
      
      let entries = fs::read_dir(dir).map_err(|e| format!("[sidecar] Failed to read resource dir: {e}"))?;
      for entry in entries {
          if let Ok(entry) = entry {
              let name = entry.file_name().to_string_lossy().to_string();
              if name.starts_with("valera-sidecar") {
                  return Ok(entry.path());
              }
          }
      }
      return Err(format!("[sidecar] Sidecar binary not found in {}", dir.display()));
  }
}

fn resolve_node_bin() -> Result<String, String> {
  if let Ok(v) = std::env::var("VALERA_NODE_BIN") {
    if !v.trim().is_empty() {
      return Ok(v);
    }
  }
  Ok("node".to_string())
}

fn start_sidecar(app: tauri::AppHandle, sidecar_state: &SidecarState) -> Result<(), String> {
  let mut guard = sidecar_state.child.lock().map_err(|_| "[sidecar] state lock poisoned".to_string())?;
  if guard.is_some() {
    return Ok(());
  }

  let entry = resolve_sidecar_entry()?;
  if !entry.exists() {
    return Err(format!("[sidecar] entry does not exist: {}", entry.display()));
  }

  let user_data_dir = app_data_dir()?;
  fs::create_dir_all(&user_data_dir).map_err(|error| format!("[sidecar] Failed to create user data dir: {error}"))?;
  
  let mut child_cmd;
  
  #[cfg(debug_assertions)]
  {
     let node_bin = resolve_node_bin()?;
     child_cmd = Command::new(&node_bin);
     child_cmd.arg(&entry);
  }
  
  #[cfg(not(debug_assertions))]
  {
      child_cmd = Command::new(&entry);
  }

  // On Windows release builds, hide the sidecar console window
  #[cfg(all(windows, not(debug_assertions)))]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    child_cmd.creation_flags(CREATE_NO_WINDOW);
  }

  let mut child = child_cmd
    .env("VALERA_USER_DATA_DIR", user_data_dir.to_string_lossy().to_string())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("[sidecar] Failed to spawn sidecar: {error}"))?;

  let stdin = child.stdin.take().ok_or_else(|| "[sidecar] Failed to capture stdin".to_string())?;
  let stdout = child.stdout.take().ok_or_else(|| "[sidecar] Failed to capture stdout".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "[sidecar] Failed to capture stderr".to_string())?;

  // stdout reader -> emit server-event
  {
    let app_handle = app.clone();
    std::thread::spawn(move || {
      let reader = BufReader::new(stdout);
      for line in reader.lines() {
        match line {
          Ok(raw) => {
            let raw: String = raw;
            let trimmed = raw.trim();
            if trimmed.is_empty() {
              continue;
            }
            // Skip debug log lines (not JSON) - they start with [ or other non-JSON chars
            if !trimmed.starts_with('{') {
              continue;
            }
            let parsed: serde_json::Value = match serde_json::from_str(&raw) {
              Ok(v) => v,
              Err(error) => {
                eprintln!("[sidecar] Invalid JSON from stdout: {error}; line={raw}");
                continue;
              }
            };

            let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if msg_type == "server-event" {
              if let Some(event) = parsed.get("event") {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                
                // Handle session.sync events - save to DB
                if event_type == "session.sync" {
                  if let Some(payload) = event.get("payload") {
                    let state: tauri::State<'_, AppState> = app_handle.state();
                    handle_session_sync(&state.db, payload);
                  }
                  continue; // Don't emit to frontend
                }
                
                // Handle scheduler.request events from sidecar
                if event_type == "scheduler.request" {
                  if let Some(payload) = event.get("payload") {
                    let state: tauri::State<'_, AppState> = app_handle.state();
                    handle_scheduler_request(&app_handle, &state.db, &state.sidecar, payload);
                  }
                  continue; // Don't emit to frontend
                }
                
                // Only log non-streaming events to reduce noise
                if event_type != "stream.message" {
                  eprintln!("[sidecar] → {}", event_type);
                }
                if let Err(error) = emit_server_event_app(&app_handle, event) {
                  eprintln!("[sidecar] ✗ emit failed: {error}");
                }
              }
              continue;
            }

            // Log messages from sidecar
            if msg_type == "log" {
              eprintln!("[sidecar] {raw}");
              continue;
            }

            eprintln!("[sidecar] Unknown message from stdout: {raw}");
          }
          Err(error) => {
            eprintln!("[sidecar] stdout read error: {error}");
            break;
          }
        }
      }
    });
  }

  // stderr reader -> log
  {
    std::thread::spawn(move || {
      let reader = BufReader::new(stderr);
      for line in reader.lines() {
        match line {
          Ok(raw) => {
            let raw: String = raw;
            if raw.trim().is_empty() {
              continue;
            }
            eprintln!("[sidecar:stderr] {raw}");
          }
          Err(error) => {
            eprintln!("[sidecar] stderr read error: {error}");
            break;
          }
        }
      }
    });
  }

  *guard = Some(SidecarChild { stdin, child });
  Ok(())
}

fn send_to_sidecar(app: tauri::AppHandle, state: &AppState, event: &Value) -> Result<(), String> {
  start_sidecar(app, &state.sidecar)?;

  let mut guard = state.sidecar.child.lock().map_err(|_| "[sidecar] state lock poisoned".to_string())?;
  let child = guard.as_mut().ok_or_else(|| "[sidecar] sidecar is not running".to_string())?;

  let msg = json!({ "type": "client-event", "event": event });
  let raw = serde_json::to_string(&msg).map_err(|error| format!("[sidecar] Failed to serialize message: {error}"))?;

  child
    .stdin
    .write_all(format!("{raw}\n").as_bytes())
    .map_err(|error| format!("[sidecar] Failed to write to stdin: {error}"))?;
  child.stdin.flush().map_err(|error| format!("[sidecar] Failed to flush stdin: {error}"))?;
  Ok(())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FileItem>, String> {
  if path.trim().is_empty() {
    return Err("[list_directory] path is empty".to_string());
  }

  let dir = PathBuf::from(&path);
  if !dir.exists() {
    return Err(format!("[list_directory] path does not exist: {}", dir.display()));
  }
  if !dir.is_dir() {
    return Err(format!("[list_directory] path is not a directory: {}", dir.display()));
  }

  let mut out: Vec<FileItem> = Vec::new();
  let entries = fs::read_dir(&dir).map_err(|error| format!("[list_directory] read_dir failed: {error}"))?;

  for entry in entries {
    let entry = entry.map_err(|error| format!("[list_directory] entry read failed: {error}"))?;
    let entry_path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    let meta = entry.metadata().map_err(|error| format!("[list_directory] metadata failed: {error}"))?;
    let is_directory = meta.is_dir();
    let size = if meta.is_file() { Some(meta.len()) } else { None };

    out.push(FileItem {
      name,
      path: entry_path.to_string_lossy().to_string(),
      is_directory,
      size,
    });
  }

  Ok(out)
}

#[tauri::command]
fn read_memory() -> Result<String, String> {
  let path = memory_path()?;
  match fs::read_to_string(&path) {
    Ok(content) => Ok(content),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(error) => Err(format!("[read_memory] Failed to read {}: {error}", path.display())),
  }
}

#[tauri::command]
fn write_memory(content: String) -> Result<(), String> {
  let path = memory_path()?;
  ensure_parent_dir(&path)?;
  fs::write(&path, content).map_err(|error| format!("[write_memory] Failed to write {}: {error}", path.display()))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<OpResult, String> {
  if !(url.starts_with("http://") || url.starts_with("https://")) {
    return Ok(OpResult {
      success: false,
      error: Some("[open_external_url] Only http(s) URLs are allowed".to_string()),
    });
  }

  match open_target(&url) {
    Ok(()) => Ok(OpResult { success: true, error: None }),
    Err(error) => Ok(OpResult { success: false, error: Some(error) }),
  }
}

#[tauri::command]
fn open_path_in_finder(path: String) -> Result<OpResult, String> {
  if path.trim().is_empty() {
    return Ok(OpResult { success: false, error: Some("[open_path_in_finder] path is empty".to_string()) });
  }
  match open_target(&path) {
    Ok(()) => Ok(OpResult { success: true, error: None }),
    Err(error) => Ok(OpResult { success: false, error: Some(error) }),
  }
}

#[tauri::command]
fn open_file(path: String) -> Result<OpResult, String> {
  if path.trim().is_empty() {
    return Ok(OpResult { success: false, error: Some("[open_file] path is empty".to_string()) });
  }
  match open_target(&path) {
    Ok(()) => Ok(OpResult { success: true, error: None }),
    Err(error) => Ok(OpResult { success: false, error: Some(error) }),
  }
}

#[tauri::command]
fn get_build_info() -> Result<BuildInfo, String> {
  // Version from Cargo.toml, commit info from build-time env vars (set by build.rs)
  let commit = option_env!("GIT_COMMIT_HASH").unwrap_or("unknown");
  let commit_short = option_env!("GIT_COMMIT_SHORT").unwrap_or(
    if cfg!(debug_assertions) { "dev" } else { "release" }
  );
  Ok(BuildInfo {
    version: env!("CARGO_PKG_VERSION").to_string(),
    commit: commit.to_string(),
    commit_short: commit_short.to_string(),
    build_time: option_env!("BUILD_TIME").unwrap_or("unknown").to_string(),
  })
}

#[tauri::command]
fn select_directory() -> Result<Option<String>, String> {
  let picked = rfd::FileDialog::new().pick_folder();
  Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn generate_session_title(user_input: Option<String>) -> Result<String, String> {
  let input = user_input.unwrap_or_default();
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return Ok("New Chat".to_string());
  }
  let words: Vec<&str> = trimmed.split_whitespace().take(3).collect();
  Ok(words.join(" "))
}

#[tauri::command]
fn get_recent_cwds(state: tauri::State<'_, AppState>, limit: Option<u32>) -> Result<Vec<String>, String> {
  state.db.list_recent_cwds(limit.unwrap_or(8))
    .map_err(|e| format!("[get_recent_cwds] {}", e))
}

// ============ Code Sandbox Commands ============

#[tauri::command]
fn sandbox_execute_js(code: String, cwd: String, timeout_ms: Option<u64>) -> sandbox::SandboxResult {
  eprintln!("[sandbox] execute_js: {} bytes, cwd={}", code.len(), cwd);
  sandbox::execute_javascript(&code, &cwd, timeout_ms.unwrap_or(5000))
}

#[tauri::command]
fn sandbox_execute_python(code: String, cwd: String, timeout_ms: Option<u64>) -> sandbox::SandboxResult {
  eprintln!("[sandbox] execute_python: {} bytes, cwd={}", code.len(), cwd);
  sandbox::execute_python(&code, &cwd, timeout_ms.unwrap_or(5000))
}

#[tauri::command]
fn sandbox_execute(code: String, language: String, cwd: String, timeout_ms: Option<u64>) -> sandbox::SandboxResult {
  eprintln!("[sandbox] execute_{}: {} bytes, cwd={}", language, code.len(), cwd);
  sandbox::execute_code(&code, &language, &cwd, timeout_ms.unwrap_or(5000))
}

// Session commands - handled directly in Rust
#[tauri::command]
fn db_session_list(state: tauri::State<'_, AppState>) -> Result<Vec<Session>, String> {
  state.db.list_sessions()
    .map_err(|e| format!("[db_session_list] {}", e))
}

#[tauri::command]
fn db_session_create(state: tauri::State<'_, AppState>, params: CreateSessionParams) -> Result<Session, String> {
  state.db.create_session(&params)
    .map_err(|e| format!("[db_session_create] {}", e))
}

#[tauri::command]
fn db_session_get(state: tauri::State<'_, AppState>, id: String) -> Result<Option<Session>, String> {
  state.db.get_session(&id)
    .map_err(|e| format!("[db_session_get] {}", e))
}

#[tauri::command]
fn db_session_update(state: tauri::State<'_, AppState>, id: String, params: UpdateSessionParams) -> Result<bool, String> {
  state.db.update_session(&id, &params)
    .map_err(|e| format!("[db_session_update] {}", e))
}

#[tauri::command]
fn db_session_delete(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
  state.db.delete_session(&id)
    .map_err(|e| format!("[db_session_delete] {}", e))
}

#[tauri::command]
fn db_session_history(state: tauri::State<'_, AppState>, id: String) -> Result<Option<SessionHistory>, String> {
  state.db.get_session_history(&id)
    .map_err(|e| format!("[db_session_history] {}", e))
}

#[tauri::command]
fn db_session_pin(state: tauri::State<'_, AppState>, id: String, is_pinned: bool) -> Result<(), String> {
  state.db.set_pinned(&id, is_pinned)
    .map_err(|e| format!("[db_session_pin] {}", e))
}

#[tauri::command]
fn db_record_message(state: tauri::State<'_, AppState>, session_id: String, message: Value) -> Result<(), String> {
  state.db.record_message(&session_id, &message)
    .map_err(|e| format!("[db_record_message] {}", e))
}

#[tauri::command]
fn db_update_tokens(state: tauri::State<'_, AppState>, id: String, input_tokens: i64, output_tokens: i64) -> Result<(), String> {
  state.db.update_tokens(&id, input_tokens, output_tokens)
    .map_err(|e| format!("[db_update_tokens] {}", e))
}

#[tauri::command]
fn db_save_todos(state: tauri::State<'_, AppState>, session_id: String, todos: Vec<TodoItem>) -> Result<(), String> {
  state.db.save_todos(&session_id, &todos)
    .map_err(|e| format!("[db_save_todos] {}", e))
}

#[tauri::command]
fn db_save_file_changes(state: tauri::State<'_, AppState>, session_id: String, changes: Vec<FileChange>) -> Result<(), String> {
  state.db.save_file_changes(&session_id, &changes)
    .map_err(|e| format!("[db_save_file_changes] {}", e))
}

// ============ Settings commands ============

#[tauri::command]
fn db_get_api_settings(state: tauri::State<'_, AppState>) -> Result<Option<ApiSettings>, String> {
  state.db.get_api_settings()
    .map_err(|e| format!("[db_get_api_settings] {}", e))
}

#[tauri::command]
fn db_save_api_settings(state: tauri::State<'_, AppState>, settings: ApiSettings) -> Result<(), String> {
  state.db.save_api_settings(&settings)
    .map_err(|e| format!("[db_save_api_settings] {}", e))
}

// ============ LLM Providers commands ============

#[tauri::command]
fn db_get_llm_providers(state: tauri::State<'_, AppState>) -> Result<LLMProviderSettings, String> {
  state.db.get_llm_provider_settings()
    .map_err(|e| format!("[db_get_llm_providers] {}", e))
}

#[tauri::command]
fn db_save_llm_providers(state: tauri::State<'_, AppState>, settings: LLMProviderSettings) -> Result<(), String> {
  state.db.save_llm_provider_settings(&settings)
    .map_err(|e| format!("[db_save_llm_providers] {}", e))
}

#[tauri::command]
fn db_save_provider(state: tauri::State<'_, AppState>, provider: LLMProvider) -> Result<(), String> {
  state.db.save_provider(&provider)
    .map_err(|e| format!("[db_save_provider] {}", e))
}

#[tauri::command]
fn db_delete_provider(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
  state.db.delete_provider(&id)
    .map_err(|e| format!("[db_delete_provider] {}", e))
}

#[tauri::command]
fn db_save_models(state: tauri::State<'_, AppState>, models: Vec<LLMModel>) -> Result<(), String> {
  state.db.save_models_bulk(&models)
    .map_err(|e| format!("[db_save_models] {}", e))
}

fn normalize_base_url(base_url: &str) -> String {
  base_url.trim().trim_end_matches('/').to_string()
}

fn build_healthcheck_urls(base_url: &str) -> Vec<String> {
  let base = normalize_base_url(base_url);
  if base.is_empty() {
    return vec![];
  }
  // Try health + OpenAI-style /v1/models (works for most compatible servers)
  // plus a variant without trailing /v1
  let mut urls = vec![
    format!("{base}/health"),
    format!("{base}/v1/health"),
    format!("{base}/v1/models"),
  ];
  if base.ends_with("/v1") {
    let root = base.trim_end_matches("/v1");
    urls.push(format!("{root}/health"));
    urls.push(format!("{root}/v1/models"));
  }
  urls.sort();
  urls.dedup();
  urls
}

fn check_voice_server_status_blocking(base_url: &str, api_key: Option<&str>) -> Result<(bool, Option<String>), String> {
  let urls = build_healthcheck_urls(base_url);
  if urls.is_empty() {
    return Ok((false, None));
  }

  let client = reqwest::blocking::Client::builder()
    .timeout(std::time::Duration::from_secs(5))
    .build()
    .map_err(|e| format!("[voice] failed to build http client: {e}"))?;

  let mut unauthorized = false;
  for url in urls {
    let mut req = client.get(&url);
    if let Some(key) = api_key {
      if !key.trim().is_empty() {
        req = req.bearer_auth(key.trim());
      }
    }
    match req.send() {
      Ok(resp) if resp.status().is_success() => return Ok((true, None)),
      Ok(resp) if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 => {
        unauthorized = true;
        continue;
      }
      Ok(_) => continue,
      Err(_) => continue,
    };
  }

  if unauthorized {
    return Ok((false, Some("Unauthorized (проверь API key)".to_string())));
  }
  Ok((false, None))
}

fn build_transcription_url(base_url: &str) -> Result<String, String> {
  let base = normalize_base_url(base_url);
  if base.is_empty() {
    return Err("[voice] baseUrl is empty".to_string());
  }
  if base.ends_with("/v1") {
    return Ok(format!("{base}/audio/transcriptions"));
  }
  if base.contains("/v1/") {
    return Ok(format!("{base}/audio/transcriptions"));
  }
  Ok(format!("{base}/v1/audio/transcriptions"))
}

fn build_models_url(base_url: &str) -> Result<String, String> {
  let base = normalize_base_url(base_url);
  if base.is_empty() {
    return Err("[voice.models] baseUrl is empty".to_string());
  }
  if base.ends_with("/v1") {
    return Ok(format!("{base}/models"));
  }
  if base.contains("/v1/") {
    return Ok(format!("{base}/models"));
  }
  Ok(format!("{base}/v1/models"))
}

fn extract_models(value: &Value) -> Vec<String> {
  let list = if let Some(arr) = value.as_array() {
    arr
  } else if let Some(arr) = value.get("data").and_then(|v| v.as_array()) {
    arr
  } else if let Some(arr) = value.get("models").and_then(|v| v.as_array()) {
    arr
  } else {
    return vec![];
  };

  let mut seen = HashSet::new();
  let mut out = Vec::new();
  for item in list {
    let id = if let Some(s) = item.as_str() {
      Some(s.to_string())
    } else if let Some(obj) = item.as_object() {
      obj.get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| obj.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
    } else {
      None
    };
    if let Some(id) = id {
      let trimmed = id.trim();
      if !trimmed.is_empty() && !seen.contains(trimmed) {
        seen.insert(trimmed.to_string());
        out.push(trimmed.to_string());
      }
    }
  }
  out
}

fn guess_extension_from_mime(mime: &str) -> &'static str {
  let m = mime.to_lowercase();
  if m.contains("webm") { return "webm"; }
  if m.contains("ogg") { return "ogg"; }
  if m.contains("wav") { return "wav"; }
  if m.contains("mp4") || m.contains("m4a") { return "m4a"; }
  "bin"
}

async fn transcribe_audio(
  base_url: &str,
  api_key: Option<&str>,
  model: &str,
  language: Option<&str>,
  audio_mime: &str,
  bytes: Vec<u8>
) -> Result<String, String> {
  if bytes.is_empty() {
    return Err("[voice] audio buffer is empty".to_string());
  }

  let url = build_transcription_url(base_url)?;
  let client = reqwest::Client::builder()
    // First request can block on model download/load (often 1-2+ minutes).
    .timeout(std::time::Duration::from_secs(240))
    .build()
    .map_err(|e| format!("[voice] failed to build http client: {e}"))?;

  let filename = format!("audio.{}", guess_extension_from_mime(audio_mime));
  let mut part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
  let mime_raw = audio_mime.trim();
  if !mime_raw.is_empty() {
    // `mime_str` consumes Part; avoid losing it by only calling when the mime is parseable.
    if mime_raw.parse::<mime::Mime>().is_ok() {
      part = part.mime_str(mime_raw).map_err(|e| format!("[voice] invalid mime '{mime_raw}': {e}"))?;
    }
  }

  let mut form = reqwest::multipart::Form::new()
    .part("file", part)
    .text("model", model.to_string());
  if let Some(lang) = language {
    if !lang.trim().is_empty() {
      form = form.text("language", lang.trim().to_string());
    }
  }

  let mut req = client.post(url).multipart(form);
  if let Some(key) = api_key {
    if !key.trim().is_empty() {
      req = req.bearer_auth(key.trim());
    }
  }

  let resp = req.send().await.map_err(|e| {
    if e.is_timeout() {
      "[voice] request timed out (model may still be loading; try again in ~1-2 minutes)".to_string()
    } else {
      format!("[voice] request failed: {e}")
    }
  })?;
  let status = resp.status();
  let body = resp.text().await.map_err(|e| format!("[voice] failed to read response: {e}"))?;
  if !status.is_success() {
    return Err(format!("[voice] http {status}: {body}"));
  }

  let parsed: Value = serde_json::from_str(&body).map_err(|e| format!("[voice] invalid json: {e}; body={body}"))?;
  let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
  Ok(text)
}

#[tauri::command]
async fn list_voice_models(base_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
  let url = build_models_url(&base_url)?;
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|e| format!("[voice.models] failed to build http client: {e}"))?;

  let mut req = client.get(url);
  if let Some(key) = api_key.as_deref() {
    if !key.trim().is_empty() {
      req = req.bearer_auth(key.trim());
    }
  }

  let resp = req.send().await.map_err(|e| format!("[voice.models] request failed: {e}"))?;
  let status = resp.status();
  let body = resp.text().await.map_err(|e| format!("[voice.models] failed to read response: {e}"))?;
  if !status.is_success() {
    return Err(format!("[voice.models] http {status}: {body}"));
  }
  let parsed: Value = serde_json::from_str(&body)
    .map_err(|e| format!("[voice.models] invalid json: {e}; body={body}"))?;
  Ok(extract_models(&parsed))
}

#[tauri::command]
async fn transcribe_voice_stream(
  app: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  audio_chunk_b64: String,
  audio_mime: String,
  session_id: String,
  base_url: String,
  api_key: Option<String>,
  model: String,
  language: Option<String>,
  is_final: bool
) -> Result<(), String> {
  if session_id.trim().is_empty() {
    return Err("[transcribe_voice_stream] sessionId is empty".to_string());
  }

  if let Ok(last_guard) = state.voice.last_status.lock() {
    if matches!(*last_guard, Some(false)) {
      if let Ok(mut guard) = state.voice.buffers.lock() {
        guard.remove(&session_id);
      }
      emit_server_event_app(&app, &json!({
        "type": "voice.transcription.error",
        "payload": {
          "sessionId": session_id,
          "message": "[voice] server unavailable"
        }
      }))?;
      return Ok(());
    }
  }

  // Append chunk (if provided)
  if !audio_chunk_b64.trim().is_empty() {
    let decoded = base64::engine::general_purpose::STANDARD
      .decode(audio_chunk_b64.trim())
      .map_err(|e| format!("[transcribe_voice_stream] invalid base64: {e}"))?;
    let mut guard = state.voice.buffers.lock().map_err(|_| "[voice] buffers lock poisoned".to_string())?;
    let entry = guard.entry(session_id.clone()).or_default();
    entry.bytes.extend_from_slice(&decoded);
    if !audio_mime.trim().is_empty() {
      entry.audio_mime = audio_mime.trim().to_string();
    }
  } else if !audio_mime.trim().is_empty() {
    // Allow updating mime even if this call is just a finalization marker
    let mut guard = state.voice.buffers.lock().map_err(|_| "[voice] buffers lock poisoned".to_string())?;
    let entry = guard.entry(session_id.clone()).or_default();
    entry.audio_mime = audio_mime.trim().to_string();
  }

  // Decide whether to send a partial update
  if !is_final {
    let now = now_ms().unwrap_or(0);
    {
      let mut guard = state.voice.buffers.lock().map_err(|_| "[voice] buffers lock poisoned".to_string())?;
      let entry = guard.entry(session_id.clone()).or_default();
      if now.saturating_sub(entry.last_sent_ms) < 1500 {
        return Ok(());
      }
      entry.last_sent_ms = now;
    }
  }

  // Snapshot buffer for request (and clear on final)
  let (bytes, mime, last_partial_text, last_partial_ms, last_partial_bytes_len) = {
    let mut guard = state.voice.buffers.lock().map_err(|_| "[voice] buffers lock poisoned".to_string())?;
    let entry = guard.entry(session_id.clone()).or_default();
    let mime = if entry.audio_mime.trim().is_empty() { audio_mime.clone() } else { entry.audio_mime.clone() };
    let bytes = entry.bytes.clone();
    let last_partial_text = entry.last_partial_text.clone();
    let last_partial_ms = entry.last_partial_ms;
    let last_partial_bytes_len = entry.last_partial_bytes_len;
    if is_final {
      guard.remove(&session_id);
    }
    (bytes, mime, last_partial_text, last_partial_ms, last_partial_bytes_len)
  };

  if is_final {
    let now = now_ms().unwrap_or(0);
    if let Some(text) = last_partial_text {
      if last_partial_bytes_len == bytes.len() && now.saturating_sub(last_partial_ms) <= 2000 {
        let event_type = "voice.transcription.final";
        emit_server_event_app(&app, &json!({
          "type": event_type,
          "payload": { "sessionId": session_id, "text": text }
        }))?;
        return Ok(());
      }
    }
  }

  let app_handle = app.clone();
  let session_id_clone = session_id.clone();
  let model_name = if model.trim().is_empty() {
    "deepdml/faster-whisper-large-v3-turbo-ct2".to_string()
  } else {
    model.trim().to_string()
  };
  let base_url_clone = base_url.clone();
  let audio_mime_clone = mime.clone();
  let api_key_clone = api_key.clone();
  let language_clone = language.clone();
  let bytes_len = bytes.len();
  let is_final_call = is_final;

  tauri::async_runtime::spawn(async move {
    let result = transcribe_audio(
      &base_url_clone,
      api_key_clone.as_deref(),
      &model_name,
      language_clone.as_deref(),
      &audio_mime_clone,
      bytes
    ).await;

    match result {
      Ok(text) => {
        let event_type = if is_final_call { "voice.transcription.final" } else { "voice.transcription.partial" };
        if !is_final_call {
          if let Ok(mut guard) = app_handle.state::<AppState>().voice.buffers.lock() {
            if let Some(entry) = guard.get_mut(&session_id_clone) {
              entry.last_partial_text = Some(text.clone());
              entry.last_partial_ms = now_ms().unwrap_or(0);
              entry.last_partial_bytes_len = bytes_len;
            }
          }
        }
        let _ = emit_server_event_app(&app_handle, &json!({
          "type": event_type,
          "payload": { "sessionId": session_id_clone, "text": text }
        }));
      }
      Err(message) => {
        if let Ok(mut guard) = app_handle.state::<AppState>().voice.buffers.lock() {
          guard.remove(&session_id_clone);
        }
        let _ = emit_server_event_app(&app_handle, &json!({
          "type": "voice.transcription.error",
          "payload": { "sessionId": session_id_clone, "message": message }
        }));
      }
    }
  });

  Ok(())
}

fn build_silence_wav_16k_mono(duration_ms: u32) -> Vec<u8> {
  // Minimal PCM WAV (16-bit, 16kHz, mono) filled with silence.
  let sample_rate: u32 = 16_000;
  let channels: u16 = 1;
  let bits_per_sample: u16 = 16;
  let bytes_per_sample: u16 = bits_per_sample / 8;
  let num_samples: u32 = (sample_rate * duration_ms) / 1000;
  let data_len: u32 = num_samples * channels as u32 * bytes_per_sample as u32;

  let mut out = Vec::with_capacity(44 + data_len as usize);
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&(36 + data_len).to_le_bytes());
  out.extend_from_slice(b"WAVE");
  out.extend_from_slice(b"fmt ");
  out.extend_from_slice(&16u32.to_le_bytes()); // PCM header size
  out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
  out.extend_from_slice(&channels.to_le_bytes());
  out.extend_from_slice(&sample_rate.to_le_bytes());
  let byte_rate = sample_rate * channels as u32 * bytes_per_sample as u32;
  out.extend_from_slice(&byte_rate.to_le_bytes());
  let block_align = channels * bytes_per_sample;
  out.extend_from_slice(&block_align.to_le_bytes());
  out.extend_from_slice(&bits_per_sample.to_le_bytes());
  out.extend_from_slice(b"data");
  out.extend_from_slice(&data_len.to_le_bytes());
  out.resize(44 + data_len as usize, 0u8);
  out
}

fn try_start_warmup(state: &AppState, base_url: &str, model: &str) -> bool {
  let key = (base_url.trim().to_string(), model.trim().to_string());
  if key.0.is_empty() || key.1.is_empty() {
    return false;
  }
  let mut in_flight = state.voice.warmup_in_flight.lock().unwrap();
  if *in_flight {
    return false;
  }
  let last_ok = state.voice.warmup_last_success_key.lock().unwrap();
  if last_ok.as_ref() == Some(&key) {
    return false;
  }
  *in_flight = true;
  true
}

fn finish_warmup(state: &AppState) {
  if let Ok(mut in_flight) = state.voice.warmup_in_flight.lock() {
    *in_flight = false;
  }
}

fn mark_warmup_success(state: &AppState, base_url: &str, model: &str) {
  let key = (base_url.trim().to_string(), model.trim().to_string());
  if key.0.is_empty() || key.1.is_empty() {
    return;
  }
  if let Ok(mut last_ok) = state.voice.warmup_last_success_key.lock() {
    *last_ok = Some(key);
  }
}

fn transcribe_audio_blocking(
  base_url: &str,
  api_key: Option<&str>,
  model: &str,
  audio_mime: &str,
  bytes: Vec<u8>
) -> Result<(), String> {
  if bytes.is_empty() {
    return Err("[voice.warmup] audio buffer is empty".to_string());
  }
  let url = build_transcription_url(base_url)?;
  let client = reqwest::blocking::Client::builder()
    .timeout(std::time::Duration::from_secs(240))
    .build()
    .map_err(|e| format!("[voice.warmup] failed to build http client: {e}"))?;

  let filename = format!("audio.{}", guess_extension_from_mime(audio_mime));
  let mut part = reqwest::blocking::multipart::Part::bytes(bytes).file_name(filename);
  let mime_raw = audio_mime.trim();
  if !mime_raw.is_empty() {
    if mime_raw.parse::<mime::Mime>().is_ok() {
      part = part.mime_str(mime_raw).map_err(|e| format!("[voice.warmup] invalid mime '{mime_raw}': {e}"))?;
    }
  }

  let form = reqwest::blocking::multipart::Form::new()
    .part("file", part)
    .text("model", model.to_string());

  let mut req = client.post(url).multipart(form);
  if let Some(key) = api_key {
    if !key.trim().is_empty() {
      req = req.bearer_auth(key.trim());
    }
  }

  let resp = req.send().map_err(|e| {
    if e.is_timeout() {
      "[voice.warmup] request timed out (server may still be loading model)".to_string()
    } else {
      format!("[voice.warmup] request failed: {e}")
    }
  })?;

  if !resp.status().is_success() {
    let status = resp.status();
    let body = resp.text().unwrap_or_default();
    return Err(format!("[voice.warmup] http {status}: {body}"));
  }
  Ok(())
}

// ============ Scheduled Tasks Commands ============

#[tauri::command]
fn db_scheduled_task_create(state: tauri::State<'_, AppState>, params: CreateScheduledTaskParams) -> Result<ScheduledTask, String> {
  let now = chrono::Utc::now().timestamp_millis();
  let next_run = scheduler::calculate_next_run(&params.schedule, now)
    .ok_or_else(|| format!("[db_scheduled_task_create] Invalid schedule format: {}", params.schedule))?;
  let is_recurring = scheduler::is_recurring_schedule(&params.schedule);
  
  state.db.create_scheduled_task(&params, next_run, is_recurring)
    .map_err(|e| format!("[db_scheduled_task_create] {}", e))
}

#[tauri::command]
fn db_scheduled_task_list(state: tauri::State<'_, AppState>, include_disabled: Option<bool>) -> Result<Vec<ScheduledTask>, String> {
  state.db.list_scheduled_tasks(include_disabled.unwrap_or(true))
    .map_err(|e| format!("[db_scheduled_task_list] {}", e))
}

#[tauri::command]
fn db_scheduled_task_get(state: tauri::State<'_, AppState>, id: String) -> Result<Option<ScheduledTask>, String> {
  state.db.get_scheduled_task(&id)
    .map_err(|e| format!("[db_scheduled_task_get] {}", e))
}

#[tauri::command]
fn db_scheduled_task_update(state: tauri::State<'_, AppState>, id: String, params: UpdateScheduledTaskParams) -> Result<bool, String> {
  // If schedule is being updated, recalculate next_run
  let mut final_params = params.clone();
  if let Some(ref schedule) = params.schedule {
    let now = chrono::Utc::now().timestamp_millis();
    let next_run = scheduler::calculate_next_run(schedule, now)
      .ok_or_else(|| format!("[db_scheduled_task_update] Invalid schedule format: {}", schedule))?;
    final_params.next_run = Some(next_run);
    final_params.is_recurring = Some(scheduler::is_recurring_schedule(schedule));
  }
  
  state.db.update_scheduled_task(&id, &final_params)
    .map_err(|e| format!("[db_scheduled_task_update] {}", e))
}

#[tauri::command]
fn db_scheduled_task_delete(state: tauri::State<'_, AppState>, id: String) -> Result<bool, String> {
  state.db.delete_scheduled_task(&id)
    .map_err(|e| format!("[db_scheduled_task_delete] {}", e))
}

#[tauri::command]
fn client_event(app: tauri::AppHandle, state: tauri::State<'_, AppState>, event: Value) -> Result<(), String> {
  let event_type = event
    .get("type")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "[client_event] Missing event.type".to_string())?;

  // Log user actions (skip noisy events)
  let noisy = ["session.list", "session.history", "settings.get", "models.get", "llm.providers.get", "skills.get"];
  if !noisy.contains(&event_type) {
    eprintln!("[event] {}", event_type);
  }

  match event_type {
    "voice.check" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[voice.check] missing payload".to_string())?;
      let base_url = payload.get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      let api_key = payload.get("apiKey").and_then(|v| v.as_str()).map(|s| s.to_string());
      let app_handle = app.clone();
      std::thread::spawn(move || {
        let (available, error) = check_voice_server_status_blocking(&base_url, api_key.as_deref())
          .unwrap_or((false, Some("Healthcheck failed".to_string())));

        if let Ok(mut last_guard) = app_handle.state::<AppState>().voice.last_status.lock() {
          *last_guard = Some(available);
        }

        let _ = emit_server_event_app(&app_handle, &json!({
          "type": "voice.server.status",
          "payload": { "available": available, "error": error }
        }));
      });
      Ok(())
    }

    "voice.preload" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[voice.preload] missing payload".to_string())?;
      let base_url = payload.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").to_string();
      let model = payload.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
      let api_key = payload.get("apiKey").and_then(|v| v.as_str()).map(|s| s.to_string());

      if !try_start_warmup(state.inner(), &base_url, &model) {
        return Ok(());
      }

      let app_handle = app.clone();
      std::thread::spawn(move || {
        // Run a tiny transcription to force model load on server.
        let wav = build_silence_wav_16k_mono(800);
        let res = transcribe_audio_blocking(
          &base_url,
          api_key.as_deref(),
          model.trim(),
          "audio/wav",
          wav
        );
        match res {
          Ok(()) => {
            // Record successful warmup so we can skip duplicate warmups later.
            let state: tauri::State<'_, AppState> = app_handle.state();
            mark_warmup_success(state.inner(), &base_url, model.trim());
          }
          Err(_) => {}
        }

        // Mark warmup complete
        let state: tauri::State<'_, AppState> = app_handle.state();
        finish_warmup(state.inner());
      });

      Ok(())
    }

    "open.external" => {
      let payload = event
        .get("payload")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "[client_event] open.external payload is missing/invalid".to_string())?;
      let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "[client_event] open.external payload.url is missing".to_string())?;
      if let Err(error) = open_target(url) {
        emit_server_event_app(
          &app,
          &json!({ "type": "runner.error", "payload": { "message": format!("Failed to open external URL: {error}") } }),
        )?;
      }
      Ok(())
    }

    // Session list - handled directly from Rust DB
    "session.list" => {
      let sessions = state.db.list_sessions()
        .map_err(|e| format!("[session.list] {}", e))?;
      emit_server_event_app(&app, &json!({
        "type": "session.list",
        "payload": { "sessions": sessions }
      }))?;
      Ok(())
    }

    // Session history - handled directly from Rust DB
    "session.history" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[session.history] missing payload".to_string())?;
      let session_id = payload.get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "[session.history] missing sessionId".to_string())?;
      
      match state.db.get_session_history(session_id) {
        Ok(Some(history)) => {
          emit_server_event_app(&app, &json!({
            "type": "session.history",
            "payload": {
              "sessionId": history.session.id,
              "status": history.session.status,
              "messages": history.messages,
              "inputTokens": history.session.input_tokens,
              "outputTokens": history.session.output_tokens,
              "todos": history.todos,
              "model": history.session.model,
              "fileChanges": history.file_changes,
              "hasMore": false,
              "page": "initial"
            }
          }))?;
        }
        Ok(None) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": "Session not found" }
          }))?;
        }
        Err(e) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": format!("Failed to get session history: {}", e) }
          }))?;
        }
      }
      Ok(())
    }

    // Session delete - handled in Rust
    "session.delete" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[session.delete] missing payload".to_string())?;
      let session_id = payload.get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "[session.delete] missing sessionId".to_string())?;
      
      state.db.delete_session(session_id)
        .map_err(|e| format!("[session.delete] {}", e))?;
      
      emit_server_event_app(&app, &json!({
        "type": "session.deleted",
        "payload": { "sessionId": session_id }
      }))?;
      
      // Also send updated session list
      let sessions = state.db.list_sessions()
        .map_err(|e| format!("[session.delete] list failed: {}", e))?;
      emit_server_event_app(&app, &json!({
        "type": "session.list",
        "payload": { "sessions": sessions }
      }))?;
      Ok(())
    }

    // Session pin - handled in Rust
    "session.pin" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[session.pin] missing payload".to_string())?;
      let session_id = payload.get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "[session.pin] missing sessionId".to_string())?;
      let is_pinned = payload.get("isPinned")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
      
      state.db.set_pinned(session_id, is_pinned)
        .map_err(|e| format!("[session.pin] {}", e))?;
      
      // Send updated session list
      let sessions = state.db.list_sessions()
        .map_err(|e| format!("[session.pin] list failed: {}", e))?;
      emit_server_event_app(&app, &json!({
        "type": "session.list",
        "payload": { "sessions": sessions }
      }))?;
      Ok(())
    }

    // Code Sandbox - execute JS/Python in Rust
    "sandbox.execute" => {
      let payload = event.get("payload").ok_or_else(|| "[sandbox.execute] missing payload".to_string())?;
      let code = payload.get("code").and_then(|v| v.as_str())
        .ok_or_else(|| "[sandbox.execute] missing code".to_string())?;
      let language = payload.get("language").and_then(|v| v.as_str()).unwrap_or("javascript");
      let cwd = payload.get("cwd").and_then(|v| v.as_str()).unwrap_or("/tmp");
      let timeout_ms = payload.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(5000);
      let request_id = payload.get("requestId").and_then(|v| v.as_str()).map(String::from);
      
      let result = sandbox::execute_code(code, language, cwd, timeout_ms);
      
      emit_server_event_app(&app, &json!({
        "type": "sandbox.result",
        "payload": {
          "requestId": request_id,
          "result": result
        }
      }))?;
      Ok(())
    }

    // LLM operations - forward to sidecar
    "session.start" | "session.stop" | "permission.response" => {
      send_to_sidecar(app, state.inner(), &event)
    }

    // message.edit - enrich with session data and messages from DB for sidecar to restore
    "message.edit" => {
      let payload = event.get("payload").ok_or_else(|| "[message.edit] missing payload".to_string())?;
      let session_id = payload.get("sessionId").and_then(|v| v.as_str())
        .ok_or_else(|| "[message.edit] missing sessionId".to_string())?;
      let message_index = payload.get("messageIndex").and_then(|v| v.as_u64())
        .ok_or_else(|| "[message.edit] missing messageIndex".to_string())? as usize;
      
      eprintln!("[message.edit] Looking up session: {}, truncating after index {}", session_id, message_index);
      
      // Truncate history in DB first (before sending to sidecar)
      if let Err(e) = state.db.truncate_history_after(session_id, message_index) {
        eprintln!("[message.edit] Failed to truncate history in DB: {}", e);
      }
      
      // Get session history from DB (after truncation) to provide full context to sidecar
      match state.db.get_session_history(session_id) {
        Ok(Some(history)) => {
          eprintln!("[message.edit] Found session: title='{}', messages={} (after truncation)", 
            history.session.title, history.messages.len());
          
          // Enrich the event with session data AND message history
          let enriched_event = json!({
            "type": "message.edit",
            "payload": {
              "sessionId": session_id,
              "messageIndex": message_index,
              "newPrompt": payload.get("newPrompt"),
              // Session data for restoration in sidecar
              "sessionData": {
                "title": history.session.title,
                "cwd": history.session.cwd,
                "model": history.session.model,
                "allowedTools": history.session.allowed_tools,
                "temperature": history.session.temperature
              },
              // Message history for LLM context (already truncated)
              "messages": history.messages,
              "todos": history.todos
            }
          });
          send_to_sidecar(app, state.inner(), &enriched_event)
        }
        Ok(None) => {
          eprintln!("[message.edit] Session {} NOT FOUND in DB!", session_id);
          send_to_sidecar(app, state.inner(), &event)
        }
        Err(e) => {
          eprintln!("[message.edit] DB error: {}", e);
          send_to_sidecar(app, state.inner(), &event)
        }
      }
    }

    // session.continue - enrich with session data and messages from DB for sidecar to restore
    "session.continue" => {
      let payload = event.get("payload").ok_or_else(|| "[session.continue] missing payload".to_string())?;
      let session_id = payload.get("sessionId").and_then(|v| v.as_str())
        .ok_or_else(|| "[session.continue] missing sessionId".to_string())?;
      
      eprintln!("[session.continue] Looking up session: {}", session_id);
      
      // Get session history from DB to provide full context to sidecar
      match state.db.get_session_history(session_id) {
        Ok(Some(history)) => {
          eprintln!("[session.continue] Found session: title='{}', cwd={:?}, model={:?}, messages={}", 
            history.session.title, history.session.cwd, history.session.model, history.messages.len());
          
          // Enrich the event with session data AND message history
          let enriched_event = json!({
            "type": "session.continue",
            "payload": {
              "sessionId": session_id,
              "prompt": payload.get("prompt").and_then(|v| v.as_str()).unwrap_or(""),
              // Session data for restoration in sidecar
              "sessionData": {
                "title": history.session.title,
                "cwd": history.session.cwd,
                "model": history.session.model,
                "allowedTools": history.session.allowed_tools,
                "temperature": history.session.temperature
              },
              // Message history for LLM context
              "messages": history.messages,
              "todos": history.todos
            }
          });
          send_to_sidecar(app, state.inner(), &enriched_event)
        }
        Ok(None) => {
          eprintln!("[session.continue] Session {} NOT FOUND in DB!", session_id);
          // Still forward - sidecar will return "Unknown session"
          send_to_sidecar(app, state.inner(), &event)
        }
        Err(e) => {
          eprintln!("[session.continue] DB error: {}", e);
          send_to_sidecar(app, state.inner(), &event)
        }
      }
    }

    // Settings - handled in Rust DB (with fallback to sidecar for migration)
    "settings.get" => {
      match state.db.get_api_settings() {
        Ok(Some(settings)) => {
          emit_server_event_app(&app, &json!({
            "type": "settings.loaded",
            "payload": { "settings": settings }
          }))?;
          Ok(())
        }
        Ok(None) => {
          // No settings in DB yet - forward to sidecar (will migrate on save)
          send_to_sidecar(app, state.inner(), &event)
        }
        Err(e) => {
          eprintln!("[settings.get] DB error: {}, falling back to sidecar", e);
          send_to_sidecar(app, state.inner(), &event)
        }
      }
    }

    "settings.save" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[settings.save] missing payload".to_string())?;
      let settings: ApiSettings = serde_json::from_value(payload.get("settings").cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("[settings.save] invalid settings: {}", e))?;
      
      state.db.save_api_settings(&settings)
        .map_err(|e| format!("[settings.save] {}", e))?;
      
      emit_server_event_app(&app, &json!({
        "type": "settings.loaded",
        "payload": { "settings": settings }
      }))?;
      
      // Also forward to sidecar so it has updated settings in memory
      send_to_sidecar(app, state.inner(), &event)
    }

    // LLM Providers - always handled in Rust DB
    "llm.providers.get" => {
      let settings = state.db.get_llm_provider_settings()
        .map_err(|e| format!("[llm.providers.get] {}", e))?;
      
      eprintln!("[providers] {} providers, {} models", settings.providers.len(), settings.models.len());
      
      emit_server_event_app(&app, &json!({
        "type": "llm.providers.loaded",
        "payload": { "settings": settings }
      }))?;
      Ok(())
    }

    "llm.providers.save" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[llm.providers.save] missing payload".to_string())?;
      let settings: LLMProviderSettings = serde_json::from_value(payload.get("settings").cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("[llm.providers.save] invalid settings: {}", e))?;
      
      state.db.save_llm_provider_settings(&settings)
        .map_err(|e| format!("[llm.providers.save] {}", e))?;
      
      emit_server_event_app(&app, &json!({
        "type": "llm.providers.saved",
        "payload": { "settings": settings }
      }))?;
      
      // Also forward to sidecar so it has updated settings in memory
      send_to_sidecar(app, state.inner(), &event)
    }

    // Forward other LLM-related events to sidecar
    "models.get" | "llm.models.test" | "llm.models.fetch" | "llm.models.check" |
    "skills.get" | "skills.refresh" | "skills.toggle" | "skills.set-marketplace" => {
      send_to_sidecar(app, state.inner(), &event)
    }

    // Scheduler default model
    "scheduler.default_model.get" => {
      let model = state.db.get_scheduler_default_model()
        .map_err(|e| format!("[scheduler.default_model.get] {}", e))?;
      
      emit_server_event_app(&app, &json!({
        "type": "scheduler.default_model.loaded",
        "payload": { "modelId": model }
      }))?;
      Ok(())
    }

    "scheduler.default_model.set" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[scheduler.default_model.set] missing payload".to_string())?;
      let model_id = payload.get("modelId").and_then(|v| v.as_str())
        .ok_or_else(|| "[scheduler.default_model.set] missing modelId".to_string())?;

      state.db.set_scheduler_default_model(model_id)
        .map_err(|e| format!("[scheduler.default_model.set] {}", e))?;

      eprintln!("[scheduler] Default model set: {}", model_id);

      emit_server_event_app(&app, &json!({
        "type": "scheduler.default_model.loaded",
        "payload": { "modelId": model_id }
      }))?;
      Ok(())
    }

    // Scheduler default temperature
    "scheduler.default_temperature.get" => {
      let temperature = state.db.get_setting("scheduler_default_temperature")
        .map_err(|e| format!("[scheduler.default_temperature.get] {}", e))?
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.3);
      let send_temperature = state.db.get_setting("scheduler_default_send_temperature")
        .map_err(|e| format!("[scheduler.default_temperature.get] {}", e))?
        .map(|s| s == "true")
        .unwrap_or(true);

      emit_server_event_app(&app, &json!({
        "type": "scheduler.default_temperature.loaded",
        "payload": { "temperature": temperature, "sendTemperature": send_temperature }
      }))?;
      Ok(())
    }

    "scheduler.default_temperature.set" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[scheduler.default_temperature.set] missing payload".to_string())?;
      let temperature = payload.get("temperature").and_then(|v| v.as_f64())
        .ok_or_else(|| "[scheduler.default_temperature.set] missing temperature".to_string())?;
      let send_temperature = payload.get("sendTemperature").and_then(|v| v.as_bool())
        .unwrap_or(true);

      state.db.set_setting("scheduler_default_temperature", &temperature.to_string())
        .map_err(|e| format!("[scheduler.default_temperature.set] {}", e))?;
      state.db.set_setting("scheduler_default_send_temperature", &send_temperature.to_string())
        .map_err(|e| format!("[scheduler.default_temperature.set] {}", e))?;

      eprintln!("[scheduler] Default temperature set: {} (send: {})", temperature, send_temperature);

      emit_server_event_app(&app, &json!({
        "type": "scheduler.default_temperature.loaded",
        "payload": { "temperature": temperature, "sendTemperature": send_temperature }
      }))?;
      Ok(())
    }

    // Scheduled Tasks - handled in Rust
    "task.create" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[task.create] missing payload".to_string())?;
      let params: CreateScheduledTaskParams = serde_json::from_value(payload.clone())
        .map_err(|e| format!("[task.create] invalid params: {}", e))?;
      
      let now = chrono::Utc::now().timestamp_millis();
      let next_run = scheduler::calculate_next_run(&params.schedule, now)
        .ok_or_else(|| format!("[task.create] Invalid schedule format: {}", params.schedule))?;
      let is_recurring = scheduler::is_recurring_schedule(&params.schedule);
      
      match state.db.create_scheduled_task(&params, next_run, is_recurring) {
        Ok(task) => {
          emit_server_event_app(&app, &json!({
            "type": "task.created",
            "payload": { "task": task }
          }))?;
        }
        Err(e) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": format!("Failed to create task: {}", e) }
          }))?;
        }
      }
      Ok(())
    }

    "task.list" => {
      match state.db.list_scheduled_tasks(true) {
        Ok(tasks) => {
          emit_server_event_app(&app, &json!({
            "type": "task.list",
            "payload": { "tasks": tasks }
          }))?;
        }
        Err(e) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": format!("Failed to list tasks: {}", e) }
          }))?;
        }
      }
      Ok(())
    }

    "task.update" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[task.update] missing payload".to_string())?;
      let task_id = payload.get("taskId").and_then(|v| v.as_str())
        .ok_or_else(|| "[task.update] missing taskId".to_string())?;
      let params: UpdateScheduledTaskParams = serde_json::from_value(
        payload.get("params").cloned().unwrap_or(serde_json::Value::Object(Default::default()))
      ).map_err(|e| format!("[task.update] invalid params: {}", e))?;
      
      // If schedule is being updated, recalculate next_run
      let mut final_params = params.clone();
      if let Some(ref schedule) = params.schedule {
        let now = chrono::Utc::now().timestamp_millis();
        if let Some(next_run) = scheduler::calculate_next_run(schedule, now) {
          final_params.next_run = Some(next_run);
          final_params.is_recurring = Some(scheduler::is_recurring_schedule(schedule));
        }
      }
      
      match state.db.update_scheduled_task(task_id, &final_params) {
        Ok(updated) => {
          emit_server_event_app(&app, &json!({
            "type": "task.updated",
            "payload": { "taskId": task_id, "updated": updated }
          }))?;
        }
        Err(e) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": format!("Failed to update task: {}", e) }
          }))?;
        }
      }
      Ok(())
    }

    "task.delete" => {
      let payload = event.get("payload")
        .ok_or_else(|| "[task.delete] missing payload".to_string())?;
      let task_id = payload.get("taskId").and_then(|v| v.as_str())
        .ok_or_else(|| "[task.delete] missing taskId".to_string())?;
      
      match state.db.delete_scheduled_task(task_id) {
        Ok(deleted) => {
          emit_server_event_app(&app, &json!({
            "type": "task.deleted",
            "payload": { "taskId": task_id, "deleted": deleted }
          }))?;
        }
        Err(e) => {
          emit_server_event_app(&app, &json!({
            "type": "runner.error",
            "payload": { "message": format!("Failed to delete task: {}", e) }
          }))?;
        }
      }
      Ok(())
    }

    "task.start" | "task.stop" => {
      // These are handled by scheduler service automatically
      Ok(())
    }

    _ => {
      // Forward unknown events to sidecar
      send_to_sidecar(app, state.inner(), &event)
    }
  }
}

fn migrate_json_to_db(db: &Database, user_data_dir: &PathBuf) {
  // Migrate api-settings.json → DB
  let api_settings_path = user_data_dir.join("api-settings.json");
  if api_settings_path.exists() {
    if let Ok(None) = db.get_api_settings() {
      // DB is empty, migrate from JSON
      if let Ok(content) = fs::read_to_string(&api_settings_path) {
        if let Ok(settings) = serde_json::from_str::<ApiSettings>(&content) {
          if let Err(e) = db.save_api_settings(&settings) {
            eprintln!("[migrate] Failed to save api settings: {}", e);
          } else {
            eprintln!("[migrate] Migrated api-settings.json to DB");
          }
        }
      }
    }
  }

  // Migrate llm-providers-settings.json → DB
  let llm_providers_path = user_data_dir.join("llm-providers-settings.json");
  if llm_providers_path.exists() {
    if let Ok(settings) = db.get_llm_provider_settings() {
      if settings.providers.is_empty() {
        // DB is empty, migrate from JSON
        if let Ok(content) = fs::read_to_string(&llm_providers_path) {
          if let Ok(json_settings) = serde_json::from_str::<Value>(&content) {
            // Parse JSON structure
            let mut providers: Vec<LLMProvider> = Vec::new();
            let mut models: Vec<LLMModel> = Vec::new();
            let now = chrono::Utc::now().timestamp_millis();

            if let Some(json_providers) = json_settings.get("providers").and_then(|v| v.as_array()) {
              for p in json_providers {
                let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if id.is_empty() { continue; }

                providers.push(LLMProvider {
                  id: id.clone(),
                  name: p.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string(),
                  provider_type: p.get("type").and_then(|v| v.as_str()).unwrap_or("openai").to_string(),
                  base_url: p.get("baseUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
                  api_key: p.get("apiKey").and_then(|v| v.as_str()).map(|s| s.to_string()),
                  enabled: p.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                  config: None,
                  created_at: now,
                  updated_at: now,
                });
              }
            }

            if let Some(json_models) = json_settings.get("models").and_then(|v| v.as_array()) {
              for m in json_models {
                let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if id.is_empty() { continue; }

                models.push(LLMModel {
                  id: id.clone(),
                  provider_id: m.get("providerId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                  name: m.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string(),
                  enabled: m.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                  config: None,
                });
              }
            }

            let migrated_settings = LLMProviderSettings { providers, models };
            if let Err(e) = db.save_llm_provider_settings(&migrated_settings) {
              eprintln!("[migrate] Failed to save llm providers: {}", e);
            } else {
              eprintln!("[migrate] Migrated llm-providers.json to DB ({} providers, {} models)", 
                migrated_settings.providers.len(), migrated_settings.models.len());
            }
          }
        }
      }
    }
  }
}

/// Migrate data from old app directories to new ValeDesk directory
/// Checks: localdesk, LocalDesk, ValeraDesk (in order of priority)
fn migrate_from_localdesk() {
  let new_dir = match app_data_dir() {
    Ok(d) => d,
    Err(_) => return,
  };
  
  // Skip if new dir already has sessions.db with actual data
  let new_db_path = new_dir.join("sessions.db");
  if new_db_path.exists() {
    // Check if the file has meaningful size (> 4KB means it has data)
    if let Ok(meta) = fs::metadata(&new_db_path) {
      if meta.len() > 4096 {
        return; // Already has data, skip migration
      }
    }
  }
  
  // Try old directories in order of likelihood
  let old_dirs = get_old_app_dirs();
  
  for old_dir in old_dirs {
    if !old_dir.exists() {
      continue;
    }
    
    let old_db = old_dir.join("sessions.db");
    if !old_db.exists() {
      continue;
    }
    
    // Check if old db has meaningful data
    if let Ok(meta) = fs::metadata(&old_db) {
      if meta.len() <= 4096 {
        continue; // Empty database, skip
      }
    }
    
    eprintln!("[migration] Found old data at {}", old_dir.display());
    eprintln!("[migration] Migrating to {}", new_dir.display());
    
    // Create new directory
    if let Err(e) = fs::create_dir_all(&new_dir) {
      eprintln!("[migration] Failed to create new dir: {e}");
      return;
    }
    
    // Copy all files from old to new
    let entries = match fs::read_dir(&old_dir) {
      Ok(e) => e,
      Err(e) => {
        eprintln!("[migration] Failed to read old dir: {e}");
        return;
      }
    };
    
    for entry in entries.flatten() {
      let src = entry.path();
      let file_name = entry.file_name();
      let dst = new_dir.join(&file_name);
      
      if src.is_file() {
        if let Err(e) = fs::copy(&src, &dst) {
          eprintln!("[migration] Failed to copy {}: {e}", file_name.to_string_lossy());
        } else {
          eprintln!("[migration] Copied {}", file_name.to_string_lossy());
        }
      }
    }
    
    eprintln!("[migration] Migration complete!");
    return; // Done, don't check other old dirs
  }
}

/// Get list of old app data directories to check for migration
fn get_old_app_dirs() -> Vec<PathBuf> {
  // Old directory names in order of priority
  const OLD_NAMES: &[&str] = &["localdesk", "LocalDesk", "ValeraDesk"];
  
  let mut dirs = Vec::new();
  
  #[cfg(target_os = "windows")]
  {
    if let Ok(appdata) = std::env::var("APPDATA") {
      if !appdata.trim().is_empty() {
        let base = PathBuf::from(appdata);
        for name in OLD_NAMES {
          dirs.push(base.join(name));
        }
      }
    }
  }

  #[cfg(target_os = "macos")]
  {
    if let Ok(home) = home_dir() {
      let base = home.join("Library").join("Application Support");
      for name in OLD_NAMES {
        dirs.push(base.join(name));
      }
    }
  }

  #[cfg(target_os = "linux")]
  {
    let base = if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
      if !xdg.trim().is_empty() {
        Some(PathBuf::from(xdg))
      } else {
        None
      }
    } else {
      None
    };
    
    let base = base.or_else(|| home_dir().ok().map(|h| h.join(".config")));
    
    if let Some(base) = base {
      for name in OLD_NAMES {
        dirs.push(base.join(name));
      }
    }
  }
  
  dirs
}

/// Migrate ~/.localdesk/ to ~/.valera/
fn migrate_dot_localdesk() {
  let home = match home_dir() {
    Ok(h) => h,
    Err(_) => return,
  };
  
  let old_dir = home.join(".localdesk");
  let new_dir = home.join(".valera");
  
  // Skip if old dir doesn't exist
  if !old_dir.exists() {
    return;
  }
  
  // Skip if new dir already has memory.md (already migrated)
  let new_memory = new_dir.join("memory.md");
  if new_memory.exists() {
    return;
  }
  
  eprintln!("[migration] Found old ~/.localdesk/ data");
  eprintln!("[migration] Migrating to ~/.valera/");
  
  // Create new directory
  if let Err(e) = fs::create_dir_all(&new_dir) {
    eprintln!("[migration] Failed to create ~/.valera/: {e}");
    return;
  }
  
  // Copy memory.md if exists
  let old_memory = old_dir.join("memory.md");
  if old_memory.exists() {
    if let Err(e) = fs::copy(&old_memory, &new_memory) {
      eprintln!("[migration] Failed to copy memory.md: {e}");
    } else {
      eprintln!("[migration] Copied memory.md");
    }
  }
  
  // Copy logs directory if exists
  let old_logs = old_dir.join("logs");
  let new_logs = new_dir.join("logs");
  if old_logs.exists() && old_logs.is_dir() {
    if let Err(e) = copy_dir_recursive(&old_logs, &new_logs) {
      eprintln!("[migration] Failed to copy logs: {e}");
    } else {
      eprintln!("[migration] Copied logs directory");
    }
  }
  
  eprintln!("[migration] ~/.valera/ migration complete!");
}

/// Recursively copy a directory
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
  fs::create_dir_all(dst)?;
  for entry in fs::read_dir(src)? {
    let entry = entry?;
    let src_path = entry.path();
    let dst_path = dst.join(entry.file_name());
    if src_path.is_dir() {
      copy_dir_recursive(&src_path, &dst_path)?;
    } else {
      fs::copy(&src_path, &dst_path)?;
    }
  }
  Ok(())
}

fn main() {
  // Migrate data from old LocalDesk directory if needed
  migrate_from_localdesk();
  
  // Migrate ~/.localdesk/ to ~/.valera/
  migrate_dot_localdesk();
  
  // Initialize database
  let user_data_dir = app_data_dir().expect("Failed to get app data dir");
  fs::create_dir_all(&user_data_dir).expect("Failed to create app data dir");
  
  let db_path = user_data_dir.join("sessions.db");
  let db = Database::new(&db_path).expect("Failed to initialize database");

  // Reset any stale "running" sessions to "idle" on app startup
  match db.reset_running_sessions() {
    Ok(count) if count > 0 => eprintln!("[startup] Reset {} stale running sessions to idle", count),
    Err(e) => eprintln!("[startup] Failed to reset running sessions: {}", e),
    _ => {}
  }

  // Migrate JSON settings to DB on first run
  migrate_json_to_db(&db, &user_data_dir);

  let db_arc = Arc::new(db);
  let scheduler = SchedulerService::new(db_arc.clone());

  let app_state = AppState {
    db: db_arc,
    sidecar: SidecarState::default(),
    voice: VoiceState::default(),
    scheduler,
  };

  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .manage(app_state)
    .setup(|app| {
      let app_handle = app.handle().clone();
      std::thread::spawn(move || {
        loop {
          std::thread::sleep(std::time::Duration::from_secs(30));
          let state: tauri::State<'_, AppState> = app_handle.state();
          let settings = match state.db.get_api_settings() {
            Ok(Some(s)) => s,
            _ => continue,
          };
          let voice: Option<VoiceSettings> = settings.voice_settings;
          let Some(voice_settings) = voice else { continue; };
          if voice_settings.base_url.trim().is_empty() { continue; }

          let (available, _error) = check_voice_server_status_blocking(&voice_settings.base_url, voice_settings.api_key.as_deref())
            .unwrap_or((false, None));

          let mut last_guard = state.voice.last_status.lock().unwrap();
          if *last_guard != Some(available) {
            *last_guard = Some(available);
            let _ = emit_server_event_app(&app_handle, &json!({
              "type": "voice.server.status",
              "payload": { "available": available }
            }));
          }
        }
      });
      
      // Start scheduler service
      let state: tauri::State<'_, AppState> = app.state();
      state.scheduler.start(app.handle().clone());
      
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      client_event,
      list_directory,
      read_memory,
      write_memory,
      open_external_url,
      open_path_in_finder,
      open_file,
      get_build_info,
      select_directory,
      generate_session_title,
      get_recent_cwds,
      // Code Sandbox commands
      sandbox_execute_js,
      sandbox_execute_python,
      sandbox_execute,
      // Voice
      transcribe_voice_stream,
      list_voice_models,
      // Database commands - Sessions
      db_session_list,
      db_session_create,
      db_session_get,
      db_session_update,
      db_session_delete,
      db_session_history,
      db_session_pin,
      db_record_message,
      db_update_tokens,
      db_save_todos,
      db_save_file_changes,
      // Database commands - Settings & Providers
      db_get_api_settings,
      db_save_api_settings,
      db_get_llm_providers,
      db_save_llm_providers,
      db_save_provider,
      db_delete_provider,
      db_save_models,
      // Database commands - Scheduled Tasks
      db_scheduled_task_create,
      db_scheduled_task_list,
      db_scheduled_task_get,
      db_scheduled_task_update,
      db_scheduled_task_delete
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

