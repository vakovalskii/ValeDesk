# Project Architecture

## Overview

LocalDesk uses **Tauri** with a **Rust** backend and **Node.js sidecar** for heavy logic.

```
┌─────────────────────────────────────────────────────────────┐
│                         Tauri                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Rust Backend │    │ Node Sidecar │    │   WebView    │  │
│  │  (main.rs)   │◄──►│  (sidecar/)  │    │  (React UI)  │  │
│  │              │    │              │    │              │  │
│  │ - Window mgmt│    │ - LLM Runner │    │ - Chat UI    │  │
│  │ - File ops   │    │ - Tool Exec  │    │ - Settings   │  │
│  │ - IPC bridge │    │ - SQLite DB  │    │ - Todo Panel │  │
│  │ - Native API │    │ - Streaming  │    │ - Zustand    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
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
│   │   └── main.rs             # Entry point, IPC commands
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri configuration
│   └── capabilities/           # Security permissions
│
├── src/
│   ├── sidecar/                # Node.js sidecar process
│   │   ├── main.ts             # Sidecar entry point
│   │   └── protocol.ts         # JSON-RPC protocol
│   │
│   ├── electron/               # Shared logic (used by sidecar)
│   │   ├── libs/
│   │   │   ├── runner-openai.ts    # LLM agent loop
│   │   │   ├── tools-executor.ts   # Tool dispatch
│   │   │   ├── session-store.ts    # SQLite persistence
│   │   │   ├── prompt-loader.ts    # System prompt builder
│   │   │   ├── container/
│   │   │   │   └── quickjs-sandbox.ts  # WASM JS sandbox
│   │   │   ├── prompts/
│   │   │   │   └── system.txt      # System prompt template
│   │   │   └── tools/              # Tool implementations
│   │   └── types.ts
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
| `tauri.conf.json` | Window config, bundle settings, permissions |
| `Cargo.toml` | Rust dependencies |

### Node Sidecar (src/sidecar/)

| File | Purpose |
|------|---------|
| `main.ts` | Sidecar entry, stdin/stdout JSON protocol |
| `protocol.ts` | Message types for Rust ↔ Node communication |

### Shared Logic (src/electron/libs/)

| File | Purpose |
|------|---------|
| `runner-openai.ts` | LLM agent loop with streaming |
| `tools-executor.ts` | Execute tools, handle permissions |
| `session-store.ts` | SQLite CRUD for sessions |
| `prompt-loader.ts` | Build system prompt from template |

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

Same as before - managed by sidecar:

```sql
sessions (id, title, cwd, model, created_at, updated_at, pinned)
messages (id, session_id, type, data, created_at)
todos (id, session_id, todos)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | **Tauri 2.x** (Rust) |
| Frontend | React 19, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS |
| Database | better-sqlite3 (via sidecar) |
| JS Sandbox | quickjs-emscripten (WASM) |
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
