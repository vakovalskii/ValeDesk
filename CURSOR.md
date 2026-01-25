# LocalDesk - AI Agent Guidelines

> This file helps AI coding assistants understand the project structure and conventions.

## Project Overview

LocalDesk is a desktop AI assistant built with **Tauri (Rust)** + **Node.js sidecar** + **React**.
It supports local LLM inference via OpenAI-compatible APIs (vLLM, Ollama, LM Studio).

## Quick Reference

| What | Where |
|------|-------|
| Rust backend | `src-tauri/src/main.rs` |
| Node sidecar | `src/sidecar/` |
| Shared libs | `src/electron/libs/` |
| React UI | `src/ui/` |
| Tools | `src/electron/libs/tools/` |
| System prompt | `src/electron/libs/prompts/system.txt` |
| LLM runner | `src/electron/libs/runner-openai.ts` |
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
- **Sidecar**: Node.js (LLM logic, tools, SQLite)
- **Frontend**: React 19, Zustand, Tailwind CSS
- **Database**: better-sqlite3 (via sidecar)
- **JS Sandbox**: quickjs-emscripten (WASM)
- **Build**: Vite + cargo tauri build
