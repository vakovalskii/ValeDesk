# Спецификация: Mini-workflow ("record → distill → replay") для ValeDesk

> **Версия**: 0.2.0 | **Обновлено**: 2026-02-18
> **Статус**: Draft → Review

## 0. Контекст и цель

### Проблема
Пользователь (не айтишник) провёл удачную сессию с агентом и получил результат. Нужно **забрать "суть пути"**, упаковать её в **воспроизводимую кнопку**, а в следующий раз получать аналогичный результат, меняя только **входные данные**.

### Цель
Сделать в ValeDesk механизм **mini-workflow**:
- **Record**: фиксировать достаточный трейс выполнения (tool calls + артефакты).
- **Distill**: агент/система превращает трейс в минимальный workflow + параметризованные inputs + тесты **+ извлекает смысл из текста пользователя (гибрид)**.
- **Replay**: пользователь запускает workflow как "кнопку", вводит inputs, получает результат.
- **Human-in-the-loop**: перед публикацией workflow обязательно выполняются тесты, и пользователь подтверждает успешность; иначе агент дорабатывает workflow и тесты повторяются (макс. 3 попытки).

### Не цели (важно)
- Не превращать ValeDesk в BPMN/полноценный workflow-engine уровня Temporal.
- Не пытаться "упаковать абсолютно любую сессию". Есть классы сессий, которые **не компилируются** корректно (см. §3.3).
- Не хранить/не логировать секреты в workflow, сессиях, логах.

## 1. Термины

- **Session** — обычная сессия ValeDesk (чат).
- **Tool-trace** — последовательность сообщений `tool_use`/`tool_result` (+ контекстные артефакты).
- **MiniWorkflow** — объект автоматизации (кнопка), содержащий `inputs`, `steps`, `tests`, `artifacts`.
- **Distill** — процесс "компиляции" из Session → MiniWorkflow.
- **Replay** — запуск MiniWorkflow в новом чате с подстановкой inputs.
- **Secret input** — ввод, который никогда не пишется в логи/скиллы/контекст (только handle).
- **Hybrid mini-workflow** — целевой режим: workflow строится из tool-trace, но **обязательно** включает сжатые инварианты/ограничения/DoD из текста пользователя и допускает `llm`-шаги для смысловой части.
- **Prompt Preset** — отдельная сущность для conversation-centric сессий (без tool calls), НЕ является mini-workflow.

## 2. Исходные возможности ValeDesk (что уже есть)

### 2.1. Архитектура приложения
ValeDesk построен на:
- **Tauri 2.x** (Rust backend + WebView)
- **React 19 + TypeScript + TailwindCSS 4** (фронтенд)
- **Zustand** (state management)
- **SQLite** (rusqlite в Rust, better-sqlite3 в Node)
- **Node.js sidecar** (pkg-бандл, агентская логика)

Ключевые модули:
- `src/agent/libs/runner-openai.ts` — LLM agent loop (до 50 итераций)
- `src/agent/libs/tools-executor.ts` — диспетчер инструментов
- `src/agent/libs/session-store.ts` / `src/sidecar/session-store-memory.ts` — хранение сессий
- `src/agent/libs/skills-loader.ts` — загрузка и парсинг SKILL.md
- `src/sidecar/main.ts` — event routing (Rust ↔ Node через stdin/stdout JSON lines)
- `src/ui/store/useAppStore.ts` — Zustand store

### 2.2. Tool-trace уже доступен
В текущем runner ValeDesk сохраняет историю сообщений в SQLite (`messages` table) через `sessionStore.recordMessage(...)`. Типы сообщений:
- `user_prompt` — `{ type: 'user_prompt', prompt: string }`
- `text` — `{ type: 'text', text: string }` (ответ ассистента)
- `tool_use` — `{ type: 'tool_use', id, name, input }` (вызов инструмента)
- `tool_result` — `{ type: 'tool_result', tool_use_id, output, is_error }` (результат)

Дополнительно: turn-логи пишутся в `~/.valera/logs/sessions/{sessionId}/turn-{N}-request.json` / `turn-{N}-response.json`.

Следствие: **tool-trace восстанавливается** через `sessionStore.getSessionHistory(sessionId)`.

### 2.3. Уже есть система skills
Skills хранятся:
- Проектно: `{cwd}/.valera/skills/{skillId}/SKILL.md`
- Глобально: `~/.valera/skills/{skillId}/SKILL.md`

Skills подключаются через tool `load_skill` и инжектятся в system prompt. Есть frontmatter-парсер (`parseSkillMd`).

### 2.4. Уже есть permission mode ("ask/auto")
Permission gating по tool calls уже существует. Для replay это используем как safety-layer.

