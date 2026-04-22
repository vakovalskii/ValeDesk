# Code Review: Mini-Workflow (SPEC_MINI_WORKFLOW.md)

> **Дата**: 2026-02-18
> **Ревьюер**: Claude (по запросу)
> **Реализация**: GPT
> **Файлы в скоупе**:
> - `src/agent/libs/mini-workflow.ts` (новый, ~626 строк)
> - `tests/mini-workflow.spec.ts` (новый, ~203 строки)
> - `src/agent/types.ts` (изменён — добавлены типы MiniWorkflow*)
> - `src/ui/types.ts` (изменён — зеркальные типы MiniWorkflow*)
> - `src/agent/ipc-handlers.ts` (изменён — 7 новых хэндлеров miniworkflow.*)
> - `src/agent/libs/runner-openai.ts` (изменён — secret resolve/redact)
> - `src/ui/App.tsx` (изменён — UI distill/panel/replay)
> - `src/ui/components/PromptInput.tsx` (изменён — кнопка "Save as Mini-workflow")

---

## Вердикт: Принимается с замечаниями (Approve with comments)

Реализация покрывает основной happy path спеки и в целом работоспособна.
Тесты проходят (10/10 PASS). Но есть ряд архитектурных и функциональных проблем,
которые нужно исправить до merge.

---

## 1. CRITICAL — Исправить обязательно

### 1.1. Дублирование типов MiniWorkflow в трёх местах

**Проблема**: Тип `MiniWorkflow` объявлен в трёх файлах:
- `src/agent/libs/mini-workflow.ts` — каноническая версия с полной типизацией (StepSpec, TestSpec, etc.)
- `src/agent/types.ts` — урезанная копия (`steps: Array<Record<string, unknown>>`)
- `src/ui/types.ts` — ещё одна урезанная копия

В agent/types.ts и ui/types.ts `steps`, `tests`, `artifacts` типизированы как `Array<Record<string, unknown>>` —
это теряет всю type-safety, которая есть в каноническом типе.

**Что делать**: `src/agent/types.ts` должен реэкспортировать типы из `mini-workflow.ts`.
`src/ui/types.ts` — или реэкспорт, или единый shared-types пакет. Три копии одного типа = гарантированный рассинхрон.

### 1.2. Секреты через `(global as any).__miniWorkflowSecretsBySession`

**Проблема**: В `ipc-handlers.ts`:

```typescript
const miniWorkflowSecretsBySession = new Map<string, MiniWorkflowSecretBag>();
(global as any).__miniWorkflowSecretsBySession = miniWorkflowSecretsBySession;
```

В `runner-openai.ts`:

```typescript
const workflowSecretsBySession = ((global as any).__miniWorkflowSecretsBySession as Map<...>) ?? new Map();
```

Это прямой sharing мутабельного состояния через `global` без какого-либо контракта.
Хрупко, не тестируемо, не очевидно при чтении runner.

**Что делать**: Передавать `secretBag` через `RunnerOptions`. Runner уже получает `options`,
добавить `secretBag?: Record<string, string>` — чисто, явно, тестируемо.

### 1.3. `distillSessionToWorkflow` — детерминированный distill не извлекает inputs

**Проблема**: По спеке §9.3 Distill должен определить inputs (значения, которые меняются от запуска к запуску).
Детерминированная функция `distillSessionToWorkflow` возвращает `inputs: []` всегда.
Шаги копируются дословно с хардкоженными аргументами (`args_template` = дословные аргументы из трейса).

Это значит, что при повторном запуске workflow будет выполнять точно те же вызовы с точно
теми же аргументами — никакой параметризации.

LLM-distill в `ipc-handlers.ts` (`distillWithLLM`) может это исправить, но:
- Если LLM-вызов упал → fallback на детерминированный, и inputs пустые
- В тестах тестируется только детерминированный вариант

**Что делать**: Хотя бы добавить базовую эвристику: если user_prompt содержит кавычки
или явные значения, которые совпадают с аргументами tool_use — предложить их как inputs.
Или: не падать на fallback молча, а возвращать `needs_clarification`.

### 1.4. LLM-ответ парсится без валидации структуры

