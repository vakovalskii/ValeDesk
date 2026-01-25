#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)] // TODO: remove after migration complete

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

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

// Revert ShellExt import
// use tauri_plugin_shell::ShellExt; 

// ... inside start_sidecar

  let entry = resolve_sidecar_entry()?;
  
  let mut child_cmd;
  
  #[cfg(debug_assertions)]
  {
     let node_bin = resolve_node_bin()?;
     child_cmd = Command::new(&node_bin);
     child_cmd.arg(entry);
  }
  
  #[cfg(not(debug_assertions))]
  {
      // In prod, entry IS the binary path.
      // We need to resolve it relative to the executable if resolve_sidecar_entry didn't already.
      // Actually let's assume resolve_sidecar_entry handles logic.
      child_cmd = Command::new(entry);
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
            if raw.trim().is_empty() {
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
                eprintln!("[sidecar] Emitting server-event: {}", event.get("type").and_then(|t| t.as_str()).unwrap_or("unknown"));
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

fn send_to_sidecar(app: tauri::AppHandle, sidecar_state: &SidecarState, event: &Value) -> Result<(), String> {
  start_sidecar(app, sidecar_state)?;

  let mut guard = sidecar_state.child.lock().map_err(|_| "[sidecar] state lock poisoned".to_string())?;
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
fn get_recent_cwds(limit: Option<u32>) -> Result<Vec<String>, String> {
  let _ = limit;
  Ok(Vec::new())
}

#[tauri::command]
fn client_event(app: tauri::AppHandle, sidecar: tauri::State<'_, SidecarState>, event: Value) -> Result<(), String> {
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

    _ => {
      // Forward everything else to the Node sidecar.
      send_to_sidecar(app, sidecar.inner(), &event)
    }
  }
}

fn main() {
  tauri::Builder::default()
    .manage(SidecarState::default())
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
      get_recent_cwds
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

