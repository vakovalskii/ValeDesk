# Changelog

All notable changes to this project will be documented in this file.

## [0.0.7] - 2026-01-26

### 🚀 Major Changes

#### Tauri Migration
- **Complete rewrite** from Electron to Tauri (Rust backend)
- **SQLite in Rust** — sessions, messages, todos persisted via `rusqlite`
- **Node.js Sidecar** — LLM logic runs as standalone binary (bundled with `pkg`)
- **~10x smaller** — app size reduced from ~150MB to ~15MB

#### Session Persistence
- ✅ **Sessions survive restart** — full history restored from SQLite
- ✅ **Reset stale sessions** — running sessions reset to idle on startup
- ✅ **Edit & continue** — message editing works after app restart

### ✨ New Features

#### Python Sandbox (execute_python)
- ✅ **System Python** — uses Python 3 installed on user's machine
- ✅ **pip packages** — can use numpy, pandas, requests, etc.
- ✅ **Full stdlib** — json, os, sys, re, math, datetime...
- ✅ **File I/O** — read/write within workspace

#### Improved JS Sandbox (execute_js)
- ✅ **Node.js vm** — replaced QuickJS WASM with native vm module
- ✅ **Better globals** — fs, path, console, JSON, Math, Date
- ✅ **Clear limitations** — no require, no npm, no async

#### Skills Improvements
- ✅ **Local download** — skills saved to `{cwd}/skills/` not `.localdesk`
- ✅ **Clearer UX** — explicit instructions for reading skill files

### 🐛 Bug Fixes

- 🔧 **Stop button** — now properly interrupts agent with AbortController
- 🔧 **Dynamic import** — fixed pkg binary crash in Python executor
- 🔧 **Log noise** — silenced non-JSON debug lines from sidecar

### 📁 Code Reorganization

- Renamed `src/electron/` → `src/agent/`
- New `src-tauri/src/db.rs` — SQLite database operations
- New `src-tauri/src/sandbox.rs` — code execution (unused)
- New `src/sidecar/session-store-memory.ts` — runtime session state
- Updated `.cursor/rules/` — architecture, tools, system-prompt docs

### 📝 Documentation

- ✅ Updated README with Tauri build instructions
- ✅ Updated CURSOR.md with new architecture diagram
- ✅ Updated tool descriptions with sandbox limitations

---

## [0.0.5] - 2026-01-18

### ⚠️ Breaking Changes

#### Tool Naming Migration (snake_case)
All tools renamed to follow `verb_noun` pattern:
| Old | New |
|-----|-----|
| `Bash` | `run_command` |
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `edit_file` |
| `Glob` | `search_files` |
| `Grep` | `search_text` |
| `WebSearch` | `search_web` |
| `ExtractPageContent` | `extract_page` |
| `ZaiReader` | `read_page` |
| `Memory` | `manage_memory` |
| `ExecuteJS` | `execute_js` |

#### Removed Tools
- ❌ `InstallPackage` — no longer needed (dependencies bundled)

### 🚀 New Features

#### WASM Sandbox (execute_js)
- ✅ **QuickJS engine** — secure JavaScript execution via WebAssembly
- ✅ **No dependencies** — works out of the box from DMG/EXE
- ✅ **Available globals**: `fs`, `path`, `console`, `JSON`, `Math`, `Date`, `__dirname`
- ✅ **Path sandboxing** — can only access workspace folder

#### Document Support (read_document)
- ✅ **PDF extraction** — bundled `pdf-parse` library
- ✅ **DOCX extraction** — bundled `mammoth` library
- ✅ **Size limits** — max 10MB per file
- ✅ **Scanned PDF detection** — warns user about OCR requirements

### ⚡ Performance Optimizations

#### Streaming UI
- ✅ **60fps updates** — requestAnimationFrame-based throttling
- ✅ **Store optimization** — stream_event messages no longer saved to state
- ✅ **Memory fix** — removed full chunk collection during streaming
- ✅ **Lightweight logging** — no JSON.stringify on large response objects

### 📝 Documentation
- ✅ Updated README with new tool names and structure
- ✅ Added PROJECT_STATUS.md with current state
- ✅ Added bun installation instructions
- ✅ Removed obsolete docs (DYNAMIC_SANDBOX_SUMMARY, RENAME_SUMMARY, etc.)

### 🔧 Technical Changes
- New: `src/electron/libs/container/quickjs-sandbox.ts`
- New: `src/electron/libs/tools/read-document-tool.ts`
- Deleted: `src/electron/libs/tools/install-package-tool.ts`
- Updated: System prompt with new tool names

---

## [0.0.4] - 2026-01-16

### ✨ Features
- ✅ **Z.AI Reader** — alternative to Tavily for page extraction
- ✅ **Web Search Provider** — choice between Tavily and Z.AI
- ✅ **Memory Editor** — edit memory.md directly in settings

### 🐛 Bug Fixes
- 🔧 Fixed API 404 errors (baseURL must include `/v1`)
- 🔧 Fixed session history loading

---

## [0.0.3] - 2026-01-14

### 🚀 Major Changes

#### Migrated from Claude SDK to OpenAI SDK
- **Complete rewrite** of the API layer for better control
- **OpenAI SDK** (`openai`) replaces Claude Agent SDK
- **Full control** over temperature, tools, and request format
- **Better compatibility** with vLLM, local models, and OpenAI-compatible APIs