**Проблема**: В `distillWithLLM` и `fixWorkflowWithLLM`:

```typescript
const jsonRaw = extractJsonObject(text);
if (!jsonRaw) throw new Error("Distill LLM returned non-JSON");
return JSON.parse(jsonRaw);
```

Результат `JSON.parse` приводится к `MiniWorkflow` без проверки.
LLM может вернуть любой JSON, и дальше по коду пойдёт невалидный объект.

В `ipc-handlers.ts` есть `validateWorkflow(llmWorkflow)`, но `validateWorkflow`
проверяет только наличие top-level полей — не проверяет типы, массивы steps/tests/inputs,
вложенные поля.

**Что делать**: Добавить runtime-валидацию (zod/ajv) или хотя бы расширить `validateWorkflow`
до проверки вложенных структур. Иначе один кривой ответ LLM = crash в UI.

---

## 2. HIGH — Надо исправить

### 2.1. `canSaveMiniWorkflow` проверяет `status === "completed"`, но ValeDesk сессии чаще "idle"

**Проблема**: В `App.tsx`:

```typescript
const canSaveMiniWorkflow = Boolean(
  activeSessionId && activeSession &&
  activeSession.status === "completed" &&
  messages.length > 0
);
```

Спека §6.3 говорит: enabled если "Сессия `completed`/`idle`, есть минимум 1 `tool_use`".
Текущий код:
1. Не проверяет наличие `tool_use`
2. Не принимает `idle` (а в ValeDesk runner после завершения сессия переходит в `idle`, не `completed`)

**Что делать**: `["completed", "idle"].includes(activeSession.status)` и проверить наличие
`tool_use` в messages.

### 2.2. Правая панель не учитывает ширину при `showWorkflowPanel`

**Проблема**: `<aside>` — `fixed`, `right-0`, `w-[320px]`.
`<main>` получает `mr-[320px]`.
Но `PromptInput` — тоже `fixed bottom-0 left-0 right-0` и **не знает** про правую панель.
Ввод текста будет перекрываться панелью.

**Что делать**: Пробросить `showWorkflowPanel` в PromptInput и добавить `mr-[320px]`
к `<section>`, или использовать CSS variable / контекст.

### 2.3. `MiniWorkflowStore` — `delete` scope="both" рекурсия через `scope: "global"`

**Проблема**: В `MiniWorkflowStore.delete`:

```typescript
if (options?.scope === "both" && options.projectCwd) {
  await this.delete(workflowId, { baseDir: options.baseDir, scope: "global" });
  await this.delete(workflowId, { baseDir: options.projectCwd, scope: "project" });
```

Второй вызов с `scope: "project"` не устанавливает `baseDir` на `projectCwd`.
Метод `baseDirs(options?.baseDir)` по умолчанию возвращает `homedir()`, а при `scope: "project"`
`options?.baseDir` = `options.projectCwd` — но это передаётся в позицию `baseDir`, а не `projectCwd`.
Нужно перепроверить, что пути корректны.

### 2.4. `inferGoal` берёт последний user_prompt — не лучшая эвристика

**Проблема**: `inferGoal` возвращает последний `user_prompt` как цель workflow.
Последний промпт часто выглядит как "да" или "всё ок, продолжай" — это не цель.
Лучше брать первый промпт (он обычно описывает задачу).

### 2.5. `runMiniWorkflowTests` — `tool_smoke` проверяет только `tools_required`

**Проблема**: `tool_smoke` тест по спеке должен проверять доступность тула (можно ли его вызвать).
Текущая реализация только проверяет, есть ли имя в `workflow.compatibility.tools_required` — это тавтология,
потому что тест сам генерируется из этого массива.

**Что делать**: Проверять через `toolsExecutor` или хотя бы через registry доступных инструментов.

### 2.6. Нет анимации появления/скрытия правой панели

Спека §ST-09 требует: "Панель 320px появляется справа **с анимацией**".
Текущая реализация — просто `{showWorkflowPanel && <aside>}`, мгновенное появление/скрытие.

### 2.7. Форма inputs при replay — все поля рендерятся как `<input type="text">`

**Проблема**: Спека §6.6 описывает рендеринг полей по типу (number → `<input type="number">`,
boolean → checkbox, enum → select, date → date picker и т.д.). Текущая реализация:

