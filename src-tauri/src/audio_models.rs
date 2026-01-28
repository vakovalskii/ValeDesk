use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static DOWNLOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

pub const REQUIRED_MODEL_KEYS: [&str; 2] = ["asr_tdt_v3", "silero_vad_v6"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelManifest {
  pub models: Vec<ModelSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpec {
  pub key: String,
  pub repo_dirname: String,
  pub model_id: String,
  pub source_page_url: String,
  pub macos: MacosManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacosManifest {
  pub revision_sha: String,
  pub files: Vec<ModelFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFile {
  pub path: String,
  pub download_url: String,
  pub sha256: String,
  pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInstallStatus {
  pub key: String,
  pub repo_dirname: String,
  pub revision_sha: String,
  pub total_files: usize,
  pub present_files: usize,
  pub total_bytes: u64,
  pub present_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
  pub bytes_downloaded: u64,
  pub bytes_total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioModelsError {
  pub code: String,
  pub message: String,
  pub context: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AudioModelsStatus {
  ManifestIncomplete { message: String, missing: Vec<String> },
  NotInstalled {
    models_dir: String,
    total_files: usize,
    present_files: usize,
    total_bytes: u64,
    present_bytes: u64,
    models: Vec<ModelInstallStatus>,
  },
  Ready {
    models_dir: String,
    total_files: usize,
    total_bytes: u64,
    models: Vec<ModelInstallStatus>,
  },
  Error {
    code: String,
    message: String,
    context: Value,
  },
}

#[derive(Debug, Clone)]
struct PendingDownload {
  dest_path: PathBuf,
  download_url: String,
  expected_sha256: String,
  expected_size: u64,
}

pub fn load_manifest() -> Result<ModelManifest, AudioModelsError> {
  let raw = include_str!("../model_manifest.json");
  serde_json::from_str::<ModelManifest>(raw).map_err(|error| AudioModelsError {
    code: "manifest_invalid".to_string(),
    message: "Failed to parse model manifest JSON".to_string(),
    context: json!({ "error": error.to_string() }),
  })
}

pub fn models_dir() -> Result<PathBuf, AudioModelsError> {
  let base = crate::app_data_dir().map_err(|message| AudioModelsError {
    code: "path_resolve_failed".to_string(),
    message,
    context: json!({}),
  })?;

  let dir = base.join("models");
  std::fs::create_dir_all(&dir).map_err(|error| AudioModelsError {
    code: "io_failed".to_string(),
    message: "Failed to create models dir".to_string(),
    context: json!({ "path": dir.to_string_lossy(), "error": error.to_string() }),
  })?;
  Ok(dir)
}

fn repo_dir(repo_dirname: &str) -> Result<PathBuf, AudioModelsError> {
  if repo_dirname.trim().is_empty() {
    return Err(AudioModelsError {
      code: "invalid_args".to_string(),
      message: "repo_dirname is required".to_string(),
      context: json!({ "repo_dirname": repo_dirname }),
    });
  }

  let rel = Path::new(repo_dirname);
  if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
    return Err(AudioModelsError {
      code: "invalid_args".to_string(),
      message: "repo_dirname must be a relative path without '..'".to_string(),
      context: json!({ "repo_dirname": repo_dirname }),
    });
  }

  let root = models_dir()?;
  let dir = root.join(rel);
  std::fs::create_dir_all(&dir).map_err(|error| AudioModelsError {
    code: "io_failed".to_string(),
    message: "Failed to create model repo dir".to_string(),
    context: json!({ "path": dir.to_string_lossy(), "error": error.to_string() }),
  })?;
  Ok(dir)
}

pub fn get_status(required_keys: &[&str]) -> Result<AudioModelsStatus, AudioModelsError> {
  if required_keys.is_empty() {
    return Err(AudioModelsError {
      code: "settings_invalid".to_string(),
      message: "No required models configured".to_string(),
      context: json!({}),
    });
  }

  let manifest = load_manifest()?;
  if manifest.models.is_empty() {
    return Ok(AudioModelsStatus::ManifestIncomplete {
      message: "Model manifest has no models".to_string(),
      missing: vec!["models".to_string()],
    });
  }

  // Ensure every required key exists in the manifest.
  for key in required_keys {
    if !manifest.models.iter().any(|m| m.key == *key) {
      return Err(AudioModelsError {
        code: "manifest_invalid".to_string(),
        message: "Required model key does not exist in manifest".to_string(),
        context: json!({
          "model_key": key,
          "available_keys": manifest.models.iter().map(|m| m.key.clone()).collect::<Vec<_>>(),
        }),
      });
    }
  }

  // Validate manifest required fields for required models.
  let mut missing_fields: Vec<String> = Vec::new();
  for (idx, m) in manifest.models.iter().enumerate() {
    if !required_keys.iter().any(|k| *k == m.key) {
      continue;
    }
    if m.key.trim().is_empty() {
      missing_fields.push(format!("models[{idx}].key"));
    }
    if m.repo_dirname.trim().is_empty() {
      missing_fields.push(format!("models[{idx}].repo_dirname"));
    }
    if m.model_id.trim().is_empty() {
      missing_fields.push(format!("models[{idx}].model_id"));
    }
    if m.source_page_url.trim().is_empty() {
      missing_fields.push(format!("models[{idx}].source_page_url"));
    }
    if m.macos.revision_sha.trim().is_empty() {
      missing_fields.push(format!("models[{idx}].macos.revision_sha"));
    }
    if m.macos.files.is_empty() {
      missing_fields.push(format!("models[{idx}].macos.files"));
    }
  }
  if !missing_fields.is_empty() {
    return Ok(AudioModelsStatus::ManifestIncomplete {
      message: "Model manifest is missing required fields to determine readiness".to_string(),
      missing: missing_fields,
    });
  }

  let root = models_dir()?;
  let mut models: Vec<ModelInstallStatus> = Vec::new();

  let mut total_files: usize = 0;
  let mut present_files: usize = 0;
  let mut total_bytes: u64 = 0;
  let mut present_bytes: u64 = 0;

  for m in &manifest.models {
    if !required_keys.iter().any(|k| *k == m.key) {
      continue;
    }

    let repo_dir = repo_dir(&m.repo_dirname)?;

    let mut model_total_files: usize = 0;
    let mut model_present_files: usize = 0;
    let mut model_total_bytes: u64 = 0;
    let mut model_present_bytes: u64 = 0;

    for f in &m.macos.files {
      model_total_files = model_total_files.saturating_add(1);
      model_total_bytes = model_total_bytes.saturating_add(f.size);

      let rel = Path::new(&f.path);
      if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(AudioModelsError {
          code: "manifest_invalid".to_string(),
          message: "Manifest contains an invalid relative path".to_string(),
          context: json!({ "path": f.path }),
        });
      }

      let expected_path = repo_dir.join(rel);
      if let Ok(meta) = expected_path.metadata() {
        if meta.is_file() && meta.len() == f.size {
          model_present_files = model_present_files.saturating_add(1);
          model_present_bytes = model_present_bytes.saturating_add(f.size);
        }
      }
    }

    total_files = total_files.saturating_add(model_total_files);
    present_files = present_files.saturating_add(model_present_files);
    total_bytes = total_bytes.saturating_add(model_total_bytes);
    present_bytes = present_bytes.saturating_add(model_present_bytes);

    models.push(ModelInstallStatus {
      key: m.key.clone(),
      repo_dirname: m.repo_dirname.clone(),
      revision_sha: m.macos.revision_sha.clone(),
      total_files: model_total_files,
      present_files: model_present_files,
      total_bytes: model_total_bytes,
      present_bytes: model_present_bytes,
    });
  }

  if present_files != total_files {
    return Ok(AudioModelsStatus::NotInstalled {
      models_dir: root.to_string_lossy().to_string(),
      total_files,
      present_files,
      total_bytes,
      present_bytes,
      models,
    });
  }

  Ok(AudioModelsStatus::Ready {
    models_dir: root.to_string_lossy().to_string(),
    total_files,
    total_bytes,
    models,
  })
}

pub fn handle_status_get(app: &AppHandle) -> Result<(), String> {
  let status = match get_status(&REQUIRED_MODEL_KEYS) {
    Ok(s) => s,
    Err(err) => AudioModelsStatus::Error {
      code: err.code,
      message: err.message,
      context: err.context,
    },
  };

  crate::emit_server_event_app(
    app,
    &json!({
      "type": "audio.models.status",
      "payload": { "status": status }
    }),
  )
}

pub fn handle_download_start(app: AppHandle) -> Result<(), String> {
  if DOWNLOAD_IN_PROGRESS.swap(true, Ordering::SeqCst) {
    let _ = crate::emit_server_event_app(
      &app,
      &json!({
        "type": "audio.models.download.error",
        "payload": {
          "code": "invalid_state",
          "message": "Download is already in progress",
          "context": {}
        }
      }),
    );
    return Ok(());
  }

  let manifest = match load_manifest() {
    Ok(m) => m,
    Err(err) => {
      DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
      let _ = crate::emit_server_event_app(
        &app,
        &json!({
          "type": "audio.models.download.error",
          "payload": { "code": err.code, "message": err.message, "context": err.context }
        }),
      );
      return Ok(());
    }
  };

  let total_bytes: u64 = manifest
    .models
    .iter()
    .filter(|m| REQUIRED_MODEL_KEYS.iter().any(|k| *k == m.key))
    .flat_map(|m| m.macos.files.iter())
    .map(|f| f.size)
    .sum();

  let mut present_bytes: u64 = 0;
  let mut pending: Vec<PendingDownload> = Vec::new();

  for m in manifest.models {
    if !REQUIRED_MODEL_KEYS.iter().any(|k| *k == m.key) {
      continue;
    }
    if m.macos.files.is_empty() {
      DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
      let _ = crate::emit_server_event_app(
        &app,
        &json!({
          "type": "audio.models.download.error",
          "payload": {
            "code": "manifest_incomplete",
            "message": "Model manifest has a required model with no files",
            "context": { "modelKey": m.key, "missing": ["macos.files"] }
          }
        }),
      );
      return Ok(());
    }

    let repo = match repo_dir(&m.repo_dirname) {
      Ok(p) => p,
      Err(err) => {
        DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
        let _ = crate::emit_server_event_app(
          &app,
          &json!({
            "type": "audio.models.download.error",
            "payload": { "code": err.code, "message": err.message, "context": err.context }
          }),
        );
        return Ok(());
      }
    };

    for f in m.macos.files {
      let rel = Path::new(&f.path);
      if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
        let _ = crate::emit_server_event_app(
          &app,
          &json!({
            "type": "audio.models.download.error",
            "payload": {
              "code": "manifest_invalid",
              "message": "Manifest contains an invalid relative path",
              "context": { "path": f.path }
            }
          }),
        );
        return Ok(());
      }

      let dest_path = repo.join(rel);
      if let Ok(meta) = dest_path.metadata() {
        if meta.is_file() && meta.len() == f.size {
          present_bytes = present_bytes.saturating_add(f.size);
          continue;
        }
      }

      pending.push(PendingDownload {
        dest_path,
        download_url: f.download_url,
        expected_sha256: f.sha256,
        expected_size: f.size,
      });
    }
  }

  if pending.is_empty() {
    DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);
    let _ = crate::emit_server_event_app(
      &app,
      &json!({
        "type": "audio.models.download.progress",
        "payload": { "bytesDownloaded": total_bytes, "bytesTotal": total_bytes }
      }),
    );
    let _ = crate::emit_server_event_app(&app, &json!({ "type": "audio.models.download.done", "payload": {} }));
    return Ok(());
  }

  let app_for_task = app.clone();
  tauri::async_runtime::spawn(async move {
    let result = download_all(&app_for_task, pending, total_bytes, present_bytes).await;
    DOWNLOAD_IN_PROGRESS.store(false, Ordering::SeqCst);

    match result {
      Ok(()) => {
        let _ = crate::emit_server_event_app(&app_for_task, &json!({ "type": "audio.models.download.done", "payload": {} }));
      }
      Err(err) => {
        eprintln!(
          "{}",
          json!({
            "level": "ERROR",
            "event": "audio_models_download_failed",
            "code": err.code,
            "message": err.message,
            "context": err.context,
          })
        );
        let _ = crate::emit_server_event_app(
          &app_for_task,
          &json!({
            "type": "audio.models.download.error",
            "payload": { "code": err.code, "message": err.message, "context": err.context }
          }),
        );
      }
    }
  });

  Ok(())
}

async fn download_all(
  app: &AppHandle,
  pending: Vec<PendingDownload>,
  bytes_total: u64,
  bytes_present: u64,
) -> Result<(), AudioModelsError> {
  let mut bytes_offset: u64 = bytes_present;

  // Emit initial progress immediately.
  let _ = crate::emit_server_event_app(
    app,
    &json!({
      "type": "audio.models.download.progress",
      "payload": { "bytesDownloaded": bytes_offset, "bytesTotal": bytes_total }
    }),
  );

  for f in pending {
    let dest_path = f.dest_path;
    let filename = dest_path.file_name().ok_or_else(|| AudioModelsError {
      code: "manifest_invalid".to_string(),
      message: "Manifest file path has no filename".to_string(),
      context: json!({ "path": dest_path.to_string_lossy() }),
    })?;
    let tmp_filename = format!("{}.partial", filename.to_string_lossy());
    let tmp_path = dest_path.with_file_name(tmp_filename);

    let downloaded = match download_to_path(
      app,
      &f.download_url,
      &tmp_path,
      &f.expected_sha256,
      f.expected_size,
      bytes_total,
      bytes_offset,
    )
    .await
    {
      Ok(n) => n,
      Err(err) => {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
      }
    };

    if let Some(parent) = dest_path.parent() {
      std::fs::create_dir_all(parent).map_err(|error| AudioModelsError {
        code: "io_failed".to_string(),
        message: "Failed to create destination directory".to_string(),
        context: json!({ "path": parent.to_string_lossy(), "error": error.to_string() }),
      })?;
    }

    if dest_path.exists() {
      std::fs::remove_file(&dest_path).map_err(|error| AudioModelsError {
        code: "io_failed".to_string(),
        message: "Failed to remove existing file before replacing it".to_string(),
        context: json!({ "destPath": dest_path.to_string_lossy(), "error": error.to_string() }),
      })?;
    }

    std::fs::rename(&tmp_path, &dest_path).map_err(|error| AudioModelsError {
      code: "io_failed".to_string(),
      message: "Failed to move downloaded file into place".to_string(),
      context: json!({
        "tmpPath": tmp_path.to_string_lossy(),
        "destPath": dest_path.to_string_lossy(),
        "error": error.to_string()
      }),
    })?;

    bytes_offset = bytes_offset.saturating_add(downloaded);
  }

  let _ = crate::emit_server_event_app(
    app,
    &json!({
      "type": "audio.models.download.progress",
      "payload": { "bytesDownloaded": bytes_total, "bytesTotal": bytes_total }
    }),
  );

  Ok(())
}

async fn download_to_path(
  app: &AppHandle,
  url: &str,
  tmp_path: &Path,
  expected_sha256: &str,
  expected_size: u64,
  bytes_total: u64,
  bytes_offset: u64,
) -> Result<u64, AudioModelsError> {
  let client = reqwest::Client::new();
  let response = client.get(url).send().await.map_err(|error| AudioModelsError {
    code: "http_failed".to_string(),
    message: "Failed to start HTTP download".to_string(),
    context: json!({ "url": url, "error": error.to_string() }),
  })?;

  if !response.status().is_success() {
    return Err(AudioModelsError {
      code: "http_failed".to_string(),
      message: "HTTP download returned non-success status".to_string(),
      context: json!({ "url": url, "status": response.status().as_u16() }),
    });
  }

  let mut stream = response.bytes_stream();

  if let Some(parent) = tmp_path.parent() {
    std::fs::create_dir_all(parent).map_err(|error| AudioModelsError {
      code: "io_failed".to_string(),
      message: "Failed to create download directory".to_string(),
      context: json!({ "path": parent.to_string_lossy(), "error": error.to_string() }),
    })?;
  }

  let mut file = std::fs::File::create(tmp_path).map_err(|error| AudioModelsError {
    code: "io_failed".to_string(),
    message: "Failed to create temp download file".to_string(),
    context: json!({ "path": tmp_path.to_string_lossy(), "error": error.to_string() }),
  })?;

  let expected_sha256 = expected_sha256.trim();
  let mut hasher = if expected_sha256.is_empty() { None } else { Some(Sha256::new()) };
  let mut bytes_downloaded: u64 = 0;

  while let Some(item) = stream.next().await {
    let chunk = item.map_err(|error| AudioModelsError {
      code: "http_failed".to_string(),
      message: "Failed while streaming HTTP response".to_string(),
      context: json!({ "url": url, "error": error.to_string() }),
    })?;

    std::io::Write::write_all(&mut file, &chunk).map_err(|error| AudioModelsError {
      code: "io_failed".to_string(),
      message: "Failed to write downloaded chunk".to_string(),
      context: json!({ "path": tmp_path.to_string_lossy(), "error": error.to_string() }),
    })?;

    if let Some(ref mut h) = hasher {
      h.update(&chunk);
    }
    bytes_downloaded = bytes_downloaded.saturating_add(chunk.len() as u64);

    let _ = crate::emit_server_event_app(
      app,
      &json!({
        "type": "audio.models.download.progress",
        "payload": {
          "bytesDownloaded": bytes_offset.saturating_add(bytes_downloaded),
          "bytesTotal": bytes_total
        }
      }),
    );
  }

  std::io::Write::flush(&mut file).map_err(|error| AudioModelsError {
    code: "io_failed".to_string(),
    message: "Failed to flush temp file".to_string(),
    context: json!({ "path": tmp_path.to_string_lossy(), "error": error.to_string() }),
  })?;

  let meta = std::fs::metadata(tmp_path).map_err(|error| AudioModelsError {
    code: "io_failed".to_string(),
    message: "Failed to stat downloaded file".to_string(),
    context: json!({ "path": tmp_path.to_string_lossy(), "error": error.to_string() }),
  })?;
  if meta.len() != expected_size {
    return Err(AudioModelsError {
      code: "size_mismatch".to_string(),
      message: "Downloaded file size does not match expected value".to_string(),
      context: json!({
        "path": tmp_path.to_string_lossy(),
        "expectedSize": expected_size,
        "actualSize": meta.len(),
        "url": url
      }),
    });
  }

  if let Some(h) = hasher {
    let actual_sha256 = hex::encode(h.finalize());
    if actual_sha256.to_lowercase() != expected_sha256.to_lowercase() {
      return Err(AudioModelsError {
        code: "sha256_mismatch".to_string(),
        message: "Downloaded file SHA256 does not match expected value".to_string(),
        context: json!({
          "path": tmp_path.to_string_lossy(),
          "expectedSha256": expected_sha256,
          "actualSha256": actual_sha256
        }),
      });
    }
  }

  Ok(bytes_downloaded)
}

