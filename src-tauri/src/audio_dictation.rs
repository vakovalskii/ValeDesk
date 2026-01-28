use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

use crate::audio_models;

#[derive(Default)]
pub struct DictationManager {
  session: Mutex<Option<DictationSession>>,
}

struct DictationSession {
  dictation_id: String,
  child: Child,
  stdin: Option<std::process::ChildStdin>,
  stdout_handle: std::thread::JoinHandle<()>,
  stderr_handle: std::thread::JoinHandle<String>,
  done_emitted: Arc<AtomicBool>,
  had_error: Arc<AtomicBool>,
}

enum SidecarEvent {
  Partial { text: String, unstable: Option<String> },
  Final { text: String, start: Option<f64>, end: Option<f64> },
  AudioLevel { level: f64 },
  Error { code: String, msg: String, context: Value },
  Log { msg: String },
}

fn emit_dictation_event(app: &AppHandle, event: Value) {
  if let Err(error) = crate::emit_server_event_app(app, &event) {
    eprintln!(
      "{}",
      json!({
        "level": "ERROR",
        "event": "audio_dictation_emit_failed",
        "error": error,
        "payload": event,
      })
    );
  }
}

fn emit_done_once(app: &AppHandle, dictation_id: &str, done_emitted: &AtomicBool) {
  if done_emitted
    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
    .is_err()
  {
    return;
  }

  emit_dictation_event(
    app,
    json!({
      "type": "audio.dictation.done",
      "payload": { "dictationId": dictation_id }
    }),
  );
}

fn emit_error(app: &AppHandle, dictation_id: &str, had_error: &AtomicBool, code: &str, message: &str, context: Value) {
  had_error.store(true, Ordering::SeqCst);
  emit_dictation_event(
    app,
    json!({
      "type": "audio.dictation.error",
      "payload": {
        "dictationId": dictation_id,
        "code": code,
        "message": message,
        "context": context
      }
    }),
  );
}

fn resolve_asr_sidecar_entry() -> Result<std::path::PathBuf, String> {
  // Prod/dev: the binary is bundled next to the main executable (via bundle.externalBin).
  let exe = std::env::current_exe().map_err(|e| format!("[audio.dictation] Failed to get current exe: {e}"))?;
  let dir = exe.parent().ok_or_else(|| "[audio.dictation] Failed to get exe parent".to_string())?;

  let entries = std::fs::read_dir(dir).map_err(|e| format!("[audio.dictation] Failed to read resource dir: {e}"))?;
  for entry in entries {
    if let Ok(entry) = entry {
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with("asr-sidecar") {
        return Ok(entry.path());
      }
    }
  }

  Err(format!(
    "[audio.dictation] asr-sidecar binary not found in {}. Build it via scripts/build_asr_sidecar.sh",
    dir.display()
  ))
}

fn parse_sidecar_event_line(line: &str) -> Result<SidecarEvent, String> {
  let v: Value = serde_json::from_str(line)
    .map_err(|e| format!("[audio.dictation] sidecar_invalid_json: {e}; line={line}"))?;

  let obj = v
    .as_object()
    .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: line is not a JSON object; line={line}"))?;

  let t = obj
    .get("t")
    .and_then(|v| v.as_str())
    .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: missing t; line={line}"))?;

  match t {
    "partial" => {
      let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: partial missing text; line={line}"))?
        .to_string();
      let unstable = obj.get("unstable").and_then(|v| v.as_str()).map(|s| s.to_string());
      Ok(SidecarEvent::Partial { text, unstable })
    }
    "final" => {
      let text = obj
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: final missing text; line={line}"))?
        .to_string();
      let start = obj.get("start").and_then(|v| v.as_f64());
      let end = obj.get("end").and_then(|v| v.as_f64());
      Ok(SidecarEvent::Final { text, start, end })
    }
    "audio_level" => {
      let level = obj
        .get("level")
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: audio_level missing level; line={line}"))?;
      Ok(SidecarEvent::AudioLevel { level })
    }
    "log" => {
      let msg = obj
        .get("msg")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
      Ok(SidecarEvent::Log { msg })
    }
    "error" => {
      let code = obj
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: error missing code; line={line}"))?
        .to_string();
      let msg = obj
        .get("msg")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("[audio.dictation] sidecar_invalid_schema: error missing msg; line={line}"))?
        .to_string();
      let context = obj.get("context").cloned().unwrap_or_else(|| json!({}));
      Ok(SidecarEvent::Error { code, msg, context })
    }
    other => Err(format!(
      "[audio.dictation] sidecar_invalid_schema: unknown t value: {other}; line={line}"
    )),
  }
}

fn cleanup_finished_session(mut session: DictationSession) {
  let _ = session.child.wait();
  let _ = session.stdout_handle.join();
  let _ = session.stderr_handle.join();
}