### 2.5. Текущий UI layout
```
┌──────────────────────────────────────────────────────┐
│  Sidebar (280px)    │        Main Content            │
│  ┌───────────────┐  │  ┌──────────────────────────┐  │
│  │ [+] [⫿] [👥] [⚙]│  │  Header Bar (48px)       │  │
│  │ [🔍 Search...] │  │  │  Title | Edit | Settings │  │
│  │                │  │  └──────────────────────────┘  │
│  │ Session List   │  │                                │
│  │ - pinned first │  │  Messages Area (scrollable)    │
│  │ - status dots  │  │  ┌──────────────────────────┐  │
│  │ - model badge  │  │  │ max-w-4xl, mx-auto       │  │
│  │                │  │  │ UserMessage               │  │
│  │                │  │  │ AssistantMessage           │  │
│  │                │  │  │ ToolUseCard               │  │
│  │                │  │  │ ToolResultCard            │  │
│  │                │  │  │ ...                       │  │
│  │                │  │  └──────────────────────────┘  │
│  │                │  │                                │
│  │                │  │  [TodoPanel] (если есть todos)  │
│  └───────────────┘  │                                │
│                     │  ┌──────────────────────────┐  │
│                     │  │ PromptInput (fixed bottom)│  │
│                     │  │ [textarea        ] [Send] │  │
│                     │  └──────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## 3. Критическая оценка: можно ли любую сессию упаковать только в tool-trace?

Коротко: **нет**.

### 3.1. Классы сессий
1) **Tool-centric** (идеальный случай)
   - Результат достигается через последовательность tool calls.
   - Хорошо компилируются в workflow.

2) **Conversation-centric**
   - Результат — текст/решение, полученное за счёт уточнений пользователя, без инструментов.
   - Tool-trace почти пустой. **Не компилировать** в workflow.
   - Предлагать сохранить как **Prompt Preset** (отдельная сущность, вне скоупа данной спеки).

3) **Hybrid** (целевой для mini-workflow)
   - Есть инструменты, но критические требования сидят в тексте пользователя ("стиль", "ограничения", "пример", "что считать успехом").
   - Distill должен извлечь из пользовательских сообщений **инварианты/ограничения/DoD** и включить их в workflow.

### 3.2. Вывод для продукта
Mini-workflow включает не только tool calling history, но и **сжатую декларативную часть**:
- `goal` (что получить),
- `definition_of_done` (как проверяем успех),
- `constraints` (что запрещено/какой стиль/формат),
- `inputs` (что меняется от запуска к запуску),
- при необходимости: `prompt_templates` для LLM-шагов.

### 3.3. Фиксация: нам нужен Hybrid
Mini-workflow **всегда** рассматривается как Hybrid:
- Distill обязан извлечь смысловую часть из текста пользователя.
- Workflow обязан иметь место для `llm`-шагов или шаблонов.
- Если сессия целиком conversation-centric → **fail-fast**, предложить Prompt Preset.

## 4. Формат MiniWorkflow (спека данных)

### 4.1. Общая структура
`MiniWorkflow` (версионируемый объект):
- `id`: string (slug/uuid)
- `name`: string
- `description`: string (человеческое объяснение)
- `icon`: string (emoji или путь к сгенерированной иконке)
- `version`: semver (например `0.1.0`)
- `created_at`, `updated_at`
- `source_session_id`: string (для аудита)
- `tags`: string[]
- `status`: `draft | testing | published | archived`
- `compatibility`:
  - `valedesk_min_version`
  - `tools_required`: string[]
  - `tools_optional`: string[]
- `goal`: string (что workflow должен получить)
- `definition_of_done`: string (как проверяем, что результат достигнут)
- `constraints`: string[] (запреты, стиль, формат)
- `inputs`: `InputSpec[]`
- `steps`: `StepSpec[]`
- `tests`: `TestSpec[]`
- `artifacts`: `ArtifactSpec[]`
- `safety`:
  - `permission_mode_on_replay`: `ask | auto` (по умолчанию `ask`)
  - `side_effects`: string[] (массив из: `local_fs`, `git`, `network`, `external_accounts`; пустой массив = нет побочных эффектов)
  - `network_policy`: `offline | allow_web_read | allow_web_write` (по умолчанию `allow_web_read`)

### 4.2. InputSpec
Каждый input должен быть пригоден для формы ввода.

`InputSpec`:
- `id`: string (snake_case)
- `title`: string (лейбл в UI)
- `description`: string (подсказка)
- `type`: `string | text | number | boolean | enum | date | datetime | file_path | url | secret`
- `required`: boolean
- `default`: any (опционально)
- `enum_values`: string[] (если type=enum)
- `validation`:
  - `min_length`, `max_length`, `pattern` (для string/text)
  - `min`, `max` (для number)
- `redaction`: boolean (авто `true` для `secret`)

Правило: `secret` никогда не хранится в workflow и не логируется; в runtime это "handle".

### 4.3. StepSpec
`StepSpec`:
- `id`: string
- `kind`: `tool | llm | manual`
- `title`: string
- `description`: string
- `outputs`: `OutputSpec[]`
- `on_error`: `{ strategy: 'fail' | 'retry' | 'ask_user', max_retries?: number }`
  - При `retry`: `max_retries` обязательно, максимум 3. Между попытками 2 сек пауза.

#### 4.3.1. OutputSpec
Описание того, что шаг производит для последующих шагов.

`OutputSpec`:
- `name`: string (snake_case, уникальное в рамках шага)
- `type`: `string | file_path | json | number | boolean`
- `description`: string (что содержит этот выход)
- `source`: `tool_result | llm_response | manual_input`

Ссылка на выход: `{{steps.<step_id>.outputs.<name>}}` — резолвится в runtime при выполнении последующих шагов.

Примеры:
- Step `search`: output `{ name: "results", type: "json", source: "tool_result" }` → `{{steps.search.outputs.results}}`
- Step `generate`: output `{ name: "file_path", type: "file_path", source: "tool_result" }` → `{{steps.generate.outputs.file_path}}`

Если шаг не производит явных outputs — массив пустой. Agent при distill определяет outputs по анализу того, что следующие шаги используют из результатов предыдущих.

#### 4.3.2. Tool step
`ToolStep`:
- `kind: tool`
- `tool_name`: string (например `search_web`, `write_file`, `execute_python`)
- `args_template`: JSON-объект, где значения могут содержать плейсхолдеры:
  - `{{inputs.topic}}`
  - `{{steps.step_id.outputs.some_value}}`
- `expect`:
  - `success_required`: boolean
  - `capture`: `output | error | both`

#### 4.3.3. LLM step
Если смысл лежит в тексте — отдельный шаг, а не tool call.

`LLMStep`:
- `kind: llm`
- `model`: optional (если пусто — берём модель сессии/дефолт)
- `system_prompt_template`: string
- `user_prompt_template`: string (может включать inputs и outputs предыдущих шагов)
- `allowed_tools`: string[] (обычно пусто; строго ограниченный список)
- `output_schema`: optional JSON-schema (если ожидаем структурированный JSON)
- `temperature`: optional

#### 4.3.4. Manual step
`ManualStep`:
- `kind: manual`
- `instruction`: string
- `requires_confirmation`: true
- `confirmation_text`: string ("Подтверждаю, что …")

### 4.4. TestSpec
Тесты — обязательны перед утверждением workflow.

`TestSpec`:
- `id`: string
- `title`: string
- `kind`: `file_exists | file_contains | json_schema | tool_smoke | custom_llm_judge`
- `params`: JSON (зависит от kind)
- `severity`: `blocking | warning`
- `test_context`: `session_cwd | isolated` (по умолчанию `session_cwd`)
  - `session_cwd` — тест выполняется в рабочей директории сессии (для workflow, зависящих от git-репо, конфигов, существующих файлов)
  - `isolated` — тест выполняется во временной директории (для генераторов, которые создают файлы с нуля)

Примеры:
- `file_exists`: `{ "path": "{{steps.generate.outputs.file_path}}" }`
- `file_contains`: `{ "path": "output/report.md", "must_include": ["## Summary", "## Conclusion"] }`
- `json_schema`: `{ "json_path": "output/result.json", "schema": {...} }`
- `tool_smoke`: `{ "tool_name": "search_web", "test_args": {"query": "test"} }` — проверка доступности тула
- `custom_llm_judge`: `{ "rubric": "Отчёт содержит анализ минимум 3 источников, написан без ошибок, имеет структуру из заголовков", "target": "{{steps.generate.outputs.file_path}}" }` — severity только `warning` (по умолчанию) или `blocking` при явном согласии пользователя.

### 4.5. ArtifactSpec
Что показать пользователю "в конце".

`ArtifactSpec`:
- `type`: `file | text | link | table`
- `title`: string
- `ref`: string (путь/переменная/плейсхолдер)

## 5. Хранение mini-workflow

### 5.1. Расположение
Используем существующий механизм skills:
- Глобально: `~/.valera/skills/<workflow_id>/`
- Проектно: `{cwd}/.valera/skills/<workflow_id>/`

### 5.2. Файлы
Минимальный набор:
- `SKILL.md` — описание + frontmatter (метаданные, inputs, goal, constraints)
- `workflow.json` — машинное описание `MiniWorkflow` (из §4)
- `tests/` — опционально, fixtures для тестов

### 5.3. Frontmatter в SKILL.md
Расширить frontmatter:
- `name`
- `description`
- `type: mini-workflow` (отличает от обычного skill)
- `icon` (emoji)
- `allowed-tools`: YAML array (строго необходимый набор, например `[search_web, write_file]`)
- `inputs` (список InputSpec в YAML)
- `workflow-file: workflow.json`

### 5.4. Версионирование
- Хранить последние **5 версий** workflow в `~/.valera/workflows/<workflow_id>/versions/`:
  - `v1/workflow.json`, `v1/SKILL.md`
  - `v2/workflow.json`, `v2/SKILL.md`
  - ...
- При сохранении новой версии, если версий > 5, удалять самую старую.
- Текущая (активная) версия всегда в `~/.valera/skills/<workflow_id>/`.

### 5.5. Жизненный цикл workflow

```
              ┌─────────┐
              │  draft   │ ← distill создал кандидат
              └────┬─────┘
                   │ пользователь нажал "Run tests"
                   ▼
              ┌──────────┐
         ┌───▶│ testing  │ ← тесты выполняются
         │    └────┬─────┘
         │         │
         │    ┌────┴────┐
         │    ▼         ▼
         │  PASS      FAIL
         │    │         │
         │    │    агент дорабатывает
         │    │    (макс. 3 попытки)
         │    │         │
         │    │         └──────┐
         │    │                │ попыток < 3
         │    │                ▼
         │    │           ┌──────────┐
         │    │           │ testing  │
         │    │           └────┬─────┘
         │    │                │
         │    ▼                │ попыток = 3
         │  ┌────────────┐    ▼
         │  │ published  │  ┌────────┐
         │  └─────┬──────┘  │ draft  │ ← вернули в draft
         │        │         └────────┘
         │        │ пользователь подтвердил → появляется плитка в панели
         │        │
         │        │
         │   ┌────┴─────┐
         │   ▼          ▼
         │ [Edit]    [Archive]
         │   │          │
         │   │          ▼
         │   │    ┌──────────┐
         │   │    │ archived │ ← скрыт из панели
         │   │    └──────────┘
         │   │
         └───┘  → агент редактирует → draft (новая версия)
