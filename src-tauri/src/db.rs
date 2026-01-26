use rusqlite::{Connection, params, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &Path) -> SqliteResult<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn: Mutex::new(conn) };
        db.initialize()?;
        Ok(db)
    }

    fn initialize(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                claude_session_id TEXT,
                status TEXT NOT NULL DEFAULT 'idle',
                cwd TEXT,
                allowed_tools TEXT,
                last_prompt TEXT,
                model TEXT,
                thread_id TEXT,
                temperature REAL,
                is_pinned INTEGER DEFAULT 0,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                todos TEXT,
                file_changes TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            CREATE INDEX IF NOT EXISTS messages_session_id ON messages(session_id);

            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                prompt TEXT,
                schedule TEXT NOT NULL,
                next_run INTEGER NOT NULL,
                is_recurring INTEGER DEFAULT 0,
                notify_before INTEGER,
                enabled INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scheduled_tasks_next_run ON scheduled_tasks(next_run);
            CREATE INDEX IF NOT EXISTS scheduled_tasks_enabled ON scheduled_tasks(enabled);

            -- Settings key-value store
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- LLM Providers (API keys stored securely in DB)
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                base_url TEXT,
                api_key TEXT,
                enabled INTEGER DEFAULT 1,
                config TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- LLM Models
            CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL,
                name TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                config TEXT,
                FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS models_provider_id ON models(provider_id);

            -- Skills settings
            CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT,
                author TEXT,
                version TEXT,
                repo_path TEXT,
                enabled INTEGER DEFAULT 0,
                last_updated INTEGER
            );
        "#)?;

        // Migration: add temperature column if not exists (for existing DBs)
        let _ = conn.execute(
            "ALTER TABLE sessions ADD COLUMN temperature REAL",
            [],
        ); // Ignore error if column already exists

        Ok(())
    }

    pub fn create_session(&self, params: &CreateSessionParams) -> SqliteResult<Session> {
        let conn = self.conn.lock().unwrap();
        let id = params.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            r#"INSERT INTO sessions 
               (id, title, status, cwd, allowed_tools, last_prompt, model, thread_id, temperature, created_at, updated_at)
               VALUES (?1, ?2, 'idle', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
            params![
                &id,
                &params.title,
                &params.cwd,
                &params.allowed_tools,
                &params.prompt,
                &params.model,
                &params.thread_id,
                &params.temperature,
                now,
                now
            ],
        )?;

        Ok(Session {
            id,
            title: params.title.clone(),
            claude_session_id: None,
            status: "idle".to_string(),
            cwd: params.cwd.clone(),
            allowed_tools: params.allowed_tools.clone(),
            last_prompt: params.prompt.clone(),
            model: params.model.clone(),
            thread_id: params.thread_id.clone(),
            temperature: params.temperature,
            is_pinned: false,
            input_tokens: 0,
            output_tokens: 0,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_sessions(&self) -> SqliteResult<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, 
                      model, thread_id, temperature, is_pinned, input_tokens, output_tokens, created_at, updated_at
               FROM sessions ORDER BY updated_at DESC"#
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                title: row.get(1)?,
                claude_session_id: row.get(2)?,
                status: row.get(3)?,
                cwd: row.get(4)?,
                allowed_tools: row.get(5)?,
                last_prompt: row.get(6)?,
                model: row.get(7)?,
                thread_id: row.get(8)?,
                temperature: row.get(9)?,
                is_pinned: row.get::<_, i32>(10)? != 0,
                input_tokens: row.get(11)?,
                output_tokens: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        rows.collect()
    }

    pub fn get_session(&self, id: &str) -> SqliteResult<Option<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, 
                      model, thread_id, temperature, is_pinned, input_tokens, output_tokens, created_at, updated_at
               FROM sessions WHERE id = ?1"#
        )?;

        let mut rows = stmt.query_map([id], |row| {
            Ok(Session {
                id: row.get(0)?,
                title: row.get(1)?,
                claude_session_id: row.get(2)?,
                status: row.get(3)?,
                cwd: row.get(4)?,
                allowed_tools: row.get(5)?,
                last_prompt: row.get(6)?,
                model: row.get(7)?,
                thread_id: row.get(8)?,
                temperature: row.get(9)?,
                is_pinned: row.get::<_, i32>(10)? != 0,
                input_tokens: row.get(11)?,
                output_tokens: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })?;

        match rows.next() {
            Some(result) => Ok(Some(result?)),
            None => Ok(None),
        }
    }

    pub fn update_session(&self, id: &str, params: &UpdateSessionParams) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();

        let mut updates = vec!["updated_at = ?1".to_string()];
        let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(now)];
        let mut idx = 2;

        if let Some(ref title) = params.title {
            updates.push(format!("title = ?{}", idx));
            values.push(Box::new(title.clone()));
            idx += 1;
        }
        if let Some(ref status) = params.status {
            updates.push(format!("status = ?{}", idx));
            values.push(Box::new(status.clone()));
            idx += 1;
        }
        if let Some(ref cwd) = params.cwd {
            updates.push(format!("cwd = ?{}", idx));
            values.push(Box::new(cwd.clone()));
            idx += 1;
        }
        if let Some(ref model) = params.model {
            updates.push(format!("model = ?{}", idx));
            values.push(Box::new(model.clone()));
            idx += 1;
        }
        if let Some(ref last_prompt) = params.last_prompt {
            updates.push(format!("last_prompt = ?{}", idx));
            values.push(Box::new(last_prompt.clone()));
            idx += 1;
        }
        if let Some(ref claude_session_id) = params.claude_session_id {
            updates.push(format!("claude_session_id = ?{}", idx));
            values.push(Box::new(claude_session_id.clone()));
            idx += 1;
        }
        if let Some(input_tokens) = params.input_tokens {
            updates.push(format!("input_tokens = ?{}", idx));
            values.push(Box::new(input_tokens));
            idx += 1;
        }
        if let Some(output_tokens) = params.output_tokens {
            updates.push(format!("output_tokens = ?{}", idx));
            values.push(Box::new(output_tokens));
            idx += 1;
        }

        let sql = format!(
            "UPDATE sessions SET {} WHERE id = ?{}",
            updates.join(", "),
            idx
        );
        values.push(Box::new(id.to_string()));

        let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        let changed = conn.execute(&sql, params_refs.as_slice())?;
        Ok(changed > 0)
    }

    pub fn delete_session(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE session_id = ?1", [id])?;
        let changed = conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(changed > 0)
    }

    pub fn set_pinned(&self, id: &str, is_pinned: bool) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE sessions SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![if is_pinned { 1 } else { 0 }, now, id],
        )?;
        Ok(())
    }

    /// Reset all sessions with status "running" to "idle"
    /// Should be called on app startup to clean up stale running sessions
    pub fn reset_running_sessions(&self) -> SqliteResult<usize> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let changed = conn.execute(
            "UPDATE sessions SET status = 'idle', updated_at = ?1 WHERE status = 'running'",
            params![now],
        )?;
        Ok(changed)
    }

    pub fn update_tokens(&self, id: &str, input_tokens: i64, output_tokens: i64) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            r#"UPDATE sessions SET 
               input_tokens = input_tokens + ?1, 
               output_tokens = output_tokens + ?2,
               updated_at = ?3
               WHERE id = ?4"#,
            params![input_tokens, output_tokens, now, id],
        )?;
        Ok(())
    }

    pub fn record_message(&self, session_id: &str, message: &serde_json::Value) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let id = message
            .get("uuid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let now = chrono::Utc::now().timestamp_millis();
        let data = serde_json::to_string(message).unwrap_or_default();

        conn.execute(
            "INSERT OR IGNORE INTO messages (id, session_id, data, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![&id, session_id, &data, now],
        )?;
        Ok(())
    }

    pub fn get_session_messages(&self, session_id: &str) -> SqliteResult<Vec<serde_json::Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT data FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        )?;

        let rows = stmt.query_map([session_id], |row| {
            let data: String = row.get(0)?;
            Ok(serde_json::from_str(&data).unwrap_or(serde_json::Value::Null))
        })?;

        rows.collect()
    }

    pub fn get_session_history(&self, id: &str) -> SqliteResult<Option<SessionHistory>> {
        let session = match self.get_session(id)? {
            Some(s) => s,
            None => return Ok(None),
        };

        let messages = self.get_session_messages(id)?;
        
        // Get todos from session
        let todos = self.get_todos(id)?;
        let file_changes = self.get_file_changes(id)?;

        Ok(Some(SessionHistory {
            session,
            messages,
            todos,
            file_changes,
        }))
    }

    pub fn get_todos(&self, session_id: &str) -> SqliteResult<Vec<TodoItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT todos FROM sessions WHERE id = ?1")?;
        let mut rows = stmt.query([session_id])?;
        
        if let Some(row) = rows.next()? {
            let todos_str: Option<String> = row.get(0)?;
            if let Some(s) = todos_str {
                if let Ok(todos) = serde_json::from_str(&s) {
                    return Ok(todos);
                }
            }
        }
        Ok(vec![])
    }

    pub fn save_todos(&self, session_id: &str, todos: &[TodoItem]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let todos_json = serde_json::to_string(todos).unwrap_or_default();
        conn.execute(
            "UPDATE sessions SET todos = ?1, updated_at = ?2 WHERE id = ?3",
            params![&todos_json, now, session_id],
        )?;
        Ok(())
    }

    pub fn get_file_changes(&self, session_id: &str) -> SqliteResult<Vec<FileChange>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT file_changes FROM sessions WHERE id = ?1")?;
        let mut rows = stmt.query([session_id])?;
        
        if let Some(row) = rows.next()? {
            let changes_str: Option<String> = row.get(0)?;
            if let Some(s) = changes_str {
                if let Ok(changes) = serde_json::from_str(&s) {
                    return Ok(changes);
                }
            }
        }
        Ok(vec![])
    }

    pub fn save_file_changes(&self, session_id: &str, changes: &[FileChange]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let changes_json = serde_json::to_string(changes).unwrap_or_default();
        conn.execute(
            "UPDATE sessions SET file_changes = ?1, updated_at = ?2 WHERE id = ?3",
            params![&changes_json, now, session_id],
        )?;
        Ok(())
    }

    pub fn list_recent_cwds(&self, limit: u32) -> SqliteResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT cwd, MAX(updated_at) as latest
               FROM sessions
               WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
               GROUP BY cwd
               ORDER BY latest DESC
               LIMIT ?1"#
        )?;

        let rows = stmt.query_map([limit], |row| {
            row.get(0)
        })?;

        rows.collect()
    }

    pub fn truncate_history_after(&self, session_id: &str, message_index: usize) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        // Get all message IDs for this session
        let mut stmt = conn.prepare(
            "SELECT id FROM messages WHERE session_id = ?1 ORDER BY created_at ASC"
        )?;
        let ids: Vec<String> = stmt.query_map([session_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        // Keep only messages up to and including message_index
        let ids_to_keep: Vec<&String> = ids.iter().take(message_index + 1).collect();
        
        if ids_to_keep.is_empty() {
            conn.execute("DELETE FROM messages WHERE session_id = ?1", [session_id])?;
        } else {
            let placeholders: Vec<String> = ids_to_keep.iter().enumerate().map(|(i, _)| format!("?{}", i + 2)).collect();
            let sql = format!(
                "DELETE FROM messages WHERE session_id = ?1 AND id NOT IN ({})",
                placeholders.join(",")
            );
            
            let mut params: Vec<&dyn rusqlite::ToSql> = vec![&session_id as &dyn rusqlite::ToSql];
            for id in &ids_to_keep {
                params.push(*id as &dyn rusqlite::ToSql);
            }
            conn.execute(&sql, params.as_slice())?;
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub is_pinned: bool,
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub additions: i32,
    pub deletions: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistory {
    pub session: Session,
    pub messages: Vec<serde_json::Value>,
    pub todos: Vec<TodoItem>,
    pub file_changes: Vec<FileChange>,
}

// ============ LLM Providers ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMModel {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMProviderSettings {
    pub providers: Vec<LLMProvider>,
    pub models: Vec<LLMModel>,
}

// ============ Settings ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_search_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tavily_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_memory: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_todos: Option<bool>,
    // Add other settings as needed
}

// ============ Database methods for Providers ============

impl Database {
    // --- Settings ---
    
    pub fn get_setting(&self, key: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn get_api_settings(&self) -> SqliteResult<Option<ApiSettings>> {
        match self.get_setting("api_settings")? {
            Some(json) => {
                let settings: ApiSettings = serde_json::from_str(&json)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
                Ok(Some(settings))
            }
            None => Ok(None),
        }
    }

    pub fn save_api_settings(&self, settings: &ApiSettings) -> SqliteResult<()> {
        let json = serde_json::to_string(settings)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.set_setting("api_settings", &json)
    }

    // --- Providers ---

    pub fn list_providers(&self) -> SqliteResult<Vec<LLMProvider>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, type, base_url, api_key, enabled, config, created_at, updated_at FROM providers ORDER BY name"
        )?;

        let rows = stmt.query_map([], |row| {
            let config_str: Option<String> = row.get(6)?;
            let config = config_str.and_then(|s| serde_json::from_str(&s).ok());
            
            Ok(LLMProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_type: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0,
                config,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;

        rows.collect()
    }

    pub fn save_provider(&self, provider: &LLMProvider) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let config_json = provider.config.as_ref().map(|c| serde_json::to_string(c).unwrap_or_default());

        conn.execute(
            r#"INSERT OR REPLACE INTO providers (id, name, type, base_url, api_key, enabled, config, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE((SELECT created_at FROM providers WHERE id = ?1), ?8), ?9)"#,
            params![
                &provider.id,
                &provider.name,
                &provider.provider_type,
                &provider.base_url,
                &provider.api_key,
                if provider.enabled { 1 } else { 0 },
                &config_json,
                now,
                now
            ],
        )?;
        Ok(())
    }

    pub fn delete_provider(&self, id: &str) -> SqliteResult<bool> {
        let conn = self.conn.lock().unwrap();
        // Delete associated models first
        conn.execute("DELETE FROM models WHERE provider_id = ?1", [id])?;
        let changed = conn.execute("DELETE FROM providers WHERE id = ?1", [id])?;
        Ok(changed > 0)
    }

    // --- Models ---

    pub fn list_models(&self) -> SqliteResult<Vec<LLMModel>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, provider_id, name, enabled, config FROM models ORDER BY name"
        )?;

        let rows = stmt.query_map([], |row| {
            let config_str: Option<String> = row.get(4)?;
            let config = config_str.and_then(|s| serde_json::from_str(&s).ok());
            
            Ok(LLMModel {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                name: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                config,
            })
        })?;

        rows.collect()
    }

    pub fn list_models_by_provider(&self, provider_id: &str) -> SqliteResult<Vec<LLMModel>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, provider_id, name, enabled, config FROM models WHERE provider_id = ?1 ORDER BY name"
        )?;

        let rows = stmt.query_map([provider_id], |row| {
            let config_str: Option<String> = row.get(4)?;
            let config = config_str.and_then(|s| serde_json::from_str(&s).ok());
            
            Ok(LLMModel {
                id: row.get(0)?,
                provider_id: row.get(1)?,
                name: row.get(2)?,
                enabled: row.get::<_, i32>(3)? != 0,
                config,
            })
        })?;

        rows.collect()
    }

    pub fn save_model(&self, model: &LLMModel) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        let config_json = model.config.as_ref().map(|c| serde_json::to_string(c).unwrap_or_default());

        conn.execute(
            "INSERT OR REPLACE INTO models (id, provider_id, name, enabled, config) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                &model.id,
                &model.provider_id,
                &model.name,
                if model.enabled { 1 } else { 0 },
                &config_json
            ],
        )?;
        Ok(())
    }

    pub fn save_models_bulk(&self, models: &[LLMModel]) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        for model in models {
            let config_json = model.config.as_ref().map(|c| serde_json::to_string(c).unwrap_or_default());
            conn.execute(
                "INSERT OR REPLACE INTO models (id, provider_id, name, enabled, config) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    &model.id,
                    &model.provider_id,
                    &model.name,
                    if model.enabled { 1 } else { 0 },
                    &config_json
                ],
            )?;
        }
        Ok(())
    }

    pub fn delete_models_by_provider(&self, provider_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM models WHERE provider_id = ?1", [provider_id])?;
        Ok(())
    }

    // --- Combined providers + models ---

    pub fn get_llm_provider_settings(&self) -> SqliteResult<LLMProviderSettings> {
        Ok(LLMProviderSettings {
            providers: self.list_providers()?,
            models: self.list_models()?,
        })
    }

    pub fn save_llm_provider_settings(&self, settings: &LLMProviderSettings) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        
        // Get IDs of providers to keep
        let provider_ids: Vec<&str> = settings.providers.iter().map(|p| p.id.as_str()).collect();
        
        // Delete providers not in the new list
        if !provider_ids.is_empty() {
            let placeholders: Vec<String> = (1..=provider_ids.len()).map(|i| format!("?{}", i)).collect();
            let sql = format!("DELETE FROM providers WHERE id NOT IN ({})", placeholders.join(", "));
            let params: Vec<&dyn rusqlite::ToSql> = provider_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            conn.execute(&sql, params.as_slice())?;
        } else {
            // No providers - delete all
            conn.execute("DELETE FROM providers", [])?;
        }
        
        // Get IDs of models to keep
        let model_ids: Vec<&str> = settings.models.iter().map(|m| m.id.as_str()).collect();
        
        // Delete models not in the new list
        if !model_ids.is_empty() {
            let placeholders: Vec<String> = (1..=model_ids.len()).map(|i| format!("?{}", i)).collect();
            let sql = format!("DELETE FROM models WHERE id NOT IN ({})", placeholders.join(", "));
            let params: Vec<&dyn rusqlite::ToSql> = model_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            conn.execute(&sql, params.as_slice())?;
        } else {
            // No models - delete all
            conn.execute("DELETE FROM models", [])?;
        }
        
        drop(conn); // Release lock before calling other methods
        
        // Save providers
        for provider in &settings.providers {
            self.save_provider(provider)?;
        }
        
        // Save models
        self.save_models_bulk(&settings.models)?;
        
        Ok(())
    }
}
