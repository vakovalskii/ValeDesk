# План миграции LocalDesk с Electron на Tauri

## 0) Цели и рамки

**Цели:**
- Уйти с Electron на Tauri, сохранив UX и ключевые фичи.
- Снизить размер дистрибутива и потребление памяти (там, где это реально достижимо).
- Усилить security-модель (меньше “всего Node в рантайме”, явные allowlist’ы).
- Release engineering: **one distributable artifact per platform per release** (e.g., `.dmg/.app` for macOS, `.msi/.exe` for Windows, `.AppImage/.deb/.rpm` for Linux). The artifact may contain multiple binaries (e.g., a Node sidecar), but shipping should remain “single-click” for the end user.

**Не-цели (на первую итерацию):**
- Полный редизайн UI/UX.
- Переписывание всего tool-системы “с нуля” без сохранения поведения.
- Мгновенный отказ от всех Node-зависимостей (Playwright/парсеры) в первый релиз.

**Текущее состояние (по коду):**
- UI: React + Vite (`src/ui/*`).
- Backend: Electron main + Node-логика (`src/electron/*`), IPC через preload (`src/electron/preload.cts`).
- Данные: SQLite через `better-sqlite3` (sessions.db), настройки JSON в `userData`, память в `~/.localdesk/memory.md`.

## Current implementation status (repo)

This section describes what is already implemented in the repository (not what is still planned).

### Runtime architecture (current)

- **UI**: React/Vite under `LocalDesk/src/ui/`
- **Tauri host (Rust)**: `LocalDesk/src-tauri/`
  - Starts a **Node sidecar** process and proxies IPC.
  - Emits `"server-event"` to the UI via the Tauri event bus.
- **Node sidecar (TypeScript -> Node runtime)**: `LocalDesk/src/sidecar/`
  - Runs the existing backend logic (sessions, runners, tools) on top of `src/electron/libs/*`.
  - IPC protocol: newline-delimited JSON over stdin/stdout (`client-event` → sidecar, `server-event` ← sidecar).

### UI platform abstraction (done)

- Implemented `LocalDesk/src/ui/platform/*` with `getPlatform()`:
  - `platform/electron.ts` wraps existing `window.electron`.
  - `platform/tauri.ts` uses `window.__TAURI__` (`invoke` + `event.listen`) and maps the legacy channels (`list-directory`, `read-memory`, etc.) to Rust commands.

### Tauri ↔ sidecar IPC (done)

- `src-tauri/src/main.rs`:
  - `client_event(...)`: forwards **all** client events to sidecar **except** `open.external` (handled by host).
  - Sidecar stdout messages `{ "type": "server-event", "event": ... }` are forwarded to the UI via `emit_all("server-event", ...)`.
- Sidecar requires a user data dir via env:
  - `LOCALDESK_USER_DATA_DIR` is injected by the Tauri host and used by the ported stores.

### Developer workflow (dev)

- `make dev` (repo root) runs the full stack: sidecar build → Vite dev server → Tauri host.
  - The actual logic lives in `LocalDesk/Makefile`.
  - Requires `cargo-tauri` (Tauri CLI as a cargo subcommand).

### Known limitations (current)

- `render_page` tool is **Electron-only** (depends on `BrowserWindow`) and is disabled in pure sidecar mode.
- `list_directory` Rust command is currently MVP (no “within cwd” sandboxing yet).

## 1) Инвентаризация фич и маппинг на Tauri

### 1.1. IPC/интеграции ОС (минимальный набор для запуска UI)
| Сейчас (Electron) | Где | Цель в Tauri |
|---|---|---|
| `client-event` → backend | `src/electron/main.ts`, `src/electron/ipc-handlers.ts` | `invoke("client_event", payload)` или единый `invoke("dispatch", ...)` |
| `server-event` → UI | `ipc-handlers.ts` | `app.emit_all("server-event", payload)` + `listen` в UI |
| Диалоги выбора папки | `select-directory` | `tauri-plugin-dialog` |
| Открыть файл/папку/URL | `shell.openPath/openExternal` | `tauri-plugin-shell` |
| Context menu + spellcheck | `main.ts` (Menu, spellchecker) | на первом этапе — webview-дефолт; при необходимости — кастомный контекст-меню в UI |
| Build info | `get-build-info` | `tauri::AppHandle::package_info()` + сборочный метадатa-файл |

