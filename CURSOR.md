# LocalDesk - AI Agent Guidelines

> This file helps AI coding assistants understand the project structure and conventions.

## Project Overview

LocalDesk is a desktop AI assistant built with **Tauri (Rust)** + **Node.js sidecar** + **React**.
It supports local LLM inference via OpenAI-compatible APIs (vLLM, Ollama, LM Studio).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri App (Rust)                         │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │  main.rs    │───▶│  SQLite DB   │    │   Sidecar     │   │
│  │  (IPC hub)  │    │  sessions.db │    │  Management   │   │
│  └─────────────┘    └──────────────┘    └───────────────┘   │
│         │                                       │           │
│         │ JSON Events                          │ stdin/out  │
│         ▼                                       ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Node.js Sidecar (pkg binary)           │    │
│  │  ┌──────────────┐  ┌───────────┐  ┌─────────────┐   │    │
│  │  │ runner-      │  │  Tools    │  │  Session    │   │    │
│  │  │ openai.ts    │  │ Executor  │  │  Store      │   │    │
│  │  │ (LLM loop)   │  │           │  │  (memory)   │   │    │
│  │  └──────────────┘  └───────────┘  └─────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ WebView
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    React UI (Vite)                          │
│  ┌───────────────┐  ┌────────────┐  ┌──────────────┐        │
│  │  useAppStore  │  │ Components │  │  Tauri IPC   │        │
│  │  (Zustand)    │  │            │  │  Bridge      │        │
│  └───────────────┘  └────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Quick Reference

| What | Where |
|------|-------|
| Rust backend | `src-tauri/src/main.rs` |
| SQLite DB | `src-tauri/src/db.rs` |
| Node sidecar entry | `src/sidecar/main.ts` |
| Agent libs | `src/agent/libs/` |
| Tools | `src/agent/libs/tools/` |
| System prompt | `src/agent/libs/prompts/system.txt` |
| LLM runner | `src/agent/libs/runner-openai.ts` |
| React UI | `src/ui/` |
| State store | `src/ui/store/useAppStore.ts` |
| Build config | `Makefile` |

## Development Commands

```bash
# Tauri development (recommended)
make dev             # Start Tauri + Vite + Sidecar

# Individual components
make dev-ui          # Vite dev server only
make dev-sidecar     # Transpile sidecar only
make bundle          # Production build

# Utilities
npm run type-check   # TypeScript validation
npm run lint         # ESLint check
rustc --version      # Check Rust (need 1.74+)
```

## Detailed Documentation

See `.cursor/rules/` for detailed guidelines:

| File | Content |
|------|---------|
| [`development.md`](.cursor/rules/development.md) | Code style, git workflow, testing |
| [`tools.md`](.cursor/rules/tools.md) | Creating new tools, naming conventions |
| [`architecture.md`](.cursor/rules/architecture.md) | Project structure, data flow |
| [`system-prompt.md`](.cursor/rules/system-prompt.md) | How system prompt is built |
| [`llm-loop.md`](.cursor/rules/llm-loop.md) | Agent loop, streaming, error handling |

## Key Conventions

### Naming

- Files: `kebab-case.ts`
- Tools: `snake_case` with `verb_noun` pattern (`read_file`, `search_web`)
- Components: `PascalCase.tsx`

### Commits

Format: `type: description`

```
feat: add PDF extraction tool
fix: resolve streaming lag
refactor: extract tool executor
security: remove hardcoded credentials
```

### Code Style

- TypeScript strict mode
- Prefer `interface` for objects, `type` for unions
- Use async/await, avoid callbacks
- No `any` without justification

## Tech Stack

- **Desktop**: Tauri 2.x (Rust backend)
- **Sidecar**: Node.js bundled with `pkg` (LLM logic, tools)
- **Database**: SQLite via `rusqlite` (Rust) - sessions, messages, todos, settings
- **Frontend**: React 19, Zustand, Tailwind CSS
- **JS Sandbox**: Node.js `vm` module (sandboxed)
- **Python Sandbox**: System Python subprocess
- **Build**: Vite + cargo tauri build

## Data Flow

1. **UI → Rust**: User action triggers `ClientEvent` via Tauri IPC
2. **Rust**: Persists to SQLite, forwards to sidecar via stdin
3. **Sidecar**: Processes LLM calls, executes tools, emits `ServerEvent` via stdout
4. **Rust → UI**: Parses JSON, emits to WebView via `server-event` channel
5. **Sync**: Sidecar sends `session.sync` events, Rust persists to DB