### ✨ Features

#### Configuration & Settings
- ✅ **GUI Settings Modal** - configure API key, base URL, model, and temperature
- ✅ **Temperature Control** - adjust model creativity (0.0 - 2.0)
- ✅ **Model Indicator** - shows current model in UI
- ✅ **Settings Storage** - saved to `~/.localdesk/settings.json`
- ✅ **No Claude Code required** - completely standalone

#### Security & Safety
- ✅ **Directory Sandboxing** - agent cannot access files outside working directory
- ✅ **Path Validation** - blocks `..` and absolute paths outside CWD
- ✅ **Security Logging** - warns when access is blocked

#### Context & History
- ✅ **Session History** - saves all messages to SQLite database
- ✅ **Context Loading** - history loaded and passed to model on continuation
- ✅ **Smart Deduplication** - prevents duplicate user prompts in context

#### System Prompt
- ✅ **Structured XML Prompt** - clear sections with tags
- ✅ **Current Directory** - included in system environment
- ✅ **Platform-Aware Commands** - Windows (PowerShell) vs Unix (Bash)
- ✅ **Tool Descriptions** - explicit tool list with examples

#### Tool Improvements
- ✅ **OpenAI Function Format** - proper JSON schema for tools
- ✅ **UTF-8 Encoding** - correct handling of Cyrillic and special characters
- ✅ **Windows Commands** - `dir`, `type`, `cd` instead of `ls`, `cat`, `pwd`
- ✅ **Fast Execution** - removed artificial delays

#### UI/UX Enhancements
- ✅ **Smart Auto-scroll** - sticks to bottom only when user is there
- ✅ **Manual Scroll Control** - scroll up to disable auto-scroll
- ✅ **Smooth Streaming** - RAF-based throttling for 60fps updates
- ✅ **No Cost Display** - removed for local models

#### Developer Experience
- ✅ **Request Logging** - full API requests saved to `~/.localdesk/logs/`
- ✅ **Console Debugging** - detailed logs for message flow
- ✅ **Message Inspection** - last 3 messages logged before each API call

### 🐛 Bug Fixes

#### Critical Fixes
- 🔧 **Cyrillic Encoding** - fixed `������` issue on Windows
  - Solution: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
- 🔧 **Duplicate User Prompts** - prevented duplicates in message history
- 🔧 **Missing Tool Results** - tool outputs now properly sent to model
- 🔧 **Streaming Lag** - removed 100ms delay per tool call
- 🔧 **Auto-scroll Issues** - fixed aggressive scrolling during typing

#### Platform-Specific Fixes
- 🔧 **Windows Commands** - model now uses correct PowerShell commands
- 🔧 **Path Handling** - proper path resolution with `resolve()` and `relative()`
- 🔧 **vLLM Compatibility** - auto-appends `/v1` to base URL

### 🔄 Technical Changes

#### Architecture
- **New Files:**
  - `src/electron/libs/runner-openai.ts` - OpenAI-based runner
  - `src/electron/libs/tools-definitions.ts` - tool schemas
  - `src/electron/libs/tools-executor.ts` - tool implementation
  
- **Modified Files:**
  - `src/electron/ipc-handlers.ts` - uses new runner
  - `src/ui/App.tsx` - improved auto-scroll logic
  - `src/ui/components/SettingsModal.tsx` - added temperature
  - `src/ui/components/EventCard.tsx` - removed cost display

- **Deprecated:**
  - `src/electron/libs/runner.ts` - old Claude SDK runner (kept for reference)

#### Data Storage
- **Settings:** `~/.localdesk/settings.json`
- **Database:** `~/.localdesk/sessions.db` (SQLite)
- **Logs:** `~/.localdesk/logs/openai-request-*.json`

### 📝 Documentation

- ✅ **README.md** - completely rewritten with new features
- ✅ **MIGRATION_GUIDE.md** - detailed migration guide
- ✅ **QUICKSTART.md** - 5-minute setup guide
- ✅ **CHANGELOG.md** - this file

### ⚠️ Breaking Changes

1. **No backward compatibility** with original settings
   - Old: `~/.claude/settings.json`
   - New: `~/.localdesk/settings.json`

2. **Different API format** - OpenAI instead of Claude
   - Must configure API key, base URL, model in GUI
   - Temperature now configurable (was hardcoded in Claude SDK)

3. **Tool format changed** - OpenAI function calling schema
   - Models must support function calling
   - vLLM must use `--enable-auto-tool-choice`

### 🔮 Future Plans

- [ ] Streaming performance optimization
- [ ] More tool types (web search, image generation)
- [ ] Multi-session management improvements
- [ ] Model comparison mode
- [ ] Export conversation to markdown
- [ ] Custom tool definitions

---

## [0.0.2] - 2025-12-XX (Original Fork)

### Initial Features
- Basic Electron app
- Claude SDK integration
- File management tools
- Session management

---

## [0.0.1] - 2025-11-XX (Original Project)

### Initial Release
- Desktop app for Claude Code
- Basic GUI for Claude Agent SDK
- Tool calling support

---

**Note:** This project is a community fork focused on flexibility, local model support, and user control.

**License:** MIT  
**Author:** [Valerii Kovalskii](https://github.com/vakovalskii)  
**Repository:** https://github.com/vakovalskii/LocalDesk
