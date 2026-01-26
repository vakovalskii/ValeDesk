<div align="center">

# LocalDesk

[![Version](https://img.shields.io/badge/version-0.0.7-blue.svg)](https://github.com/vakovalskii/LocalDesk/releases)
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
- ✅ **Code Sandboxes** — JavaScript (Node.js vm) and Python (system subprocess) execution
- ✅ **Document Support** — PDF and DOCX text extraction (bundled, works out of the box)
- ✅ **Web Search** — Tavily and Z.AI integration for internet search
- ✅ **Telegram Parsing** — render t.me channels with reactions, views, auto-scroll for older posts
- ✅ **Security** — directory sandboxing for safe file operations
- ✅ **Cross-platform** — Windows, macOS, Linux with proper shell commands

### UI/UX Features
- ✅ **Modern Interface** — React + Tauri with smooth auto-scroll and streaming
- ✅ **Message Editing** — edit and resend messages with history truncation
- ✅ **Session Persistence** — sessions survive app restart (SQLite backed)
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

## 🤔 Why LocalDesk?

### Open Architecture & Full Control
LocalDesk isn't just another AI assistant — **it's a framework you own**. Built with TypeScript and Electron, every component is transparent and modifiable:

- **Readable codebase** — well-structured, documented code you can understand
- **Easy customization** — add new tools, modify prompts, change UI without black boxes
- **Your rules** — adjust behavior, safety limits, and workflows to match your needs
- **No vendor lock-in** — works with any OpenAI-compatible API (vLLM, Ollama, LM Studio)

### 100% Local & Private
Everything runs **on your machine**:

- **Local inference** — use Ollama, vLLM, or LM Studio for complete privacy
- **No data collection** — your conversations never leave your computer
- **Offline capable** — works without internet (except web search tools)
- **Sandboxed execution** — secure JavaScript sandbox and file operation restrictions

### Experiment & Iterate
Perfect for developers, researchers, and AI enthusiasts:

- **Test local models** — compare Qwen, Llama, DeepSeek, and others
- **Debug API calls** — full request/response logs for every interaction
- **Prototype tools** — add custom functions in minutes
- **Monitor performance** — track tokens, timing, and resource usage

### Real Use Cases
```bash
# Run Ollama locally (free, 100% private)
ollama serve
# Configure LocalDesk: http://localhost:11434/v1

# Or use vLLM for faster inference
vllm serve Qwen/Qwen2.5-14B-Instruct --port 8000
# Configure LocalDesk: http://localhost:8000/v1
```

**TL;DR:** LocalDesk gives you the **power of ChatGPT/Claude** with the **freedom of open source** and **privacy of local execution**.

## 🚀 Quick Start

### Prerequisites

- **Rust** 1.74+ ([install](https://rustup.rs/))
- **Node.js** 20+ 
- **Python 3** (for `execute_python` tool)

### Development (macOS/Linux)

```bash
# Clone and enter
git clone https://github.com/vakovalskii/LocalDesk.git
cd LocalDesk

# Install dependencies
npm install

# Run in development mode
make dev
```

### Build Standalone App

```bash
# Build DMG (macOS)
make bundle

# Output: LocalDesk-0.0.7.dmg
```

### Manual Build Steps

```bash
# 1. Build sidecar binary
npm run build:sidecar

# 2. Build Tauri app
cd src-tauri && cargo build --release

# 3. Create DMG
hdiutil create -volname "LocalDesk" \
  -srcfolder src-tauri/target/release/bundle/macos/LocalDesk.app \
  -ov -format UDZO LocalDesk-0.0.7.dmg
```

### Windows (coming soon)

Windows build requires cross-compilation setup. Check `.github/workflows/` for CI builds.

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
| `execute_js` | Run JavaScript in secure Node.js vm sandbox |
| `execute_python` | Run Python code (system Python with pip packages) |

### Web Tools
| Tool | Description |
|------|-------------|
| `search_web` | Search the internet (Tavily/Z.AI) |
| `extract_page` | Extract full page content (Tavily only) |
| `read_page` | Read web page content (Z.AI Reader) |
| `render_page` | Render JS-heavy pages via Chromium (Telegram, SPAs) |

### Task Management

![photo_2026-01-19_00-55-13](https://github.com/user-attachments/assets/5d7c2122-9023-4e8a-be0d-e63b666cea7b)


| Tool | Description |
|------|-------------|
| `manage_todos` | Create/update task plans with visual progress tracking |

### Memory
| Tool | Description |
|------|-------------|
| `manage_memory` | Store/read persistent user preferences |

> **Security:** All file operations are sandboxed to the workspace folder only.

## 📦 Building

### Windows
```powershell
# Build executable and installer
npm run dist:win

# Output: dist/LocalDesk Setup 0.0.7.exe
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

## 🛠️ Contributing

See [CURSOR.md](CURSOR.md) for development guidelines and project architecture.

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=vakovalskii/LocalDesk&type=Date)](https://star-history.com/#vakovalskii/LocalDesk&Date)

## 📄 License

**LocalDesk Community License** — free for individuals and companies with revenue under $1M/year. Commercial license required for larger organizations.

See [LICENSE](LICENSE) for full terms.

---

<div align="center">

**Made with ❤️ by [Valerii Kovalskii](https://github.com/vakovalskii)**

</div>