```typescript
<input
  type={input.type === "secret" ? "password" : "text"}
  ...
/>
```

Все типы кроме `secret` рендерятся как обычный text input.

### 2.8. Не реализовано состояние `loading` / `warning` для кнопки "Save as Mini-workflow"

Спека §6.3 описывает 4 состояния кнопки: disabled, enabled, loading, warning.
`loading` (distill в процессе) и `warning` (нет tool_use) не реализованы.

---

## 3. MEDIUM — Желательно исправить

### 3.1. `generateSkillMarkdown` не включает constraints и steps

Спека §9.5 показывает SKILL.md с секциями "Инструкция для агента" (пошаговые инструкции),
"Ограничения", "Входные данные". Текущая генерация:

```markdown
# {name}

## Цель
{goal}

## Definition of Done
{definition_of_done}
```

Нет инструкций для агента, нет inputs, нет constraints. При replay агент не получит
нужного контекста из SKILL.md.

### 3.2. `buildReplayPrompt` не загружает SKILL.md через `load_skill`

По спеке §7.1: "В system prompt инжектится содержимое SKILL.md workflow (через load_skill)".
Текущая реализация формирует prompt вручную из полей workflow — не использует SKILL.md
и не загружает через skill-систему.

### 3.3. Версионирование — `saveNewVersion` не инкрементирует version в workflow

`saveNewVersion` сохраняет workflow as-is. Номер версии обновляется только в `MiniWorkflowStore.save`,
но если вызвать `saveNewVersion` напрямую (а он экспортирован) — версия не инкрементируется.

### 3.4. Нет cleanup `isolatedDir` при ошибке в середине тестов

В `runMiniWorkflowTests`:

```typescript
await fs.rm(isolatedDir, { recursive: true, force: true }).catch(() => undefined);
```

Cleanup в конце функции, но если `fs.mkdir(isolatedDir)` упал или тест выкинул
непойманное исключение до cleanup — директория останется.

### 3.5. `extractJsonObject` может вернуть невалидный JSON

Regex `raw.match(/```json\s*([\s\S]*?)```/i)` берёт первый fenced block.
Если LLM вернул два блока (описание + JSON), захватит первый, который может быть не JSON.
Fallback `firstBrace..lastBrace` ещё хуже — если в тексте есть `{` до JSON, захватит мусор.

### 3.6. Двойной запрос `miniworkflow.list` при маунте

В `App.tsx` два useEffect:
```typescript
// Первый (connected):
sendEvent({ type: "miniworkflow.list", payload: { cwd: activeSession?.cwd } });
// Второй (activeSession?.cwd):
sendEvent({ type: "miniworkflow.list", payload: { cwd: activeSession?.cwd } });
```

Оба зависят от `activeSession?.cwd` и `connected`, дублируют вызов при маунте.

### 3.7. `distillWithLLM` отправляет всю историю сессии в один LLM-вызов

`JSON.stringify(input.history)` может быть огромным (десятки KB).
Нет обрезки, нет предварительной фильтрации. На длинных сессиях — потенциальный
context overflow или дорогой вызов.

### 3.8. `ReplayLog` не содержит `outputs_hash` для некоторых шагов

В `ipc-handlers.ts` replay tracking слушает `message.type === "assistant"` и `"user"` из
SDK format, но ValeDesk OpenAI runner использует другой формат сообщений. Нужно проверить,
что step tracking реально срабатывает, а не молча пропускает все шаги.

---

## 4. LOW — Мелочи

### 4.1. `as any` — 47 вхождений в ipc-handlers.ts

Массовое использование `as any` вместо нормальной типизации. Не критично для runtime,
но делает TypeScript бесполезным в этих местах.

### 4.2. Нет фильтра по тегам/поиска в панели workflows

Спека §6.4 описывает `[🔍 Filter...]` — поиск по имени/тегам. Не реализовано.

### 4.3. Нет контекстного меню [⋯] на плитке workflow

Спека §6.4 описывает контекстное меню с "Редактировать", "Архивировать", "Удалить".
Реализована только кнопка Delete inline.

