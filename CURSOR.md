# LocalDesk - AI Agent Guidelines

> This file helps AI coding assistants understand the project structure and conventions.

## Project Overview

LocalDesk is a desktop AI assistant built with Electron + React + TypeScript.
It supports local LLM inference via OpenAI-compatible APIs (vLLM, Ollama, LM Studio).

## Quick Reference

| What | Where |
|------|-------|
| Main process | `src/electron/` |
| React UI | `src/ui/` |
| Tools | `src/electron/libs/tools/` |
| System prompt | `src/electron/libs/prompts/system.txt` |
| LLM runner | `src/electron/libs/runner-openai.ts` |
| State store | `src/ui/store/useAppStore.ts` |

## Development Commands

```bash
npm run dev          # Start dev mode (macOS/Linux)
npm run dev:win      # Start dev mode (Windows)
npm run type-check   # TypeScript validation
npm run lint         # ESLint check
npm run build        # Production build
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

- **Desktop**: Electron 32+
- **Frontend**: React 19, Zustand, Tailwind CSS
- **Database**: better-sqlite3
- **JS Sandbox**: quickjs-emscripten (WASM)
- **Build**: Vite + electron-builder
