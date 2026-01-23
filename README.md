<div align="center">

# LocalDesk

[![Version](https://img.shields.io/badge/version-0.0.6-blue.svg)](https://github.com/vakovalskii/LocalDesk/releases)
[![Platform](https://img.shields.io/badge/platform-%20Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/vakovalskii/LocalDesk)
[![License](https://img.shields.io/badge/license-Community-blue.svg)](LICENSE)

**Desktop AI Assistant with Local Model Support**

</div>

---


https://github.com/user-attachments/assets/a8c54ce0-2fe0-40c3-8018-026cab9d7483


## ✨ Features

### Core Capabilities
- ✅ **Task Planning** — visual todo panel with progress tracking, persisted per session
- ✅ **OpenAI SDK** — full API control, compatible with any OpenAI-compatible endpoint
- ✅ **Local Models** — vLLM, Ollama, LM Studio support
- ✅ **WASM Sandbox** — secure JavaScript execution via QuickJS (no Node.js required)
- ✅ **Document Support** — PDF and DOCX text extraction (bundled, works out of the box)
- ✅ **Web Search** — Tavily and Z.AI integration for internet search
- ✅ **Telegram Parsing** — render t.me channels with reactions, views, auto-scroll for older posts
- ✅ **Security** — directory sandboxing for safe file operations
- ✅ **Cross-platform** — Windows, macOS, Linux with proper shell commands

### UI/UX Features
- ✅ **Modern Interface** — React + Electron with smooth auto-scroll and streaming
- ✅ **Message Editing** — edit and resend messages with history truncation
- ✅ **Session Management** — pin important sessions, search through chat history
- ✅ **Keyboard Shortcuts** — Cmd+Enter/Ctrl+Enter to send messages
- ✅ **Spell Check** — built-in spell checking with context menu suggestions
- ✅ **Permission System** — ask/default modes for tool execution control

### Advanced Features
- ✅ **Memory System** — persistent storage of user preferences in `~/.localdesk/memory.md`
- ✅ **Token Tracking** — display input/output tokens and API duration
- ✅ **Optimized Streaming** — requestAnimationFrame-based UI updates (60fps)
- ✅ **Stop Streaming** — interrupt LLM responses at any time
- ✅ **Loop Detection** — automatic detection of stuck tool call loops (5+ sequential same-tool calls)
- ✅ **Request Timeouts** — 5-minute timeout with auto-retry for LLM requests
- ✅ **Session Logging** — full request/response JSON logs per iteration in `~/.localdesk/logs/sessions/`

## 🚀 Quick Start

### Tauri edition 

```
git clone https://github.com/vakovalskii/LocalDesk.git 
make dev 
```
for stand-alone binary
```
make bundle 
```

### Legacy Electron Installation (Windows):

```powershell
# Clone the repository
git clone https://github.com/vakovalskii/LocalDesk.git
cd LocalDesk

# Install dependencies
npm install

# Run in development mode (single terminal)
npm run dev:win
```

> **Notes:**
> - First run may take 10-15 seconds while dependencies compile. Subsequent runs will be faster.
> - **To stop:** Press `Ctrl+C` twice to fully terminate both processes (first Ctrl+C sends graceful shutdown, second forces termination).

**Alternative Legacy Electron: Manual mode (2 terminals)**

Terminal 1 - Start Vite dev server:
```powershell
npm run dev:react
```

Terminal 2 - Start Electron (wait 5-10 seconds):
```powershell
npm run transpile:electron
cross-env NODE_ENV=development npx electron .
```

**Production mode:**
```powershell
npm run build
npx electron .
```

### Installation (macOS/Linux - npm)

```bash
# Clone the repository
git clone https://github.com/vakovalskii/LocalDesk.git
cd LocalDesk

# Install dependencies
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w better-sqlite3

# Run in development mode
npm run dev
```

### Installation (macOS/Linux - bun) ⚡

```bash
# Clone the repository
git clone https://github.com/vakovalskii/LocalDesk.git
cd LocalDesk

# Install dependencies (faster)
bun install

# Rebuild native modules for Electron
bunx electron-rebuild -f -w better-sqlite3

# Run in development mode
bun run dev
```

> **Note:** Bun is significantly faster for dependency installation (~3x speedup)

### Configuration

1. Click **Settings** (⚙️) in the app
2. Configure your API:
   - **API Key** — your key (or `dummy-key` for local models)
   - **Base URL** — API endpoint (must include `/v1`)
   - **Model Name** — model identifier
   - **Temperature** — 0.0-2.0 (default: 0.3)
3. Click **Save Settings**

### Example Configurations

**Local vLLM:**
```json
{
  "apiKey": "dummy-key",
  "baseUrl": "http://localhost:8000/v1",
  "model": "qwen3-30b-a3b-instruct-2507"
}
```

**OpenAI:**
```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4"
}
```

## 🎯 Skills Marketplace

Browse and install verified skills for LocalDesk: **[Skills Marketplace](https://vakovalskii.github.io/LocalDesk-Skills/)**

<img width="974" height="1123" alt="image" src="https://github.com/user-attachments/assets/8c7fa387-599d-48ab-999a-d5b9c5f811f7" />


## 🛠️ Available Tools

All tools follow `snake_case` naming convention (`verb_noun` pattern):

### File Operations
| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands (PowerShell/bash) |
| `read_file` | Read text file contents |
| `write_file` | Create new files |
| `edit_file` | Modify files (search & replace) |
| `search_files` | Find files by glob pattern (`*.pdf`, `src/**/*.ts`) |
| `search_text` | Search text content in files (grep) |
| `read_document` | Extract text from PDF/DOCX (max 10MB) |

### Code Execution
| Tool | Description |
|------|-------------|
| `execute_js` | Run JavaScript in secure WASM sandbox (QuickJS) |

**execute_js** features:
- Available globals: `fs`, `path`, `console`, `JSON`, `Math`, `Date`, `__dirname`
- No imports needed — use globals directly
- No TypeScript, no async/await, no npm packages
- Use `return` statement to output results

### Web Tools
| Tool | Description |
|------|-------------|
| `search_web` | Search the internet (Tavily/Z.AI) |
| `extract_page` | Extract full page content (Tavily only) |
| `read_page` | Read web page content (Z.AI Reader) |
| `render_page` | Render JS-heavy pages via Chromium (Telegram, SPAs) |

**render_page** features:
- Auto-converts `t.me/channel` → `t.me/s/channel` (web preview)
- Extracts reactions, views, dates from Telegram posts
- Auto-scrolls to load older posts (`max_posts` parameter)
- Works with any JavaScript-rendered page

### Task Management

![photo_2026-01-19_00-55-13](https://github.com/user-attachments/assets/5d7c2122-9023-4e8a-be0d-e63b666cea7b)


| Tool | Description |
|------|-------------|
| `manage_todos` | Create/update task plans with visual progress tracking |

**manage_todos** features:
- Actions: `create`, `update`, `clear`
- Statuses: `pending`, `in_progress`, `completed`, `cancelled`
- Persisted per session in SQLite database
- Visual TodoPanel with progress bar

### Memory
| Tool | Description |
|------|-------------|
| `manage_memory` | Store/read persistent user preferences |

> **Security:** All file operations are sandboxed to the workspace folder only.

## 🏗️ Project Structure

```
src/
├── electron/                    # Electron main process
│   ├── main.ts                 # Entry point
│   ├── ipc-handlers.ts         # IPC communication
│   └── libs/
│       ├── runner-openai.ts    # OpenAI API runner
│       ├── tools-executor.ts   # Tool execution logic  
│       ├── session-store.ts    # SQLite session persistence
│       ├── container/
│       │   └── quickjs-sandbox.ts  # WASM sandbox
│       ├── prompts/
│       │   └── system.txt      # System prompt template
│       └── tools/              # Tool definitions (snake_case)
│           ├── bash-tool.ts        # run_command
│           ├── read-tool.ts        # read_file
│           ├── write-tool.ts       # write_file
│           ├── edit-tool.ts        # edit_file
│           ├── glob-tool.ts        # search_files
│           ├── grep-tool.ts        # search_text
│           ├── execute-js-tool.ts  # execute_js
│           ├── read-document-tool.ts # read_document
│           ├── web-search.ts       # search_web
│           ├── extract-page-content.ts # extract_page
│           ├── render-page-tool.ts # render_page (Telegram/SPA)
│           ├── zai-reader.ts       # read_page
│           ├── manage-todos-tool.ts # manage_todos
│           └── memory-tool.ts      # manage_memory
└── ui/                         # React frontend
    ├── App.tsx                 # Main component
    ├── components/
    │   ├── TodoPanel.tsx       # Task planning UI
    │   ├── PromptInput.tsx     # Message input
    │   └── ...
    └── store/
        └── useAppStore.ts      # Zustand state management
```

## 📦 Building

### Windows
```powershell
# Build executable and installer
npm run dist:win

# Output: dist/LocalDesk Setup 0.0.6.exe
```

### macOS
```bash
# Build DMG (ARM64)
npm run dist:mac-arm64

# Build DMG (Intel x64)
npm run dist:mac-x64
```

### Linux
```bash
# Build AppImage
npm run dist:linux
```

## 🔐 Data Storage

### Application Data
- **Windows:** `C:\Users\YourName\AppData\Roaming\localdesk\`
- **macOS:** `~/Library/Application Support/localdesk/`
- **Linux:** `~/.config/localdesk/`

Files:
- `sessions.db` — SQLite database with chat history and todos
- `api-settings.json` — API configuration

### Global Data
- `~/.localdesk/memory.md` — persistent memory storage
- `~/.localdesk/logs/sessions/{session-id}/` — per-session API logs:
  - `turn-001-request.json` — full request (model, messages, tools, temperature)
  - `turn-001-response.json` — full response (usage, content, tool_calls)

## 📄 License

**LocalDesk Community License** — free for individuals and companies with revenue under $1M/year. Commercial license required for larger organizations.

See [LICENSE](LICENSE) for full terms.

---

<div align="center">

**Made with ❤️ by [Valerii Kovalskii](https://github.com/vakovalskii)**

</div>
