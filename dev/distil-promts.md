# Distill Prompts v2 — Chain-of-Prompts Architecture

## Принцип

MiniApp = набор промптов + код-оркестратор.
Дистилляция: от результата к входам, 3 отдельных LLM-вызова.
Replay: оркестратор последовательно запускает промпты, передавая результаты.

---

## Дистилляция: 3 шага

### Step 1 — Определи результат
LLM анализирует историю сессии и определяет:
- Что стало финальным артефактом
- Какие требования предъявлялись
- result_clear=false -> отказ ("результат неясен")

### Step 2 — Извлеки переменные
На основе результата и истории LLM находит переменные:
- source: "user_input" -> станет Input (спросим у пользователя)
- source: "computed" -> вычисляется в ходе работы
- source: "constant" -> часть логики

### Step 3 — Построй цепочку промптов
LLM создаёт chain of focused prompts + validation config:
- chain: [{id, title, prompt_template, tools, output_key}]
- validation: {acceptance_criteria, prompt_template, max_fix_attempts}

---

## Replay

Код-оркестратор (без LLM):
1. Показать форму inputs пользователю
2. Подставить inputs в промпты через {{inputs.X}} и {{steps.Y.result}}
3. Запустить как обычную сессию с полным промптом
4. Агент сам проверяет, сам исправляет до N попыток

---

## Хранимая структура MiniWorkflow

```typescript
{
  inputs: InputSpec[],           // что спросить у пользователя
  chain: ChainStep[],           // упорядоченные промпты
  validation: ValidationConfig,  // критерии + промпт валидации
  artifacts: ArtifactSpec[],    // описание результата
  goal, definition_of_done, constraints, safety, ...
}
```

---

## Файлы

- `src/shared/mini-workflow-types.ts` — типы
- `src/agent/libs/mini-workflow.ts` — промпты, хранение, утилиты
- `src/agent/ipc-handlers.ts` — 3-step distill chain, replay handler
- `src/ui/App.tsx` — UI панель workflows
- `tests/mini-workflow.spec.ts` — 16 unit tests