### 1.2. Хранилище и данные
| Сейчас | Где | Цель в Tauri |
|---|---|---|
| SQLite `sessions.db` | `src/electron/libs/session-store.ts` | `rusqlite/sqlx` + совместимая схема + миграция пути |
| Настройки `api-settings.json`, `llm-providers-settings.json`, etc | `src/electron/libs/*-store.ts` | `tauri-plugin-store` (JSON) + секреты в `stronghold`/keychain (опционально) |
| Memory `~/.localdesk/memory.md` | `src/electron/main.ts` | сохранить путь ради совместимости или перенести в app-data с импортом |

### 1.3. Tool-система (самая большая часть миграции)
Папка: `src/electron/libs/tools/*`

Критично определить стратегию:
- **A. Временный Node-sidecar** (быстрый MVP): поднять текущий TS-backend как отдельный процесс и дергать его из Tauri.
- **B. Полный перенос в Rust** (финальная цель): переписать tool-исполнение, раннеры, scheduler и сторы на Rust.
- **C. Гибрид**: критические/безопасностные вещи (FS/commands/DB) в Rust, “тяжелые” (Playwright) как sidecar.

Рекомендация: **стартовать с C (или A → C)**, чтобы быстро получить рабочий Tauri-билд и параллельно уменьшать Node-след.

## Packaging definition (clarification)

The phrase “one file” in this plan means **one release artifact per OS** (installer/bundle), not “a single executable with zero external files”.

- **macOS**: ship as a signed & notarized `.app` (typically distributed via `.dmg`/`.pkg`). The app bundle can embed a sidecar binary under `Contents/MacOS/` or `Contents/Resources/`.
- **Windows**: ship as `.msi` or a signed installer. Sidecar is installed next to the main app binary.
- **Linux**: ship as `.AppImage` or distro packages. Sidecar is bundled inside the AppImage/package.

This keeps end-user deployment simple while allowing Strategy A (Node-sidecar) in early phases.

Important: Tauri relies on the **system WebView**:
- **Windows 11 (decision)**: **bundle WebView2 runtime** as part of the Windows release artifact/installer so the user never installs anything extra. Prefer an **offline installer** mode (bigger artifact, but no external prerequisites).
- **Linux**: WebKitGTK (AppImage can bundle many deps, but you still need to validate the minimum supported distros/libraries).

## 2) Стратегия миграции (по фазам)

### Фаза 0 — Подготовка (1–2 дня)
- [ ] Зафиксировать “Definition of Done” для v1 Tauri (какие фичи обязаны быть, какие можно отложить).
- [ ] Выписать полный список IPC-каналов/команд и событий (источник: `src/electron/main.ts`, `src/electron/ipc-handlers.ts`, `src/ui/hooks/useIPC.ts`).
- [ ] Определить “критический путь”: чат/стриминг, сессии, файловые операции, web search, memory.
- [ ] Решить стратегию по Playwright/браузерному tool’у (в MVP часто можно отключить или вынести в sidecar).
- [ ] Define release artifacts and runtime dependency policy (per OS):
  - Windows 11: **bundle WebView2 runtime** (offline installer preferred); the installer must install it silently if missing.
  - Linux: target distros / AppImage vs packages; required libraries.
  - macOS: signing/notarization requirements and entitlements (including embedded sidecar).

### Фаза 1 — Абстракция платформы в UI (1–2 дня)
Цель: UI должен вызывать **не `window.electron` напрямую**, а через интерфейс `platform`.

- [x] Introduce `LocalDesk/src/ui/platform/*`:
  - interface: `invoke`, `sendClientEvent`, `onServerEvent`, plus host helpers.
  - `electron` implementation: thin wrapper over `window.electron`.
  - `tauri` implementation: real `invoke/listen` implementation (no stub).
