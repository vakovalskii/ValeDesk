<div align="center">

# Agent Cowork - Local LLM Edition

[![Version](https://img.shields.io/badge/version-0.0.3-blue.svg)](https://github.com/vakovalskii/Cowork-Local-LLM/releases)
[![Platform](https://img.shields.io/badge/platform-%20Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/vakovalskii/Cowork-Local-LLM)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Desktop AI Assistant with Local Model Support**

> 🔱 Forked from [DevAgentForge/Claude-Cowork](https://github.com/DevAgentForge/Claude-Cowork)  
> Reworked to support OpenAI SDK and local models (vLLM, Qwen, Llama)

</div>

---


https://github.com/user-attachments/assets/f60afb47-05cc-4578-9550-a319f1eae7df


## ✨ Features

### Core Capabilities
- ✅ **OpenAI SDK** — full API control, compatible with any OpenAI-compatible endpoint
- ✅ **Local Models** — vLLM, Ollama, LM Studio support
- ✅ **Modular Tools** — each tool in separate file for easy maintenance
- ✅ **Web Search** — Tavily integration for internet search (optional)
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
- ✅ **Memory System** — persistent storage of user preferences in `~/.agent-cowork/memory.md`
- ✅ **Dynamic Memory** — automatic reload after memory updates within same session
- ✅ **Memory Editor** — edit memory directly in settings with reload/open folder buttons
- ✅ **Token Tracking** — display input/output tokens and API duration
- ✅ **Request Logging** — full raw JSON request/response logs for debugging
- ✅ **JavaScript Sandbox** — isolated Node.js VM for executing JS code within workspace
- ✅ **Package Management** — install npm packages into isolated sandbox (`.cowork-sandbox/`)
- ✅ **PDF Support** — extract text from PDF files using `pdf-parse` library
- ✅ **Optional Workspace** — start empty chats without workspace folder, add it later when needed
- ✅ **Stop Streaming** — interrupt LLM responses at any time

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/vakovalskii/Cowork-Local-LLM.git
cd Cowork-Local-LLM

# Install dependencies (use bun for faster install)
bun install
# or
npm install

# Compile Electron code
npm run transpile:electron
```

### Running in Development

```bash
# Start both Vite and Electron
npm run dev
```

Or manually in two terminals:

**Terminal 1 - React Dev Server:**
```bash
npm run dev:react
```

**Terminal 2 - Electron (after Vite starts):**
```bash
# macOS/Linux
NODE_ENV=development npx electron .

# Windows PowerShell
$env:NODE_ENV='development'; npx electron .
```

### Configuration

1. Click **Settings** (⚙️) in the app
2. Configure your API:
   - **API Key** — your key (or `dummy-key` for local models)
   - **Base URL** — API endpoint
   - **Model Name** — model identifier
   - **Temperature** — 0.0-2.0 (default: 0.3)
   - **Permission Mode** — `ask` (confirm each tool) or `default` (auto-execute)
   - **Tavily API Key** (optional) — for web search
   - **Enable Memory** — toggle persistent memory system
3. Click **Save Settings**

### Example Configurations

**Local vLLM:**
```json
{
  "apiKey": "dummy-key",
  "baseUrl": "http://localhost:8000",
  "model": "qwen3-30b-a3b-instruct-2507",
  "temperature": 0.3
}
```

**Claude:**
```json
{
  "apiKey": "sk-ant-...",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-20250514",
  "temperature": 0.3
}
```

**OpenAI:**
```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com",
  "model": "gpt-4",
  "temperature": 0.3
}
```

## 🦙 Local Model Setup (vLLM)

```bash
vllm serve qwen3-30b-a3b-instruct-2507 \
  --port 8000 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

**Requirements:**
- OpenAI-compatible API (`/v1/chat/completions`)
- Function calling support
- Streaming support

## 🧠 Memory System

The Memory feature allows the agent to remember user preferences and context across sessions:

1. **Enable in Settings:** Toggle "Enable Memory" in Settings (⚙️)
2. **Automatic Storage:** Agent proactively notes important information from conversations
3. **Manual Commands:** Ask agent to "remember" or "forget" specific things
4. **Edit Memory:** View and edit `memory.md` directly in Settings
5. **Dynamic Reload:** Memory updates are immediately available in the current session

**Memory Location:** `~/.agent-cowork/memory.md`

**Example Usage:**
```
User: "Remember that I prefer Python over JavaScript"
Agent: [Stores in memory.md]

User: "What language do I prefer?"
Agent: "You prefer Python over JavaScript" ✅
```

## 🛠️ Available Tools

### File Operations
- **Bash** — execute shell commands (PowerShell/bash)
- **Read** — read file contents (text files only)
- **Write** — create new files (prevents overwriting existing files)
- **Edit** — modify files (search & replace)

### Search Tools
- **Glob** — find files by pattern (supports `**/*.pdf`, `*.js`, etc.)
- **Grep** — search text in files

### Code Execution
- **ExecuteJS** — run JavaScript code in isolated Node.js VM sandbox
  - Access to: `fs`, `path`, `crypto`, `console`, `__dirname`
  - Can `require()` built-in modules and installed packages
  - Isolated to workspace folder for security
- **InstallPackage** — install npm packages into `.cowork-sandbox/` directory
  - Example: `InstallPackage(['lodash', 'axios', 'pdf-parse'])`

### Web Tools (Optional)
- **WebSearch** — search the web using Tavily API
- **ExtractPageContent** — extract full content from web pages

### Memory Management
- **Memory** — persistent storage for user preferences and context
  - `create` — initialize memory file
  - `append` — add new information
  - `delete` — remove specific entries
  - `read` — view current memory

> **Note:** Web tools require Tavily API key in Settings. Memory tool requires "Enable Memory" toggle.  
> **Security:** ExecuteJS and file operations are sandboxed to the workspace folder only.

## 📦 Building

### macOS (DMG)
```bash
npm run dist:mac
```

### Windows (EXE)
```bash
npm run dist:win
```

### Linux (AppImage)
```bash
npm run dist:linux
```

## 🏗️ Project Structure

```
src/
├── electron/                    # Electron main process
│   ├── main.ts                 # Entry point
│   ├── ipc-handlers.ts         # IPC communication
│   └── libs/
│       ├── runner-openai.ts    # OpenAI API runner
│       ├── prompt-loader.ts    # Prompt template loader
│       ├── tools-executor.ts   # Tool execution logic
│       ├── prompts/
│       │   ├── system.txt      # System prompt template
│       │   └── initial_prompt.txt # Initial prompt template
│       └── tools/              # Modular tool definitions
│           ├── base-tool.ts    # Base interfaces
│           ├── bash-tool.ts    # Shell execution
│           ├── read-tool.ts    # File reading
│           ├── write-tool.ts   # File creation
│           ├── edit-tool.ts    # File editing
│           ├── glob-tool.ts    # File search
│           ├── grep-tool.ts    # Text search
│           ├── execute-js-tool.ts # JS sandbox execution
│           ├── install-package-tool.ts # npm package installer
│           ├── web-search.ts   # Web search (Tavily)
│           ├── extract-page-content.ts # Page extraction
│           └── memory-tool.ts  # Memory management
└── ui/                         # React frontend
    ├── App.tsx                 # Main component
    ├── components/             # UI components
    └── store/                  # Zustand state management
```

## 🔐 Data Storage

### Application Data
**Windows:** `C:\Users\YourName\AppData\Roaming\agent-cowork\`  
**macOS:** `~/Library/Application Support/agent-cowork/`  
**Linux:** `~/.config/agent-cowork/`

Files:
- `sessions.db` — SQLite database with chat history
- `api-settings.json` — API configuration

### Global Data (All Platforms)
- `~/.agent-cowork/logs/` — raw JSON request/response logs (debugging)
- `~/.agent-cowork/memory.md` — persistent memory storage (user preferences, context)

## 🤝 Contributing

1. Fork the repository
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Commit (`git commit -m 'Add feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

<div align="center">

**Made with ❤️ by [Valerii Kovalskii](https://github.com/vakovalskii)**

Based on [DevAgentForge/Claude-Cowork](https://github.com/DevAgentForge/Claude-Cowork)

</div>