pub fn dictation_start(app: &AppHandle, manager: &DictationManager, dictation_id: &str) -> Result<(), String> {
  if dictation_id.trim().is_empty() {
    return Err("[audio.dictation.start] dictationId is required".to_string());
  }

  // Reap a previously finished session if needed; reject if one is still running.
  if let Some(old) = {
    let mut guard = manager.session.lock().map_err(|_| "[audio.dictation] state lock poisoned".to_string())?;
    match guard.as_mut() {
      None => None,
      Some(existing) => match existing.child.try_wait() {
        Ok(Some(_)) => guard.take(),
        Err(_) => guard.take(),
        Ok(None) => {
          emit_dictation_event(
            app,
            json!({
              "type": "audio.dictation.error",
              "payload": {
                "dictationId": dictation_id,
                "code": "invalid_state",
                "message": "Dictation is already running",
                "context": { "activeDictationId": existing.dictation_id }
              }
            }),
          );
          return Ok(());
        }
      },
    }
  } {
    cleanup_finished_session(old);
  }

  // Validate models readiness (fail fast).
  let status = audio_models::get_status(&audio_models::REQUIRED_MODEL_KEYS).map_err(|e| {
    format!(
      "[audio.dictation.start] Failed to check audio model status: {} ({})",
      e.message, e.code
    )
  })?;
  if !matches!(status, audio_models::AudioModelsStatus::Ready { .. }) {
    emit_dictation_event(
      app,
      json!({
        "type": "audio.dictation.error",
        "payload": {
          "dictationId": dictation_id,
          "code": "model_not_ready",
          "message": "Speech models are not ready; download them in Settings → Audio",
          "context": { "status": status }
        }
      }),
    );
    return Ok(());
  }

  let models_dir = audio_models::models_dir()
    .map_err(|e| format!("[audio.dictation.start] Failed to resolve models dir: {} ({})", e.message, e.code))?;

  let sidecar_path = resolve_asr_sidecar_entry()?;
  if !sidecar_path.exists() {
    emit_dictation_event(
      app,
      json!({
        "type": "audio.dictation.error",
        "payload": {
          "dictationId": dictation_id,
          "code": "sidecar_not_found",
          "message": "asr-sidecar binary not found",
          "context": { "expectedPath": sidecar_path.to_string_lossy() }
        }
      }),
    );
    return Ok(());
  }

  let mut cmd = Command::new(&sidecar_path);
  cmd.arg("--models-dir")
    .arg(models_dir.to_string_lossy().to_string())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("[audio.dictation.start] Failed to spawn asr-sidecar: {e}"))?;

  let mut stdin = child.stdin.take().ok_or_else(|| "[audio.dictation.start] Failed to capture stdin".to_string())?;
  let stdout = child.stdout.take().ok_or_else(|| "[audio.dictation.start] Failed to capture stdout".to_string())?;
  let stderr = child.stderr.take().ok_or_else(|| "[audio.dictation.start] Failed to capture stderr".to_string())?;

  let dictation_id_owned = dictation_id.to_string();
  let done_emitted = Arc::new(AtomicBool::new(false));
  let had_error = Arc::new(AtomicBool::new(false));

  // stderr reader -> capture to string
  let stderr_handle = std::thread::spawn(move || {
    let mut buf = String::new();
    let mut reader = BufReader::new(stderr);
    let _ = reader.read_to_string(&mut buf);
    buf
  });

  // stdout reader -> parse NDJSON and emit server events
  let app_for_stdout = app.clone();
  let dictation_id_for_stdout = dictation_id_owned.clone();
  let done_for_stdout = done_emitted.clone();
  let had_error_for_stdout = had_error.clone();
  let stdout_handle = std::thread::spawn(move || {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
      line.clear();
      let bytes = match reader.read_line(&mut line) {
        Ok(n) => n,
        Err(error) => {
          emit_error(
            &app_for_stdout,
            &dictation_id_for_stdout,
            &had_error_for_stdout,
            "sidecar_io_failed",
            "Failed while reading sidecar stdout",
            json!({ "error": error.to_string() }),
          );
          break;
        }
      };
      if bytes == 0 {
        break;
      }

      let trimmed = line.trim_end_matches(&['\r', '\n'][..]).trim();
      if trimmed.is_empty() {
        continue;
      }

      let ev = match parse_sidecar_event_line(trimmed) {
        Ok(e) => e,
        Err(err) => {
          emit_error(
            &app_for_stdout,
            &dictation_id_for_stdout,
            &had_error_for_stdout,
            "sidecar_invalid_json",
            "Failed to parse sidecar stdout line",
            json!({ "error": err, "line": trimmed }),
          );
          break;
        }
      };

      match ev {
        SidecarEvent::Partial { text, unstable } => {
          emit_dictation_event(
            &app_for_stdout,
            json!({
              "type": "audio.dictation.partial",
              "payload": { "dictationId": dictation_id_for_stdout, "text": text, "unstable": unstable }
            }),
          );
        }
        SidecarEvent::Final { text, start, end } => {
          emit_dictation_event(
            &app_for_stdout,
            json!({
              "type": "audio.dictation.final",
              "payload": { "dictationId": dictation_id_for_stdout, "text": text, "start": start, "end": end }
            }),
          );
        }
        SidecarEvent::AudioLevel { level } => {
          emit_dictation_event(
            &app_for_stdout,
            json!({
              "type": "audio.dictation.audio_level",
              "payload": { "dictationId": dictation_id_for_stdout, "level": level }
            }),
          );
        }
        SidecarEvent::Error { code, msg, context } => {
          emit_error(
            &app_for_stdout,
            &dictation_id_for_stdout,
            &had_error_for_stdout,
            &code,
            &msg,
            context,
          );
          break;
        }
        SidecarEvent::Log { .. } => {
          // Intentionally ignored (can be noisy).
        }
      }
    }

    emit_done_once(&app_for_stdout, &dictation_id_for_stdout, &done_for_stdout);
  });

  // Init + mic_start
  let init_cmd = json!({
    "cmd": "init",
    "config": { "sample_rate": 16000, "mode": "mic", "model_key": "asr_tdt_v3" }
  })
  .to_string();
  let start_cmd = json!({ "cmd": "mic_start", "device_id": "default" }).to_string();

  writeln!(stdin, "{init_cmd}").map_err(|e| format!("[audio.dictation.start] Failed to write init to stdin: {e}"))?;
  writeln!(stdin, "{start_cmd}").map_err(|e| format!("[audio.dictation.start] Failed to write mic_start to stdin: {e}"))?;
  stdin.flush().map_err(|e| format!("[audio.dictation.start] Failed to flush stdin: {e}"))?;

  // Store session.
  {
    let mut guard = manager.session.lock().map_err(|_| "[audio.dictation] state lock poisoned".to_string())?;
    *guard = Some(DictationSession {
      dictation_id: dictation_id_owned,
      child,
      stdin: Some(stdin),
      stdout_handle,
      stderr_handle,
      done_emitted,
      had_error,
    });
  }

  Ok(())
}