```

Удалить workflow может только пользователь (через UI или файловую систему).

## 6. UX: спецификация интерфейса

### 6.1. Новые UI-элементы (обзор)

| Элемент | Расположение | Тип |
|---|---|---|
| Кнопка "Save as Mini-workflow" | Footer (PromptInput area) | Button |
| Панель workflows (правая) | Справа от main content | Collapsible Panel |
| Кнопка toggle панели | Top-right header | Icon Button |
| Плитка workflow | Внутри правой панели | Card |
| Модалка distill-превью | Overlay | Modal Dialog |
| Форма inputs (replay) | Overlay | Modal Dialog |
| Модалка результата тестов | Overlay | Modal Dialog |

### 6.2. Layout с новой панелью

```
┌─────────────────────────────────────────────────────────────┐
│ Sidebar(280px) │     Main Content        │ Workflow Panel   │
│                │                          │ (320px, toggle)  │
│ [+][⫿][👥][⚙] │  Header [title] ... [📋]│                  │
│ [🔍 Search]    │                          │ ┌──────────────┐│
│                │  Messages Area           │ │🔄 Мой отчёт  ││
│ Session List   │  ┌──────────────────┐   │ │  v0.2 · 3 inp ││
│                │  │ UserMessage      │   │ └──────────────┘│
│                │  │ AssistantMsg     │   │ ┌──────────────┐│
│                │  │ ToolUseCard      │   │ │📊 Анализ CSV  ││
│                │  │ ...              │   │ │  v0.1 · 1 inp ││
│                │  └──────────────────┘   │ └──────────────┘│
│                │                          │ ┌──────────────┐│
│                │  [TodoPanel]             │ │🌐 SEO-аудит   ││
│                │                          │ │  v0.3 · 2 inp ││
│                │  ┌──────────────────┐   │ └──────────────┘│
│                │  │ PromptInput      │   │                  │
│                │  │ [Save as ⚡]     │   │                  │
│                │  └──────────────────┘   │                  │
└─────────────────────────────────────────────────────────────┘
```

Если правая панель свёрнута, main content занимает всю доступную ширину.

### 6.3. Кнопка "Save as Mini-workflow"

**Расположение**: в footer рядом с PromptInput, слева от textarea.

```
┌──────────────────────────────────────────────────────┐
│  [⚡ Save as workflow]  [textarea...          ] [▶]  │
│                         Enter to send                 │
└──────────────────────────────────────────────────────┘
```

**Состояния**:

| Состояние | Условие | Вид |
|---|---|---|
| `disabled` | Сессия пустая (нет сообщений) ИЛИ сессия `running` | Серая, некликабельная, tooltip: "Завершите сессию для создания workflow" |
| `enabled` | Сессия `completed`/`idle`, есть минимум 1 `tool_use` | Accent-цвет, кликабельная |
| `loading` | Distill в процессе | Спиннер, disabled |
| `warning` | Сессия без `tool_use` (conversation-centric) | Жёлтая, tooltip: "В этой сессии нет инструментов — можно сохранить как Prompt Preset" |

**Событие onClick**:
1. Проверить наличие `tool_use` в сессии.
2. Если нет → показать toast: "Эта сессия не содержит вызовов инструментов. Хотите сохранить как Prompt Preset?" (out of scope для MVP, просто информируем).
3. Если есть → запустить Distill процесс → показать модалку превью.

### 6.4. Панель workflows (правая, collapsible)

**Toggle-кнопка**: в header bar, справа, иконка 📋 (или стилизованная иконка workflow).

```
Header: [...existing buttons...] [📋]
                                   ^
                                   toggle right panel
