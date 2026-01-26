# Project Architecture

## Overview

LocalDesk uses **Tauri** with a **Rust** backend and **Node.js sidecar** for LLM/tool logic.

```
┌─────────────────────────────────────────────────────────────┐
│                         Tauri App                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ Rust Backend │    │ Node Sidecar │    │   WebView    │   │
│  │  (main.rs)   │◄──►│  (sidecar/)  │    │  (React UI)  │   │
│  │              │    │              │    │              │   │
│  │ - Window mgmt│    │ - LLM Runner │    │ - Chat UI    │   │
│  │ - SQLite DB  │    │ - Tool Exec  │    │ - Settings   │   │
│  │ - IPC bridge │    │ - Streaming  │    │ - Todo Panel │   │
│  │ - Native API │    │ - Memory     │    │ - Zustand    │   │
│  └──────────────┘    └──────────────┘    └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Why Tauri + Sidecar?

- **Tauri**: Lightweight (~10MB vs Electron ~150MB), native WebView
- **Rust backend**: Fast, safe, handles native OS operations
- **Node sidecar**: Reuses existing LLM/tool logic, npm ecosystem

## Directory Structure

```
├── src-tauri/                   # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs             # Entry point, IPC commands, sidecar mgmt
│   │   ├── db.rs               # SQLite database (sessions, messages, todos)
│   │   └── sandbox.rs          # Code execution (JS/Python)
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri configuration
│   └── capabilities/           # Security permissions
│
├── src/
│   ├── sidecar/                # Node.js sidecar process
│   │   ├── main.ts             # Sidecar entry point
│   │   ├── protocol.ts         # Event types for Rust ↔ Node
│   │   └── session-store-memory.ts  # In-memory session state
│   │
│   ├── agent/                  # Agent logic (used by sidecar)
│   │   └── libs/
│   │       ├── runner-openai.ts    # LLM agent loop with streaming
│   │       ├── tools-executor.ts   # Tool dispatch
│   │       ├── session-store.ts    # Session state management
│   │       ├── prompt-loader.ts    # System prompt builder
│   │       ├── container/
│   │       │   └── quickjs-sandbox.ts  # JS/Python sandboxes
│   │       ├── prompts/
│   │       │   └── system.txt      # System prompt template
│   │       └── tools/              # Tool implementations
│   │
│   └── ui/                     # React frontend (WebView)
│       ├── main.tsx            # React entry
│       ├── App.tsx             # Root component
│       ├── components/
│       │   ├── ChatArea.tsx    # Message display
│       │   ├── PromptInput.tsx # User input
│       │   ├── TodoPanel.tsx   # Task planning UI
│       │   └── ...
│       └── store/
│           └── useAppStore.ts  # Zustand state
│
├── Makefile                    # Build commands
└── scripts/                    # Setup scripts
```

## Key Files

### Rust Backend (src-tauri/)

| File | Purpose |
|------|---------|
| `main.rs` | Entry point, Tauri commands, sidecar management |
| `db.rs` | SQLite database - sessions, messages, todos, settings |
| `sandbox.rs` | Code execution sandboxes (unused, logic in sidecar) |
| `tauri.conf.json` | Window config, bundle settings, permissions |
| `Cargo.toml` | Rust dependencies |

### Node Sidecar (src/sidecar/)

| File | Purpose |
|------|---------|
| `main.ts` | Sidecar entry, event routing, session handlers |
| `protocol.ts` | Event types for Rust ↔ Node communication |
| `session-store-memory.ts` | In-memory session state (restored from DB on continue) |

### Agent Logic (src/agent/libs/)

| File | Purpose |
|------|---------|
| `runner-openai.ts` | LLM agent loop with streaming, tool calls |
| `tools-executor.ts` | Execute tools, handle permissions |
| `session-store.ts` | Session state management |
| `prompt-loader.ts` | Build system prompt from template |
| `container/quickjs-sandbox.ts` | JS (vm) and Python (subprocess) sandboxes |

### React UI (src/ui/)

| File | Purpose |
|------|---------|
| `App.tsx` | Main layout, routing |
| `useAppStore.ts` | Global state (Zustand) |
| `ChatArea.tsx` | Message rendering, streaming |
| `PromptInput.tsx` | User input with shortcuts |

## Data Flow

### User Message → LLM Response

```
1. User types message in React UI
2. UI calls Tauri invoke('client_event', {...})
3. Rust main.rs receives event
4. Rust writes JSON to sidecar stdin
5. Sidecar (Node.js) processes with runner-openai.ts
6. Sidecar streams responses to stdout as JSON
7. Rust reads stdout, emits 'server-event' to WebView
8. React UI updates via Tauri event listener
9. If tool_calls: sidecar executes, continues loop
10. Final response displayed
```

### IPC Protocol (Rust ↔ Sidecar)

```
Rust → Sidecar (stdin):
  { "type": "client-event", "event": {...} }

Sidecar → Rust (stdout):
  { "type": "server-event", "event": {...} }
  { "type": "log", "level": "info", "message": "..." }
```

## Tauri Commands

Defined in `main.rs`:

```rust
#[tauri::command]
fn client_event(event: Value) -> Result<(), String>
fn list_directory(path: String) -> Result<Vec<FileItem>, String>
fn read_memory() -> Result<String, String>
fn write_memory(content: String) -> Result<(), String>
fn select_directory() -> Result<Option<String>, String>
fn get_build_info() -> Result<BuildInfo, String>
```

## Database Schema (SQLite)

Managed by Rust via `rusqlite` in `db.rs`:

```sql
sessions (id, title, cwd, model, status, allowed_tools, temperature, 
          input_tokens, output_tokens, is_pinned, created_at, updated_at)
messages (id, session_id, data, created_at)
todos (session_id, todos)
file_changes (session_id, file_changes)
settings (key, value)
llm_providers (id, name, type, base_url, api_key, enabled, config, ...)
llm_models (id, provider_id, name, enabled, config)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | **Tauri 2.x** (Rust) |
| Database | **rusqlite** (SQLite in Rust) |
| Frontend | React 19, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS |
| Sidecar | Node.js bundled with `pkg` |
| JS Sandbox | Node.js `vm` module |
| Python Sandbox | System subprocess |
| PDF | pdf-parse |
| DOCX | mammoth |
| Build | **Vite + cargo tauri build** |

## Build Artifacts (gitignored)

| Path | Size | Description |
|------|------|-------------|
| `src-tauri/target/` | ~1.6 GB | Rust compilation cache |
| `src-tauri/bin/` | - | Sidecar binary for bundle |
| `dist-sidecar/` | - | Transpiled sidecar JS |
| `dist-react/` | - | Built React app |