### 4.4. Нет `test_context: "isolated"` логики в тестах

`runMiniWorkflowTests` создаёт `isolatedDir`, но для `file_exists` и `file_contains`
тестов `baseDir` переключается корректно. Однако тестов, проверяющих изолированный контекст,
в spec-файле нет.

### 4.5. Нет Prompt Preset fallback

Спека говорит: при conversation-centric сессии предложить "сохранить как Prompt Preset".
В UI показывается сообщение об ошибке, но кнопки/действия для Prompt Preset нет (ожидаемо — это out of scope для MVP).

### 4.6. `slugify` не работает с кириллицей

```typescript
return input.toLowerCase().replace(/[^a-z0-9]+/g, "-")...
```

Если name workflow на русском — `slugify` отрежет всё и вернёт fallback `workflow-<uuid>`.

---

## 5. Покрытие спеки

| Секция спеки | Статус | Комментарий |
|---|---|---|
| §4 Формат MiniWorkflow | ✅ Частично | Типы есть, но StepSpec в UI потерян |
| §5 Хранение | ✅ | SKILL.md + workflow.json + версии |
| §6.3 Кнопка Save as | ⚠️ | Не все состояния, не проверяет tool_use |
| §6.4 Панель workflows | ⚠️ | Нет фильтра, нет [⋯] меню |
| §6.5 Модалка distill | ✅ | Работает |
| §6.6 Модалка inputs | ⚠️ | Все поля = text |
| §6.7 Модалка тестов | ✅ | Интегрирована в distill модалку |
| §7 Replay | ✅ | Через agent-assisted |
| §8 Секреты | ✅ | Но через global hack |
| §9 Distill | ⚠️ | Нет inputs, SKILL.md неполный |
| §10 Ограничения | ✅ | fail-fast работает |
| §11 Редактирование | ❌ | Не реализовано |
| §14 Сценарные тесты | ⚠️ | UT-01..08 есть, ST и SEC — нет |

---

## 6. Тесты

**Что есть (10 тестов, все PASS)**:
- UT-01: extractToolTrace — ordered pairs ✅
- UT-02: filterFailedRetries ✅
- UT-03: checkDistillability ✅
- UT-04: validateWorkflow ✅
- UT-05: redactSecrets ✅
- UT-06: resolveTemplate inputs ✅
- UT-07: resolveTemplate step outputs ✅
- UT-08: saveNewVersion — 5 versions limit ✅
- Доп: distill with clarification ✅
- Доп: store merge project/global ✅

**Что отсутствует**:
- Тесты на `buildReplayPrompt`
- Тесты на `writeReplayLog`
- Тесты на `runMiniWorkflowTests` (file_exists, file_contains, json_schema)
- Тесты на `generateSkillMarkdown`
- Тесты на `MiniWorkflowStore.delete`
- Интеграционные тесты ST-01..ST-12
- Тесты безопасности SEC-01, SEC-02
- Edge cases: пустой trace + clarification, workflow с secret inputs, длинные сессии

---

## 7. Итого: приоритеты исправлений

| # | Приоритет | Задача |
|---|---|---|
| 1 | CRITICAL | Убрать дублирование типов MiniWorkflow (реэкспорт из mini-workflow.ts) |
| 2 | CRITICAL | Заменить `global.__miniWorkflowSecretsBySession` на `RunnerOptions.secretBag` |
| 3 | CRITICAL | Добавить runtime-валидацию LLM-ответа (zod или расширить validateWorkflow) |
| 4 | CRITICAL | Добавить извлечение inputs в детерминированном distill |
| 5 | HIGH | Исправить `canSaveMiniWorkflow` — принимать `idle` + проверять tool_use |
| 6 | HIGH | Пробросить `showWorkflowPanel` в PromptInput (перекрытие панелью) |
| 7 | HIGH | Рендерить input-поля по типу (number, boolean, enum, etc.) |
| 8 | HIGH | Дополнить `generateSkillMarkdown` — steps, constraints, inputs |
| 9 | MEDIUM | Добавить тесты на buildReplayPrompt, runMiniWorkflowTests, writeReplayLog |
| 10 | MEDIUM | Обрезать историю перед отправкой в distillWithLLM |
