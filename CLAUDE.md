# ValeDesk

**Desktop AI Assistant with Local Model Support**
Tauri (Rust) + Node.js Sidecar + React 19 | OpenAI-compatible API

Version: 0.0.8 | Author: Valerii Kovalskii | [GitHub](https://github.com/vakovalskii/ValeDesk)

## Important: Tauri is the primary platform

- **Build and test on Tauri**, not Electron. Electron code (`src/agent/ipc-handlers.ts`, `src/agent/main.ts`) is legacy.
- The active runtime path is: **UI → Tauri (Rust) → Sidecar (Node.js)** via stdin/stdout JSON protocol.
- New event handlers must be added to `src/sidecar/main.ts`. If also needed for Electron, mirror in `src/agent/ipc-handlers.ts`.
- Rust backend (`src-tauri/src/main.rs`) may enrich events with DB data before forwarding to sidecar (see `session.continue`, `miniworkflow.distill`).
- Sidecar uses `MemorySessionStore` — old sessions must be restored from data provided by Rust.
- Use `make dev` to run (Tauri + Vite + Sidecar). Use `cargo check` in `src-tauri/` for Rust validation.

## Quick Reference

| What | Where |
|------|-------|
| Rust backend | `src-tauri/src/main.rs` |
| SQLite DB | `src-tauri/src/db.rs` |
| Scheduler | `src-tauri/src/scheduler.rs` |
| Agent entry | `src/agent/main.ts` |
| Sidecar entry | `src/sidecar/main.ts` |
| LLM runner | `src/agent/libs/runner-openai.ts` |
| Tools | `src/agent/libs/tools/` |
| Tool definitions | `src/agent/libs/tools-definitions.ts` |
| Tool executor | `src/agent/libs/tools-executor.ts` |
| System prompt | `src/agent/libs/prompts/system.txt` |
| Skills loader | `src/agent/libs/skills-loader.ts` |
| React UI | `src/ui/` |
| State store | `src/ui/store/useAppStore.ts` |
| i18n | `src/ui/i18n/`, `locales/` |
| Tests | `tests/` |

## Commands

```bash
make dev             # Full dev (Tauri + Vite + Sidecar)
make bundle          # Production build
npm run test         # Run tests
npm run type-check   # TypeScript validation
npm run lint         # ESLint
```

## Conventions

- **Files**: `kebab-case.ts` | **Components**: `PascalCase.tsx`
- **Tools**: `snake_case`, `verb_noun` pattern (`read_file`, `search_web`)
- **Commits**: `type: description` (feat, fix, refactor, chore, security, perf)
- TypeScript strict, `interface` for objects, `type` for unions, no `any`

## Tech Stack

- **Desktop**: Tauri 2.x (Rust)
- **Sidecar**: Node.js bundled with `pkg` (LLM logic, tools)
- **Database**: SQLite via `rusqlite`
- **Frontend**: React 19, Zustand, Tailwind CSS 4, Vite 7
- **LLM**: OpenAI SDK (compatible with vLLM, Ollama, LM Studio)
- **Build**: Vite + `cargo tauri build`

## Documentation

| Document | Content |
|----------|---------|
| [Architecture](docs/architecture.md) | Three-layer architecture, data flow, SQLite schema |
| [Development](docs/development.md) | Setup, code style, git workflow, build targets |
| [Tools](docs/tools.md) | All 30+ tools, sandboxes, permissions, creating new tools |
| [LLM Loop](docs/llm-loop.md) | Agent loop, streaming, retry logic, system prompt |
| [Security](docs/security.md) | Sandboxing, permissions, workspace isolation |
| [Features](FEATURES.md) | Full feature list (RU) |
| [Changelog](CHANGELOG.md) | Version history |
| [README](README.md) | User-facing documentation |