- [x] Migrate UI code (`useIPC.ts`, FileBrowser, Settings, etc.) to use `platform`.
- [x] Keep Electron build working (platform adapter keeps compatibility).

**Контрольная точка:** Electron приложение работает без регрессий, UI не зависит от `window.electron` напрямую.

### Фаза 2 — Bootstrap Tauri (2–3 дня)
- [x] Add `LocalDesk/src-tauri/` (Tauri v2) and wire it to Vite dev server.
- [x] Configure UI build for Tauri (`frontendDist`, `devUrl`, `base: './'`).
- [x] Bring up the current React UI in Tauri (dev via `cargo tauri dev`).

**Контрольная точка:** `cargo tauri dev` запускает UI.

### Фаза 3 — Минимальный IPC в Tauri (3–5 дней)
Цель: заменить базовые IPC штуки без переноса всей бизнес-логики.

- [x] Implement Tauri commands (MVP set):
  - `select_directory`
  - `open_external_url`
  - `open_path_in_finder` / `open_file`
  - `list_directory` (**MVP**: sandboxing “within cwd” is still TODO)
  - `read_memory` / `write_memory`
  - `get_build_info`
- [x] Implement event bus:
  - UI: `listen("server-event")`
  - backend: `emit_all("server-event", json_string)`
- [x] Use real `platform/tauri` implementation in UI.

**Контрольная точка:** UI в Tauri умеет открыть/выбрать папку, листать директорию, читать/писать memory, получать build info.

### Фаза 4 — Backend: быстрый путь к “работает как раньше” (Node-sidecar) (3–7 дней)
Цель: не переписывать сразу `runner/tool-executor`, а “упаковать” его рядом с Tauri.

- [x] Make `src/electron/libs/*` usable in pure Node (sidecar):
  - replace `electron.app.getPath("userData")` with `LOCALDESK_USER_DATA_DIR` (required outside Electron)
  - gate Electron-only tools (`render_page`) behind runtime detection
- [x] Sidecar protocol:
  - newline-delimited JSON over stdin/stdout
  - messages: `client-event` → sidecar, `server-event` ← sidecar
  - sources: `LocalDesk/src/sidecar/*`
- [x] Tauri host:
  - start sidecar on demand
  - forward `client_event` to sidecar
  - forward sidecar `server-event` to UI via `emit_all("server-event", ...)`
- [ ] Packaging (Strategy A):
  - Build sidecar into a platform-specific executable (recommended: Node + bundled JS, or a minimal runtime) and **embed it into the Tauri app artifact**.
  - Ensure the sidecar is started from an app-controlled location (installed path), not downloaded at runtime.
  - Ensure logs are accessible for support (sidecar stdout/stderr redirected into host logging).

**Контрольная точка:** в Tauri снова работает чат/стриминг/сессии/тулы (на уровне поведения как в Electron), но backend пока “вынесен”.

### Фаза 5 — Переезд критичных подсистем в Rust (итеративно, 1–3 недели)
Цель: постепенно вырезать Node, оставив sidecar только для того, что реально нужно.

Порядок переноса (по ценности/риску):
- [ ] **FS + sandbox**: `read/write/edit/grep/glob` (с жесткими ограничениями по рабочей директории и permission mode).
- [ ] **DB (sessions/todos/messages)**: `SessionStore` → Rust, сохранить схему/данные.
- [ ] **Scheduler + notifications**: заменить Electron Notification API на `tauri-plugin-notification`.
- [ ] **HTTP/Web tools**: `fetch/search_web/extract_page/read_page/render_page`.
- [ ] **JS sandbox**:
  - вариант 1: `rquickjs` в Rust (без Node)
  - вариант 2: оставить QuickJS WASM, но запускать из Rust (менее предпочтительно)
- [ ] **Playwright/browser automation**:
  - оставить sidecar только для Playwright
  - или заменить на Rust-решение (обычно дороже/дольше)

**Контрольная точка:** sidecar либо полностью удален, либо остался минимальным (например, только “browser tool”).

