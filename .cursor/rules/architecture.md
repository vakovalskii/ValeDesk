# Project Architecture

## Overview

LocalDesk is an Electron app with React frontend and Node.js backend.

```
┌─────────────────────────────────────────────────────┐
│                    Electron                          │
│  ┌─────────────────┐      ┌─────────────────────┐  │
│  │   Main Process  │ IPC  │  Renderer Process   │  │
│  │   (Node.js)     │◄────►│  (React + Vite)     │  │
│  │                 │      │                     │  │
│  │  - LLM Runner   │      │  - Chat UI          │  │
│  │  - Tool Exec    │      │  - Settings Modal   │  │
│  │  - SQLite DB    │      │  - Todo Panel       │  │
│  │  - File I/O     │      │  - Zustand Store    │  │
│  └─────────────────┘      └─────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── electron/                    # Main process
│   ├── main.ts                 # Entry point, window creation
│   ├── ipc-handlers.ts         # IPC message handlers
│   ├── preload.cts             # Preload script (contextBridge)
│   ├── types.ts                # Shared types
│   └── libs/
│       ├── runner-openai.ts    # LLM agent loop
│       ├── tools-executor.ts   # Tool dispatch & execution
│       ├── tools-definitions.ts # Tool filtering by settings
│       ├── session-store.ts    # SQLite persistence
│       ├── settings-store.ts   # API settings
│       ├── prompt-loader.ts    # System prompt builder
│       ├── container/
│       │   └── quickjs-sandbox.ts  # WASM JS sandbox
│       ├── prompts/
│       │   ├── system.txt      # System prompt template
│       │   └── initial_prompt.txt
│       └── tools/              # Individual tool implementations
│           ├── index.ts        # Tool registry
│           ├── bash-tool.ts    # run_command
│           ├── read-tool.ts    # read_file
│           ├── write-tool.ts   # write_file
│           ├── edit-tool.ts    # edit_file
│           └── ...
│
└── ui/                         # Renderer process
    ├── main.tsx               # React entry
    ├── App.tsx                # Root component
    ├── components/
    │   ├── ChatArea.tsx       # Message display
    │   ├── PromptInput.tsx    # User input
    │   ├── TodoPanel.tsx      # Task planning UI
    │   ├── SettingsModal.tsx  # Configuration
    │   ├── Sidebar.tsx        # Session list
    │   └── EventCard.tsx      # Tool result display
    └── store/
        └── useAppStore.ts     # Zustand state
```

## Key Files

### Main Process

| File | Purpose |
|------|---------|
| `main.ts` | App lifecycle, window creation, menu |
| `ipc-handlers.ts` | Handle messages from renderer |
| `runner-openai.ts` | LLM agent loop with streaming |
| `tools-executor.ts` | Execute tools, handle permissions |
| `session-store.ts` | SQLite CRUD for sessions |
| `prompt-loader.ts` | Build system prompt from template |

### Renderer Process

| File | Purpose |
|------|---------|
| `App.tsx` | Main layout, routing |
| `useAppStore.ts` | Global state (Zustand) |
| `ChatArea.tsx` | Message rendering, streaming |
| `PromptInput.tsx` | User input with shortcuts |

## Data Flow

### User Message → LLM Response

```
1. User types message in PromptInput
2. PromptInput calls window.electronAPI.sendPrompt()
3. IPC sends to main process → ipc-handlers.ts
4. ipc-handlers starts runner-openai.ts
5. runner builds messages array with system prompt
6. runner calls OpenAI API with streaming
7. Stream chunks sent via IPC to renderer
8. ChatArea updates UI with requestAnimationFrame
9. If tool_calls in response:
   a. tools-executor.ts runs tool
   b. Result added to messages
   c. Loop back to step 5
10. Final response displayed
```

### Tool Execution

```
1. LLM returns tool_calls in response
2. runner-openai.ts extracts tool name & args
3. Check permission mode (ask/default)
4. If ask: send permission.request event, wait
5. tools-executor.ts dispatches to specific tool
6. Tool returns { success, output } or { success: false, error }
7. Result added to messages as tool role
8. Continue agent loop
```

## IPC Events

### Renderer → Main
- `send-prompt` - Start new message
- `abort-session` - Stop current generation
- `permission-response` - Approve/deny tool
- `load-settings` / `save-settings`

### Main → Renderer
- `stream.message` - Streaming content chunks
- `permission.request` - Ask user to approve tool
- `session.status` - Session state changes
- `todos.updated` - Task list changed

## Database Schema (SQLite)

```sql
sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  cwd TEXT,
  model TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  pinned INTEGER DEFAULT 0
)

messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  type TEXT,  -- 'user_prompt', 'text', 'tool_use', 'tool_result'
  data TEXT,  -- JSON
  created_at INTEGER
)

todos (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  todos TEXT  -- JSON array
)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 32+ |
| Frontend | React 19, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS |
| Database | better-sqlite3 |
| JS Sandbox | quickjs-emscripten (WASM) |
| PDF | pdf-parse |
| DOCX | mammoth |
| Build | Vite + electron-builder |