```

**Панель (320px, правая сторона)**:

```
┌────────────────────────┐
│  Mini-workflows    [✕] │  ← заголовок + кнопка закрытия
│────────────────────────│
│  [🔍 Filter...]       │  ← поиск по имени/тегам
│────────────────────────│
│  ┌──────────────────┐  │
│  │ 🔄  Мой отчёт    │  │  ← плитка workflow
│  │ v0.2 · 3 inputs  │  │
│  │ #report #weekly   │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ 📊  Анализ CSV   │  │
│  │ v0.1 · 1 input   │  │
│  │ #data #csv        │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ 🌐  SEO-аудит    │  │
│  │ v0.3 · 2 inputs  │  │
│  │ #seo #web         │  │
│  └──────────────────┘  │
│                        │
│  (пусто? — подсказка:  │
│  "Создайте workflow из │
│  успешной сессии        │
│  кнопкой ⚡ внизу")    │
└────────────────────────┘
```

**Состояния панели**:

| Состояние | Описание |
|---|---|
| `collapsed` | Панель скрыта, main content растянут на всю ширину |
| `expanded` | Панель 320px справа, main content сужен |
| `empty` | Панель открыта, но нет workflow → placeholder с подсказкой |
| `loading` | При первой загрузке — скелетон-карточки |

**Плитка workflow**:

```
┌────────────────────────────┐
│ 🔄  Мой отчёт              │  ← icon + name
│ Генерирует еженед. отчёт   │  ← description (1 строка, truncate)
│ v0.2 · 3 inputs · FS, Net  │  ← version, inputs count, side_effects
│ #report #weekly             │  ← tags
│────────────────────────────│
│ [▶ Запустить]   [⋯]       │  ← кнопка запуска + меню (edit, archive, delete)
└────────────────────────────┘
```

**Событие onClick плитки (кнопка "Запустить")**:
→ Открывает модалку формы inputs (§6.6).

**Контекстное меню [⋯]**:
- "Редактировать" → агент получает задачу на редактирование (через специальный skill)
- "Архивировать" → status = `archived`, плитка скрывается
- "Удалить" → подтверждение → удаление файлов с диска

### 6.5. Модалка Distill-превью

Появляется после нажатия "Save as Mini-workflow" и завершения distill.

```
┌──────────────────────────────────────────┐
│  Создание Mini-workflow              [✕] │
│──────────────────────────────────────────│
│                                          │
│  Название:  [Генерация отчёта______]    │
│  Иконка:    [🔄 ▼]                      │
│  Описание:  [Генерирует еженедельный    │
│              отчёт по заданной теме___]  │
│                                          │
│  ─── Цель ───                            │
│  "Создать структурированный отчёт в MD   │
│  формате по заданной теме с 3+ источн."  │
│                                          │
│  ─── Входные данные (3) ───              │
│  ┌────────────────────────────────────┐  │
│  │ topic  · string · обязат.          │  │
│  │ "Тема отчёта"                      │  │
│  │────────────────────────────────────│  │
│  │ period · enum · обязат.            │  │
│  │ "Период: weekly/monthly/quarterly" │  │
│  │────────────────────────────────────│  │
│  │ style  · string · опцион.          │  │
│  │ "Стиль написания"                  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ─── Шаги (5) ─── [▼ развернуть]        │
│  1. 🔧 search_web — поиск источников    │
│  2. 🤖 LLM — анализ и выжимка           │
│  3. 🔧 write_file — черновик отчёта      │
│  4. 🤖 LLM — финальная редактура        │
│  5. 🔧 write_file — итоговый файл       │
│                                          │
│  ─── Тесты (2) ───                       │
│  ✓ file_exists: output/report.md         │
│  ✓ file_contains: "## Summary"           │
│                                          │
│  ─── Побочные эффекты ───                │
│  ⚠ local_fs, network                     │
│                                          │
│──────────────────────────────────────────│
│           [Run tests]    [Cancel]        │
└──────────────────────────────────────────┘
```

**Состояния модалки**:

| Состояние | Описание |
|---|---|
| `loading` | Distill в процессе — скелетон + прогресс-текст ("Анализирую сессию...", "Извлекаю inputs...", "Формирую тесты...") |
| `preview` | Distill завершён — показано превью, кнопка "Run tests" активна |
| `testing` | Тесты запущены — кнопка "Run tests" → спиннер, нельзя закрыть |
| `test_passed` | Тесты прошли — зелёный баннер, кнопка "Сохранить и опубликовать" |
| `test_failed` | Тесты не прошли — красный баннер с деталями, кнопка "Доработать" (агент исправляет, повтор тестов) |
| `test_failed_final` | 3 попытки исчерпаны — красный баннер, кнопки "Сохранить как draft" / "Отмена" |
| `distill_failed` | Distill не смог создать workflow (conversation-centric) — сообщение об ошибке + предложение Prompt Preset |

**Пользователь может редактировать** в превью:
- Название и описание (текстовые поля)
- Inputs: переименовать title, поменять type, отметить `secret`, удалить, добавить
- Иконку (выбор из emoji)

### 6.6. Модалка формы inputs (при запуске workflow)

```
┌──────────────────────────────────────────┐
│  🔄 Генерация отчёта                [✕] │
│  v0.2 · 3 inputs                         │
│──────────────────────────────────────────│
│                                          │
│  Тема отчёта *                           │
│  [_________________________________]    │
│  Основная тема для исследования          │
│                                          │
│  Период *                                │
│  [weekly        ▼]                       │
│  Период для анализа                      │
│                                          │
│  Стиль написания                         │
│  [_________________________________]    │
│  Необязательно. Стиль/тон текста         │
│                                          │
│──────────────────────────────────────────│
│           [▶ Запустить]    [Cancel]      │
└──────────────────────────────────────────┘
```

**Рендеринг полей по типу**:

| InputSpec.type | UI-элемент |
|---|---|
| `string` | `<input type="text">` |
| `text` | `<textarea>` (3 строки) |
| `number` | `<input type="number">` с min/max |
| `boolean` | `<input type="checkbox">` |
| `enum` | `<select>` с `enum_values` |
| `date` | `<input type="date">` |
| `datetime` | `<input type="datetime-local">` |
| `file_path` | `<input type="text">` + иконка папки (Tauri file dialog) |
| `url` | `<input type="url">` |
| `secret` | `<input type="password">` (значение не сохраняется, не логируется) |

**Валидация**: на клиенте по правилам из `InputSpec.validation`. Required-поля помечены `*`. Кнопка "Запустить" disabled до прохождения валидации.

**Событие onClick "Запустить"**:
1. Создаётся новая сессия (= новый чат).
2. В system prompt загружается SKILL.md данного workflow.
3. Формируется user prompt из inputs: агент получает структурированные данные и инструкцию выполнить workflow.
4. Агент начинает работу как обычный чат. Пользователь видит прогресс в чате.
5. По завершении — artifacts отображаются в чате.

### 6.7. Модалка результатов тестов

```
┌──────────────────────────────────────────┐
│  Результаты тестов                  [✕] │
│──────────────────────────────────────────│
│                                          │
│  ✅ file_exists: output/report.md        │
│     Файл создан (2.3 KB)                │
│                                          │
│  ✅ file_contains: "## Summary"          │
│     Найдено в строке 12                  │
│                                          │
│  ⚠️ custom_llm_judge (warning)           │
│     Оценка: 7/10                         │
│     "Отчёт содержит 2 источника          │
│      вместо требуемых 3"                 │
│                                          │
│  ─── Итого: 2/2 blocking PASS ───       │
│                                          │
│──────────────────────────────────────────│
│  [Сохранить и опубликовать]    [Cancel]  │
└──────────────────────────────────────────┘
```

## 7. Движок исполнения (Replay)

### 7.1. Модель: Agent-assisted
Replay выполняется **через агента** (LLM), а не через программный engine:

1. Создаётся новая сессия (чат).
2. В system prompt инжектится содержимое `SKILL.md` workflow (через `load_skill`).
3. В user prompt передаются inputs пользователя + инструкция: "Выполни workflow по инструкции".
4. Агент выполняет шаги, используя tools из `tools_required`.
5. Результат = обычный чат. Пользователь видит всё как обычную сессию.

Почему agent-assisted, а не engine-first:
- Проще реализовать: используем существующий runner.
- Гибче: агент может адаптироваться к ошибкам, а не падать.
- Консистентно: для пользователя replay = обычный чат, нет нового UX.

### 7.2. Параллельность
1 workflow = 1 чат. Если приложение поддерживает параллельные сессии (а оно поддерживает), пользователь может запустить несколько workflow одновременно, каждый в своём чате.

### 7.3. Отладка и трейсинг replay
При каждом replay сохраняется `ReplayLog` — для диагностики, почему workflow выдал не тот результат:

`ReplayLog` (записывается в `~/.valera/workflows/<id>/runs/<run_id>.json`):
- `run_id`: string
- `workflow_id`: string
- `workflow_version`: string
- `started_at`, `finished_at`
- `inputs`: Record<string, any> (secret inputs → `[REDACTED]`)
- `step_results`: `StepRunResult[]`
- `final_status`: `success | partial | failed | aborted`

`StepRunResult`:
- `step_id`: string
- `status`: `success | failed | skipped`
- `started_at`, `finished_at`
- `duration_ms`: number
- `outputs_hash`: string (SHA-256 от outputs, для сравнения между запусками)
- `error`: string | null

Это не блокирующая функциональность — если лог не записался, replay продолжается.

### 7.4. Остановка
Пользователь может остановить replay так же, как останавливает обычную генерацию — кнопка Stop в PromptInput.

### 7.4. Параметры безопасности на replay
По умолчанию:
- `permissionMode=ask` для потенциально опасных tools (run_command, git, network)
- Маркировка "есть side-effects" видна в плитке workflow

## 8. Секреты и логирование

### 8.1. Нельзя логировать секреты нигде
Секреты не должны попадать:
- в SQLite `messages`
- в `~/.valera/logs/sessions/{sessionId}/turn-*.json`
- в `SKILL.md` и `workflow.json`
- в UI history

### 8.2. Secret store (MVP)
В MVP секреты **не сохраняются**. При каждом запуске workflow пользователь вводит secret inputs заново в форме (поле `type: password`). Значение живёт только в памяти процесса на время replay.

Персистентное хранение секретов (encrypted vault, OS keyring) — отдельная задача за пределами MVP.

### 8.3. Контракт: secret never enters prompt/messages

Secret inputs **никогда не попадают** в user prompt, system prompt, SQLite messages или turn-логи. Контракт выполнения:

1. При формировании user prompt для replay secret inputs заменяются на handle: `{{secret::<input_id>}}`.
2. Агент видит в промпте только handle, не значение.
3. При вызове tool (через `tools-executor`) handle резолвится в реальное значение из in-memory store непосредственно перед вызовом API/инструмента.
4. `sessionStore.recordMessage()` получает уже отредактированную версию (handle вместо значения).
5. Turn-логи (`turn-*.json`) записывают handle, не значение.

Поток данных:
```
User вводит secret → in-memory SecretBag (не персистится)
                          ↓
  Prompt:  "API key: {{secret::api_key}}"  ← handle, не значение
                          ↓
  tools-executor:  SecretBag.resolve("api_key") → реальное значение → tool call
                          ↓
  Persist (SQLite/logs):  "API key: [REDACTED]"
```

### 8.4. Redaction pipeline
Дополнительный слой на случай утечки (defense in depth):
- Перед любым persist/log: если поле помечено `secret`/`redaction` → `"[REDACTED]"`
- Применяется к: `tool_use.input`, `tool_result.output`, turn-логам
- Если SecretBag содержит значение X, и X встречается в output — заменить на `[REDACTED]` (pattern matching)

## 9. Distill: алгоритм превращения сессии в workflow

### 9.1. Входные данные
- `sessionStore.getSessionHistory(sessionId)` → `StreamMessage[]`
- `session.cwd` (рабочая директория)
- Список доступных tools из текущей конфигурации

### 9.2. Предварительная проверка (fail-fast)

**Прежде чем строить workflow, Distiller проверяет:**

1. **Есть ли tool_use в сессии?**
   - Нет → FAIL: "Сессия не содержит вызовов инструментов. Это conversation-centric сессия. Предложить сохранить как Prompt Preset."

2. **Достигнут ли результат?**
   - Анализ: есть ли успешные tool_result (is_error=false) в последней трети сессии?
   - Есть ли финальное сообщение ассистента, содержащее признаки завершения ("готово", "создан", "результат", "вот файл", etc.)?
   - Если агент не может определить → **спросить пользователя**: "Был ли достигнут результат в этой сессии? Что именно является результатом?"

3. **Не слишком ли сессия длинная/хаотичная?**
   - Если > 30 tool_use и > 50% из них is_error=true → WARNING: "Сессия содержит много ошибок. Workflow может быть ненадёжным."

### 9.3. Основной алгоритм distill

Distill выполняется **LLM-агентом** (не детерминированно), которому даётся специальный промпт:

#### Промпт для Distill-агента

```
Ты — Distiller. Твоя задача — проанализировать историю сессии и создать MiniWorkflow.

## Входные данные
- История сессии (messages): см. ниже
- Рабочая директория: {{cwd}}

## Что ты должен сделать

### 1. Определить задачу
Из пользовательских сообщений (user_prompt) извлеки:
- GOAL: что пользователь хотел получить (1-2 предложения)
- DEFINITION_OF_DONE: как понять, что результат достигнут
- CONSTRAINTS: запреты, стиль, формат, ограничения

### 2. Определить результат
Из последних сообщений ассистента и tool_result определи:
- Что является конечным артефактом (файл, текст, данные)?
- Достигнут ли результат? Если не уверен — запроси уточнение.

### 3. Извлечь tool-trace
Из tool_use/tool_result пар построй последовательность шагов:
- Убери дубликаты (одинаковый tool+args подряд)
- Убери неудачные попытки, если после них есть успешная
- Убери диагностические вызовы (read_file для отладки, если не нужны для результата)
- Сохрани только шаги, необходимые для воспроизведения результата

### 4. Определить inputs
Найди значения, которые:
- Пользователь явно задавал ("возьми тему X", "файл Y", "URL Z")
- Менялись бы при повторном запуске (темы, пути, URL, даты, имена)
- НЕ являются техническими деталями реализации

Каждый input: id (snake_case), title, description, type, required, default.

### 5. Определить LLM-шаги
Если в сессии агент генерировал текст (не tool call) на основе указаний пользователя (стиль, формат, тон), и этот текст критичен для результата — создай LLM-шаг с:
- system_prompt_template: сжатые указания из текста пользователя
- user_prompt_template: шаблон с плейсхолдерами inputs

### 6. Сформировать тесты
Минимум:
- file_exists для каждого создаваемого файла
- file_contains для ключевых маркеров (заголовки, обязательные секции)
- custom_llm_judge если результат — текст с субъективным качеством

### 7. Определить outputs шагов
Для каждого шага определи, что он производит, что используется следующими шагами.

## Формат ответа
Верни JSON объект MiniWorkflow по схеме из спецификации §4.

## Важно
- НЕ копируй чат целиком. Сжимай.
- НЕ включай секретные данные (API ключи, пароли).
- Если шаг зависит от предыдущего — используй плейсхолдеры {{steps.X.outputs.Y}}.
- Если не уверен, что сессия пригодна для workflow — скажи об этом.

## История сессии:
{{session_messages_json}}
```

### 9.4. Пример: сессия → distill → workflow

#### Исходная сессия (упрощённо)
```
USER: "Найди в интернете информацию о влиянии ИИ на рынок труда в 2025 году
       и сделай отчёт в формате markdown. Минимум 3 источника.
       Стиль — деловой, без воды. Сохрани в файл report.md"

TOOL_USE: search_web { query: "AI impact on job market 2025" }
TOOL_RESULT: { output: "1. McKinsey report... 2. WEF study... 3. Bloomberg article..." }

TOOL_USE: search_web { query: "artificial intelligence employment statistics 2025" }
TOOL_RESULT: { output: "4. BLS data... 5. OECD report..." }

TOOL_USE: fetch_html { url: "https://mckinsey.com/..." }
TOOL_RESULT: { output: "..." }

ASSISTANT: "Проанализировал 5 источников. Составляю отчёт..."

TOOL_USE: write_file { path: "report.md", content: "# Влияние ИИ на рынок труда\n\n## Summary\n..." }
TOOL_RESULT: { output: "File written: report.md (4.2KB)" }

ASSISTANT: "Готово. Отчёт сохранён в report.md. Использовано 5 источников, формат деловой."
```

#### Результат distill
```json
{
  "id": "ai-impact-report",
  "name": "Исследование и отчёт",
  "description": "Ищет информацию по заданной теме и генерирует структурированный MD-отчёт",
  "icon": "📊",
  "version": "0.1.0",
  "source_session_id": "sess_abc123",
  "status": "draft",
  "tags": ["research", "report"],
  "goal": "Найти информацию по заданной теме в интернете и создать структурированный отчёт в формате Markdown",
  "definition_of_done": "Файл отчёта создан, содержит минимум N источников, имеет структуру с заголовками",
  "constraints": [
    "Минимум {{inputs.min_sources}} источников",
    "Стиль: {{inputs.style}}",
    "Формат: Markdown с заголовками ## Summary, ## Analysis, ## Sources"
  ],
  "inputs": [
    {
      "id": "topic",
      "title": "Тема исследования",
      "description": "О чём искать информацию и писать отчёт",
      "type": "text",
      "required": true
    },
    {
      "id": "min_sources",
      "title": "Минимум источников",
      "description": "Сколько источников нужно найти",
      "type": "number",
      "required": true,
      "default": 3,
      "validation": { "min": 1, "max": 20 }
    },
    {
      "id": "style",
      "title": "Стиль написания",
      "description": "Тон и стиль текста отчёта",
      "type": "string",
      "required": false,
      "default": "деловой, без воды"
    },
    {
      "id": "output_path",
      "title": "Путь к файлу",
      "description": "Куда сохранить отчёт",
      "type": "file_path",
      "required": true,
      "default": "report.md"
    }
  ],
  "steps": [
    {
      "id": "search",
      "kind": "tool",
      "title": "Поиск информации",
      "description": "Найти источники по теме в интернете",
      "tool_name": "search_web",
      "args_template": { "query": "{{inputs.topic}}" },
      "outputs": [
        { "name": "results", "type": "string", "description": "Результаты поиска", "source": "tool_result" }
      ],
      "expect": { "success_required": true, "capture": "output" },
      "on_error": { "strategy": "retry", "max_retries": 2 }
    },
    {
      "id": "analyze",
      "kind": "llm",
      "title": "Анализ и структурирование",
      "description": "LLM анализирует найденные источники и составляет структуру отчёта",
      "system_prompt_template": "Ты аналитик. Стиль: {{inputs.style}}. Ограничения: минимум {{inputs.min_sources}} источников. Формат: Markdown с ## Summary, ## Analysis, ## Sources.",
      "user_prompt_template": "Проанализируй найденную информацию по теме '{{inputs.topic}}' и составь структурированный отчёт.\n\nНайденные источники:\n{{steps.search.outputs.results}}",
      "allowed_tools": [],
      "outputs": [
        { "name": "report_text", "type": "string", "description": "Текст отчёта в MD", "source": "llm_response" }
      ],
      "on_error": { "strategy": "retry", "max_retries": 2 }
    },
    {
      "id": "save",
      "kind": "tool",
      "title": "Сохранение отчёта",
      "description": "Записать отчёт в файл",
      "tool_name": "write_file",
      "args_template": {
        "path": "{{inputs.output_path}}",
        "content": "{{steps.analyze.outputs.report_text}}"
      },
      "outputs": [
        { "name": "file_path", "type": "file_path", "description": "Путь к сохранённому файлу", "source": "tool_result" }
      ],
      "expect": { "success_required": true, "capture": "output" },
      "on_error": { "strategy": "fail" }
    }
  ],
  "tests": [
    {
      "id": "file_created",
      "title": "Файл отчёта создан",
      "kind": "file_exists",
      "params": { "path": "{{inputs.output_path}}" },
      "severity": "blocking"
    },
    {
      "id": "has_structure",
      "title": "Отчёт содержит обязательные секции",
      "kind": "file_contains",
      "params": {
        "path": "{{inputs.output_path}}",
        "must_include": ["## Summary", "## Analysis", "## Sources"]
      },
      "severity": "blocking"
    },
    {
      "id": "quality_check",
      "title": "Качество текста",
      "kind": "custom_llm_judge",
      "params": {
        "rubric": "Отчёт содержит анализ минимум {{inputs.min_sources}} источников, написан в стиле '{{inputs.style}}', имеет логичную структуру, не содержит воды и общих фраз",
        "target": "{{inputs.output_path}}"
      },
      "severity": "warning"
    }
  ],
  "artifacts": [
    {
      "type": "file",
      "title": "Отчёт",
      "ref": "{{inputs.output_path}}"
    }
  ],
  "compatibility": {
    "tools_required": ["search_web", "write_file"],
    "tools_optional": ["fetch_html", "fetch_json"]
  },
  "safety": {
    "permission_mode_on_replay": "ask",
    "side_effects": ["local_fs", "network"],
    "network_policy": "allow_web_read"
  }
}
```

### 9.5. Генерация SKILL.md из workflow

На основе `workflow.json` автоматически генерируется `SKILL.md`:

```markdown
---
name: Исследование и отчёт
description: Ищет информацию по заданной теме и генерирует структурированный MD-отчёт
type: mini-workflow
icon: 📊
version: 0.1.0
allowed-tools: [search_web, write_file, fetch_html, fetch_json]
workflow-file: workflow.json
---

# Исследование и отчёт

## Цель
Найти информацию по заданной теме в интернете и создать структурированный
отчёт в формате Markdown.

## Входные данные
Пользователь предоставит:
- **topic** — тема исследования
- **min_sources** — минимальное количество источников (по умолчанию 3)
- **style** — стиль написания (по умолчанию "деловой, без воды")
- **output_path** — путь для сохранения (по умолчанию "report.md")

## Инструкция для агента

Выполни следующие шаги строго по порядку:

### Шаг 1: Поиск информации
Используй `search_web` для поиска по теме "{{topic}}".
Найди минимум {{min_sources}} релевантных источников.

### Шаг 2: Анализ и написание отчёта
На основе найденных источников составь структурированный отчёт:
- Формат: Markdown
- Обязательные секции: ## Summary, ## Analysis, ## Sources
- Стиль: {{style}}
- Каждый источник должен быть процитирован в секции Sources

### Шаг 3: Сохранение
Сохрани отчёт в файл {{output_path}} с помощью `write_file`.

## Критерии успеха (Definition of Done)
- Файл {{output_path}} создан и не пуст
- Содержит секции: Summary, Analysis, Sources
- Минимум {{min_sources}} источников процитировано
- Стиль соответствует: {{style}}

## Ограничения
- Минимум {{min_sources}} источников
- Стиль: {{style}}
- Формат: Markdown с заголовками ## Summary, ## Analysis, ## Sources
```

## 10. Ограничения и критерии "не компилируется"

Distiller должен честно сказать "это не workflow".

**Fail-fast**, если:
- Нет tool calls и результат — чистый текст → предложить Prompt Preset
- Результат не достигнут (пользователь не подтвердил, агент не определил)
- Workflow зависит от внешнего состояния без API/инструмента ("зайди в аккаунт руками")

**Warning** (можно продолжить с предупреждением):
- > 50% tool calls зафейлились
- Сессия очень длинная (> 30 tool_use) — workflow может быть ненадёжным
- Workflow требует tools, которые не установлены в текущей конфигурации

## 11. Редактирование workflow

### 11.1. Кто редактирует
Редактирование выполняет **агент** через специальный skill `edit-mini-workflow`.

### 11.2. Процесс
1. Пользователь выбирает "Редактировать" в контекстном меню плитки.
2. Открывается новая сессия с подгруженным skill `edit-mini-workflow`.
3. Агент получает текущий `workflow.json` и `SKILL.md`.
4. Пользователь описывает изменения в чате.
5. Агент вносит правки → прогоняет тесты → сохраняет новую версию.
6. Старая версия архивируется в `~/.valera/workflows/<id>/versions/`.

### 11.3. Skill `edit-mini-workflow`
Отдельный built-in skill, который:
- Знает формат MiniWorkflow (§4)
- Может читать/редактировать `workflow.json` и `SKILL.md`
- Запускает тесты после правок
- Инкрементирует версию (semver patch)

## 12. Системная функция Distill

### 12.1. API
`distillWorkflow(sessionId: string): Promise<DistillResult>`

```typescript
type DistillResult =
  | { status: 'success', workflow: MiniWorkflow }
  | { status: 'needs_clarification', questions: string[] }
  | { status: 'not_suitable', reason: string, suggest_prompt_preset: boolean }
```

### 12.2. Реализация
1. Загрузить историю: `sessionStore.getSessionHistory(sessionId)`
2. Предварительная проверка (§9.2)
3. Сформировать промпт для Distill-агента (§9.3)
4. Запустить LLM с промптом + историей
5. Распарсить ответ как MiniWorkflow JSON
6. Валидировать структуру
7. Вернуть результат

## 13. Acceptance criteria (MVP)

MVP готов, если:
1. Пользователь может нажать "Save as Mini-workflow" в успешной сессии.
2. Получает превью: inputs/steps/tests/goal/constraints.
3. Может редактировать название, описание, inputs в превью.
4. Может нажать "Run tests".
5. При FAIL агент дорабатывает workflow и тесты повторяются (макс. 3 раза).
6. При PASS и подтверждении — workflow сохраняется и появляется плитка в правой панели.
7. Запуск плитки открывает форму inputs → запускает новый чат → воспроизводит результат.
8. Секреты не утекли в логи/БД/skill (проверяется автоматом).
9. Правая панель сворачивается/разворачивается.
10. Пользователь может удалить workflow через контекстное меню.

## 14. Сценарные тесты для приёмки

### 14.1. Unit-тесты

#### UT-01: Извлечение tool-trace из сессии
```
Given: SessionHistory с 10 messages (3 user_prompt, 2 text, 3 tool_use, 2 tool_result)
When:  extractToolTrace(messages)
Then:  Возвращает 3 пары {tool_use, tool_result}, связанные по id/tool_use_id
  And: Порядок хронологический
```

#### UT-02: Фильтрация неудачных попыток
```
Given: tool-trace с 5 парами, из них 2 — одинаковый tool+args, первая is_error=true, вторая is_error=false
When:  filterFailedRetries(trace)
Then:  Возвращает 4 пары (неудачная попытка удалена)
```

#### UT-03: Определение conversation-centric сессии
```
Given: SessionHistory с 8 messages, 0 tool_use
When:  checkDistillability(messages)
Then:  Возвращает { suitable: false, reason: 'no_tool_calls', suggest_prompt_preset: true }
```

#### UT-04: Валидация MiniWorkflow JSON
```
Given: JSON-объект с полями из §4, но без обязательного поля "goal"
When:  validateWorkflow(json)
Then:  Возвращает { valid: false, errors: ["missing required field: goal"] }
```

#### UT-05: Редакция секретов
```
Given: tool_use с input { "api_key": "sk-12345", "query": "test" },
       workflow input "api_key" помечен secret=true
When:  redactSecrets(tool_use, secretFields)
Then:  Возвращает { "api_key": "[REDACTED]", "query": "test" }
```

#### UT-06: Резолвинг плейсхолдеров
```
Given: args_template = { "query": "{{inputs.topic}} {{inputs.year}}" },
       inputs = { topic: "AI", year: "2025" }
When:  resolveTemplate(args_template, context)
Then:  Возвращает { "query": "AI 2025" }
```

#### UT-07: Резолвинг step outputs
```
Given: args_template = { "content": "{{steps.search.outputs.results}}" },
       step_outputs = { search: { results: "found 5 items" } }
When:  resolveTemplate(args_template, context)
Then:  Возвращает { "content": "found 5 items" }
```

#### UT-08: Версионирование — хранение до 5 версий
```
Given: workflow "report-gen" с 5 существующими версиями (v1-v5)
When:  saveNewVersion(workflow, updatedData)
Then:  Создана v6, удалена v1, в директории versions/ ровно 5 папок (v2-v6)
  And: Активная версия обновлена в ~/.valera/skills/report-gen/
```

### 14.2. Сценарные (интеграционные) тесты

#### ST-01: Happy path — создание workflow из tool-centric сессии
```
Given: Сессия sess_01 со статусом "completed"
  And: 5 tool_use (search_web ×2, fetch_html ×1, write_file ×2), все is_error=false
  And: Финальное сообщение ассистента: "Готово. Файл report.md создан."
  And: 2 user_prompt с указаниями темы и формата

When:  Пользователь нажимает "Save as Mini-workflow"

Then:  Появляется модалка с loading ("Анализирую сессию...")
  And: Через 5-15 сек появляется превью:
       - name непустое
       - inputs содержит минимум 1 элемент
       - steps содержит минимум 2 шага
       - tests содержит минимум 1 тест
       - goal непустой
  And: Кнопка "Run tests" активна
```

#### ST-02: Happy path — тесты проходят, workflow публикуется
```
Given: ST-01 выполнен, модалка в состоянии "preview"

When:  Пользователь нажимает "Run tests"

Then:  Модалка переходит в состояние "testing" (спиннер)
  And: Создаётся тестовая сессия (невидимая пользователю или в фоне)
  And: Тесты выполняются в изолированной директории
  And: По завершении — модалка показывает результаты (зелёный/красный)
  
When:  Все blocking тесты PASS
  And: Пользователь нажимает "Сохранить и опубликовать"

Then:  Файлы сохранены:
       - ~/.valera/skills/<workflow_id>/SKILL.md (существует, содержит frontmatter type: mini-workflow)
       - ~/.valera/skills/<workflow_id>/workflow.json (валидный JSON по схеме §4)
  And: Плитка появилась в правой панели
  And: Плитка содержит name, icon, version, inputs count
```

#### ST-03: Тесты фейлятся, агент дорабатывает (до 3 попыток)
```
Given: ST-01 выполнен, модалка в состоянии "preview"
  And: Тест file_contains ожидает "## Conclusion", но workflow не генерирует эту секцию

When:  Пользователь нажимает "Run tests"
  And: Тест file_contains FAIL

Then:  Модалка показывает: "Тест не пройден: file_contains — секция ## Conclusion не найдена"
  And: Кнопка "Доработать" активна
  
When:  Пользователь нажимает "Доработать"

Then:  Агент получает отчёт об ошибке и workflow JSON
  And: Агент модифицирует workflow (добавляет constraint/шаг для секции Conclusion)
  And: Тесты запускаются повторно
  And: Счётчик попыток: 1/3 → 2/3

When:  После 3 неудачных попыток

Then:  Модалка показывает: "3 попытки исчерпаны"
  And: Кнопки: "Сохранить как draft" / "Отмена"
```

#### ST-04: Запуск опубликованного workflow
```
Given: Опубликованный workflow "report-gen" с 3 inputs (topic, min_sources, output_path)
  And: Правая панель открыта, плитка видна

When:  Пользователь нажимает "Запустить" на плитке

Then:  Открывается модалка формы inputs
  And: Поле "topic" — текстовое, обязательное, пустое
  And: Поле "min_sources" — числовое, обязательное, default=3
  And: Поле "output_path" — текстовое, обязательное, default="report.md"
  And: Кнопка "Запустить" disabled (topic не заполнен)

When:  Пользователь заполняет topic="Квантовые компьютеры"
  And: Нажимает "Запустить"

Then:  Создаётся новая сессия с заголовком "report-gen: Квантовые компьютеры"
  And: Активная сессия переключается на новую
  And: Агент начинает выполнение (виден прогресс в чате)
  And: В system prompt загружен SKILL.md workflow
  And: User prompt содержит inputs пользователя
```

#### ST-05: Conversation-centric сессия — fail-fast
```
Given: Сессия sess_02 со статусом "completed"
  And: 6 messages, все типа user_prompt и text (0 tool_use)

When:  Пользователь нажимает "Save as Mini-workflow"

Then:  Модалка появляется в состоянии "distill_failed"
  And: Сообщение: "Эта сессия не содержит вызовов инструментов и не может быть преобразована в workflow."
  And: Предложение: "Хотите сохранить как Prompt Preset?" (disabled в MVP)
  And: Кнопка "Закрыть"
```

#### ST-06: Сессия с неопределённым результатом — уточнение
```
Given: Сессия sess_03 со статусом "completed"
  And: 4 tool_use, но последние tool_result содержат ошибки
  And: Финальное сообщение ассистента не содержит признаков завершения

When:  Пользователь нажимает "Save as Mini-workflow"
  And: Distiller не может определить результат

Then:  Модалка показывает: "Не удалось определить результат сессии."
  And: Вопрос: "Был ли достигнут результат? Что именно является результатом?"
  And: Текстовое поле для ответа пользователя
  And: Кнопка "Продолжить" (повторный distill с уточнением)
```

#### ST-07: Секреты не утекают
```
Given: Сессия содержит tool_use с input { "api_key": "sk-real-key-12345" }
  And: При distill input "api_key" помечен type=secret

When:  Workflow сохранён
  And: Replay выполнен с secret input "sk-new-key-67890"

Then:  В ~/.valera/skills/<id>/workflow.json НЕ содержится "sk-real-key-12345"
  And: В ~/.valera/skills/<id>/SKILL.md НЕ содержится "sk-real-key-12345"
  And: В SQLite messages НЕ содержится "sk-new-key-67890"
  And: В SQLite messages содержится "{{secret::api_key}}" или "[REDACTED]" вместо значения
  And: В ~/.valera/logs/sessions/*/turn-*.json НЕ содержится "sk-new-key-67890"
  And: В ~/.valera/workflows/<id>/runs/*.json поле inputs.api_key = "[REDACTED]"
```

#### ST-08: Удаление workflow
```
Given: Опубликованный workflow "seo-audit" с плиткой в панели

When:  Пользователь нажимает [⋯] → "Удалить"

Then:  Появляется подтверждение: "Удалить workflow 'SEO-аудит'? Это действие необратимо."
  And: Кнопки: "Удалить" (красная) / "Отмена"

When:  Пользователь нажимает "Удалить"

Then:  Директория ~/.valera/skills/seo-audit/ удалена
  And: Версии ~/.valera/workflows/seo-audit/versions/ удалены
  And: Плитка исчезла из панели
```

#### ST-09: Правая панель — toggle
```
Given: Правая панель скрыта (по умолчанию)

When:  Пользователь нажимает кнопку [📋] в header

Then:  Панель 320px появляется справа с анимацией
  And: Main content сужается (ml-[280px] mr-[320px])
  And: Если есть workflow — отображаются плитки
  And: Если нет — placeholder с подсказкой

When:  Пользователь нажимает [✕] или снова [📋]

Then:  Панель скрывается
  And: Main content растягивается на полную ширину
```

#### ST-10: Пустая сессия — кнопка disabled
```
Given: Активная сессия со статусом "idle", 0 сообщений

Then:  Кнопка "Save as Mini-workflow" серая, disabled
  And: Tooltip: "Завершите сессию для создания workflow"

Given: Активная сессия со статусом "running"

Then:  Кнопка "Save as Mini-workflow" серая, disabled
  And: Tooltip: "Дождитесь завершения сессии"
```

#### ST-11: ReplayLog записывается при replay
```
Given: Опубликованный workflow "report-gen"

When:  Пользователь запускает replay с inputs { topic: "AI" }
  And: Replay завершается успешно

Then:  В ~/.valera/workflows/report-gen/runs/ создан файл <run_id>.json
  And: Файл содержит: workflow_id, workflow_version, inputs, step_results[], final_status="success"
  And: Каждый step_result содержит: step_id, status, duration_ms, outputs_hash
  And: Secret inputs в файле записаны как "[REDACTED]"
```

#### ST-12: test_context=session_cwd использует рабочую директорию
```
Given: Workflow с тестом { kind: "file_exists", test_context: "session_cwd", params: { path: "src/index.ts" } }
  And: Текущая рабочая директория содержит src/index.ts

When:  Тесты запускаются

Then:  Тест file_exists проверяет файл относительно cwd сессии (не во временной директории)
  And: Тест PASS
```

### 14.3. Тесты безопасности

#### SEC-01: Redaction pipeline
```
Given: Workflow с secret input "password"
When:  Replay выполняется, tool_use содержит password в args
Then:  В каждом месте персистенции (SQLite, turn-logs, SKILL.md) password заменён на [REDACTED]
```

#### SEC-02: Permission mode на replay
```
Given: Workflow с safety.permission_mode_on_replay = "ask"
When:  Replay выполняет tool "run_command"
Then:  Появляется permission request (как в обычном ask-режиме)
  And: Без подтверждения пользователя команда не выполняется
```

## 15. Зависимости и порядок реализации (рекомендуемый)

### Phase 1: Ядро (без UI)
1. Формат `MiniWorkflow` — TypeScript-типы + JSON-schema валидатор
2. `extractToolTrace(messages)` — извлечение tool-trace
3. `distillWorkflow(sessionId)` — промпт + парсинг
4. Хранение: SKILL.md + workflow.json генерация/чтение
5. Unit-тесты UT-01 — UT-08

### Phase 2: UI
6. Кнопка "Save as Mini-workflow" в PromptInput
7. Модалка Distill-превью
8. Правая панель с плитками
9. Модалка формы inputs
10. Модалка результатов тестов

### Phase 3: Replay + Тестирование
11. Replay через agent-assisted (новая сессия + SKILL.md)
12. Тестовый runner (TestSpec → results)
13. Цикл доработки (fail → agent fix → retest, до 3 раз)
14. Интеграционные тесты ST-01 — ST-10

### Phase 4: Hardening
15. Secret store + redaction pipeline
16. Версионирование (5 версий)
17. Skill `edit-mini-workflow`
18. Тесты безопасности SEC-01 — SEC-02
