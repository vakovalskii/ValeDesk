#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)] // TODO: remove after migration complete

mod db;
mod sandbox;

use db::{Database, CreateSessionParams, UpdateSessionParams, Session, SessionHistory, TodoItem, FileChange, LLMProvider, LLMModel, LLMProviderSettings, ApiSettings};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
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
  const APP_DIR: &str = "LocalDesk";

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

fn memory_path() -> Result<PathBuf, String> {
  Ok(home_dir()?.join(".localdesk").join("memory.md"))
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
  if let Ok(p) = std::env::var("LOCALDESK_SIDECAR_ENTRY") {
    if !p.trim().is_empty() {
      return Ok(PathBuf::from(p));
    }
  }

  #[cfg(debug_assertions)]
  {
    // Dev default: run from workspace root (LocalDesk/)
    let candidate = PathBuf::from("dist-sidecar/sidecar/main.js");
    if candidate.exists() {
      return Ok(candidate);
    }
    return Err("dist-sidecar/sidecar/main.js not found. Run npm run transpile:sidecar".to_string());
  }

  #[cfg(not(debug_assertions))]
  {
      // Prod: Look for sidecar binary in the executables directory
      // Name formatting: local-desk-sidecar-<target-triple>
      // For now, we search for a file starting with local-desk-sidecar
      let exe = std::env::current_exe().map_err(|e| format!("[sidecar] Failed to get current exe: {e}"))?;
      let dir = exe.parent().ok_or("[sidecar] Failed to get exe parent")?;
      
      let entries = fs::read_dir(dir).map_err(|e| format!("[sidecar] Failed to read resource dir: {e}"))?;
      for entry in entries {
          if let Ok(entry) = entry {
              let name = entry.file_name().to_string_lossy().to_string();
              if name.starts_with("local-desk-sidecar") {
                  return Ok(entry.path());
              }
          }
      }
      return Err(format!("[sidecar] Sidecar binary not found in {}", dir.display()));
  }
}

fn resolve_node_bin() -> Result<String, String> {
  if let Ok(v) = std::env::var("LOCALDESK_NODE_BIN") {
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

  let mut child = child_cmd
    .env("LOCALDESK_USER_DATA_DIR", user_data_dir.to_string_lossy().to_string())
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
                
                eprintln!("[sidecar] Emitting server-event: {}", event_type);
                if let Err(error) = emit_server_event_app(&app_handle, event) {
                  eprintln!("[sidecar] Failed to emit server-event: {error}");
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
  // In Electron this comes from dist-electron/build-info.json with a fallback to package.json.
  // For Tauri MVP we return Cargo package version and mark commit/time as unknown.
  Ok(BuildInfo {
    version: env!("CARGO_PKG_VERSION").to_string(),
    commit: "unknown".to_string(),
    commit_short: "dev".to_string(),
    build_time: "unknown".to_string(),
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

#[tauri::command]
fn client_event(app: tauri::AppHandle, state: tauri::State<'_, AppState>, event: Value) -> Result<(), String> {
  let event_type = event
    .get("type")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "[client_event] Missing event.type".to_string())?;

  match event_type {
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

    // LLM Providers - handled in Rust DB (with fallback to sidecar for migration)
    "llm.providers.get" => {
      let settings = state.db.get_llm_provider_settings()
        .map_err(|e| format!("[llm.providers.get] {}", e))?;
      
      eprintln!("[llm.providers.get] providers={}, models={}", settings.providers.len(), settings.models.len());
      
      // If DB has providers, use them
      if !settings.providers.is_empty() {
        let payload = json!({
          "type": "llm.providers.loaded",
          "payload": { "settings": settings }
        });
        eprintln!("[llm.providers.get] sending: {}", serde_json::to_string(&payload).unwrap_or_default());
        emit_server_event_app(&app, &payload)?;
        Ok(())
      } else {
        // No providers in DB yet - forward to sidecar (will migrate on save)
        send_to_sidecar(app, state.inner(), &event)
      }
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
    "skills.get" | "skills.refresh" | "skills.toggle" | "skills.set-marketplace" |
    "task.create" | "task.start" | "task.stop" | "task.delete" => {
      send_to_sidecar(app, state.inner(), &event)
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

fn main() {
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

  let app_state = AppState {
    db: Arc::new(db),
    sidecar: SidecarState::default(),
  };

  tauri::Builder::default()
    .manage(app_state)
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
      db_save_models
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