### Фаза 6 — Миграция данных и совместимость (параллельно фазам 3–5)
- [ ] Определить и задокументировать пути Electron `userData` по ОС и путь Tauri `app_data_dir`.
- [ ] На первом запуске Tauri:
  - попытаться найти старые файлы (sessions.db, settings) и импортировать/скопировать
  - дать пользователю ручной импорт, если авто-поиск не сработал
- [ ] Сохранить совместимость `~/.localdesk/memory.md` (или сделать “однократный импорт” + редирект).

### Фаза 7 — Packaging/релизы (3–7 дней)
- [ ] Иконки/бандлы под macOS/Windows/Linux.
- [ ] Подпись/нотаризация (macOS), подпись (Windows) — если сейчас это есть в Electron pipeline.
- [ ] Auto-update (если нужен): `tauri-plugin-updater` + схема публикации (GitHub Releases и т.п.).
- [ ] CI сборки (матрица ОС), артефакты, checksum, release notes.
- [ ] Release artifact policy:
  - **Exactly one primary artifact per OS per release** (DMG/PKG, MSI/EXE, AppImage/DEB/RPM).
  - The artifact must include all required runtime components (including sidecar, if present) so the user never installs Node separately.
  - Smoke-check that the installed app launches offline (no “first run downloads”).
- [ ] WebView runtime validation:
  - Windows 11: verify the installer handles missing WebView2 (clean VM smoke).
  - Linux: verify the chosen packaging actually runs on target distros (CI or manual matrix).

### Фаза 8 — QA и cutover (непрерывно, финальная неделя)
- [ ] Smoke-тесты по ключевым сценариям: стриминг, сессии, file tools, web tools, scheduler.
- [ ] Регрессия по permission system (ask/default), sandbox по путям.
- [ ] Профилирование: размер дистрибутива, время запуска, память.
- [ ] План отката: возможность собирать Electron-версию параллельно до стабилизации.

## 3) Риски и как их снижать

- **WebView отличия от Chromium (Electron)**: CSS/рендер, spellcheck, контекст-меню.  
  Митигировать: ранний POC UI в Tauri (фаза 2–3), e2e smoke.

- **Playwright и размер**: Playwright тянет Chromium и может “съесть” выигрыш по размеру.  
  Митигировать: делать browser-tool опциональным; вынести в sidecar; включать по флагу.

- **Sidecar внутри “single artifact”**: растет сложность подписи/антивирусных срабатываний/инсталляции.  
  Митигировать: фиксированный install path, отсутствие runtime-downloads, подпись всех бинарников, прозрачные логи, стабильный протокол host↔sidecar.

- **WebView runtime dependency**: on Windows/Linux the app may not start on a “clean” machine without the right WebView runtime/libraries.  
  Митигировать: заранее выбрать стратегию (require vs bundle), зафиксировать минимально поддерживаемые версии ОС/дистрибутивов, проверить в CI smoke.

- **Bundling WebView2 increases artifact size** (especially with offline installer) and can affect download/update UX.  
  Митигировать: измерить size impact early; consider splitting “full offline installer” vs “online bootstrapper” variants only if explicitly needed.

- **Безопасность FS/команд**: в Tauri легко случайно расширить доступ.  
  Митигировать: единая точка доступа (Rust commands), строгий allowlist “внутри cwd”, логирование и permission prompts.

- **Миграция данных**: пользователь не должен потерять сессии/настройки.  
  Митигировать: автоматический импорт + ручной импорт + бэкап перед миграцией.

## 4) Критерии готовности (DoD для “Tauri v1”)
- UI работает в Tauri без деградации ключевых UX-фич (чат, стриминг, история/сессии).
- Сессии и настройки мигрированы или импортируются.
- Tool-система работает минимум для: FS tools, web search, memory, (опционально) scheduler.
- Security: нет “произвольного доступа” вне sandbox’а; permission system не обходима из UI.
- Сборка/дистрибуция для macOS/Windows/Linux воспроизводима в CI.
- On each target OS, the release ships as **one artifact** and installs/runs without requiring external runtimes (no Node install, no first-run downloads).