pub fn dictation_stop(app: &AppHandle, manager: &DictationManager, dictation_id: &str) -> Result<(), String> {
  if dictation_id.trim().is_empty() {
    return Err("[audio.dictation.stop] dictationId is required".to_string());
  }

  let mut session = {
    let mut guard = manager.session.lock().map_err(|_| "[audio.dictation] state lock poisoned".to_string())?;
    let existing = match guard.as_ref() {
      None => {
        // Treat stop as idempotent: user can double-click stop or press Enter multiple times.
        eprintln!(
          "{}",
          json!({
            "level": "WARN",
            "event": "audio_dictation_stop_ignored",
            "reason": "not_running",
            "dictationId": dictation_id,
          })
        );
        return Ok(());
      }
      Some(v) => v,
    };

    if existing.dictation_id != dictation_id {
      return Err(format!(
        "[audio.dictation.stop] dictationId does not match active session (active={})",
        existing.dictation_id
      ));
    }

    guard.take().unwrap()
  };

  let stop_cmd = json!({ "cmd": "mic_stop" }).to_string();
  let mut stdin = session
    .stdin
    .take()
    .ok_or_else(|| "[audio.dictation.stop] sidecar stdin is not available".to_string())?;

  if let Err(error) = writeln!(stdin, "{stop_cmd}") {
    emit_error(
      app,
      dictation_id,
      &session.had_error,
      "sidecar_io_failed",
      "Failed to write mic_stop to sidecar stdin",
      json!({ "error": error.to_string() }),
    );
    let _ = session.child.kill();
    cleanup_finished_session(session);
    return Ok(());
  }
  if let Err(error) = stdin.flush() {
    emit_error(
      app,
      dictation_id,
      &session.had_error,
      "sidecar_io_failed",
      "Failed to flush sidecar stdin",
      json!({ "error": error.to_string() }),
    );
    let _ = session.child.kill();
    cleanup_finished_session(session);
    return Ok(());
  }
  drop(stdin);

  let status = session
    .child
    .wait()
    .map_err(|e| format!("[audio.dictation.stop] Failed waiting for sidecar to exit: {e}"))?;

  let _ = session.stdout_handle.join();
  let stderr_text = session.stderr_handle.join().unwrap_or_default();

  if !status.success() && !session.had_error.load(Ordering::SeqCst) {
    emit_error(
      app,
      dictation_id,
      &session.had_error,
      "sidecar_failed",
      "asr-sidecar exited with non-zero status",
      json!({
        "exitCode": status.code().unwrap_or(-1),
        "stderr": stderr_text
      }),
    );
  }

  emit_done_once(app, dictation_id, &session.done_emitted);
  Ok(())
}

