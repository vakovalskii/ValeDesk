import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { StreamMessage } from "../types.js";
import type { DistillResult, MiniWorkflow, MiniWorkflowSummary, ChainStep, ValidationConfig } from "../../shared/mini-workflow-types.js";
export type { DistillResult, MiniWorkflow, MiniWorkflowSummary } from "../../shared/mini-workflow-types.js";
export { detectPermissions } from "../../shared/mini-workflow-types.js";
export type { DetectedPermissions } from "../../shared/mini-workflow-types.js";

// ─── Utility helpers ───

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `workflow-${randomUUID().slice(0, 8)}`;
}

function parsePatch(version: string): number {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return 0;
  return Number(m[3]) || 0;
}

function nextPatch(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "0.1.0";
  return `${m[1]}.${m[2]}.${(Number(m[3]) || 0) + 1}`;
}

function baseDirs(baseDir?: string): { skillsDir: string; workflowsDir: string } {
  const root = baseDir ?? homedir();
  return {
    skillsDir: join(root, ".valera", "skills"),
    workflowsDir: join(root, ".valera", "workflows")
  };
}

function dedupeById(workflows: MiniWorkflowSummary[]): MiniWorkflowSummary[] {
  const map = new Map<string, MiniWorkflowSummary>();
  for (const wf of workflows) {
    const prev = map.get(wf.id);
    if (!prev || prev.updated_at < wf.updated_at) map.set(wf.id, wf);
  }
  return Array.from(map.values()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// ─── Template resolution (for replay prompt rendering) ───

export function renderTemplate(template: string, context: { inputs: Record<string, unknown>; steps: Record<string, { result: string }> }): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, ref: string) => {
    const path = ref.trim();
    if (path.startsWith("inputs.")) {
      const key = path.slice("inputs.".length);
      return String(context.inputs[key] ?? "");
    }
    if (path.startsWith("steps.")) {
      const parts = path.split(".");
      // {{steps.step_id.result}}
      if (parts.length >= 3) {
        const stepId = parts[1];
        const field = parts.slice(2).join(".");
        if (field === "result") return context.steps[stepId]?.result ?? "";
      }
    }
    return `{{${path}}}`;
  });
}

// ─── Secret redaction ───

export function redactSecrets<T>(payload: T, secretFields: Set<string>): T {
  if (typeof payload === "string") return payload as T;
  if (Array.isArray(payload)) return payload.map((v) => redactSecrets(v, secretFields)) as T;
  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (secretFields.has(k)) out[k] = "[REDACTED]";
      else out[k] = redactSecrets(v, secretFields);
    }
    return out as T;
  }
  return payload;
}

// ─── Distillability check ───

export function checkDistillability(messages: StreamMessage[]): { suitable: boolean; reason?: string; suggest_prompt_preset?: boolean } {
  const hasToolUse = (messages as Array<any>).some((m) => m?.type === "tool_use");
  if (!hasToolUse) {
    return { suitable: false, reason: "no_tool_calls", suggest_prompt_preset: true };
  }
  return { suitable: true };
}

// ─── Concise history builder (shared by distill steps) ───

export function buildConciseHistory(messages: StreamMessage[], limit = 120): any[] {
  return (messages as Array<any>)
    .filter((m) => ["user_prompt", "tool_use", "tool_result", "text"].includes(String(m?.type)))
    .slice(-limit);
}

// ─── Distill Step 1: Identify result ───

export const DISTILL_STEP1_SYSTEM = `Ты анализируешь историю сессии AI-агента с пользователем.

Задача: определи, что стало ФИНАЛЬНЫМ РЕЗУЛЬТАТОМ сессии — артефакт, который пользователь принял.

Признаки результата:
- Файл, созданный через write_file / edit_file / execute_python (savefig, to_csv и т.д.)
- Данные, скачанные и обработанные агентом (графики, таблицы, отчёты)
- Текст/таблица/отчёт, который ассистент представил как итог работы

ВАЖНО — различай ОСНОВНУЮ РАБОТУ и МЕТА-ОБСУЖДЕНИЕ:
- Если сессия сначала ДЕЛАЛА работу (скачивала данные, строила графики, создавала файлы), а потом пользователь спрашивал "что ты сделал?" / "опиши результат" — результат сессии это СОЗДАННЫЕ АРТЕФАКТЫ (файлы, графики, данные), а НЕ мета-описание работы.
- "Мета" вопросы в конце сессии (описание работы, ревью, пояснения) — это НЕ результат, а обсуждение результата.
- Ищи ПЕРВИЧНЫЕ артефакты: файлы, графики, данные, код — то, ради чего сессия была начата.

Ответь JSON (без markdown-обёртки):
{
  "result_clear": true | false,
  "result_description": "краткое описание артефакта-результата (что СОЗДАНО, а не что обсуждалось)",
  "result_type": "file" | "text" | "table" | "link" | "code" | "other",
  "result_requirements": "требования, которые пользователь явно или неявно предъявлял к результату (формат, содержание, ограничения)",
  "primary_artifacts": ["список созданных файлов/артефактов, если видны в истории"],
  "reason": "если result_clear=false — почему результат неясен"
}`;

export function buildDistillStep1User(sessionId: string, cwd: string, history: any[]): string {
  return `Session ID: ${sessionId}\nCWD: ${cwd}\n\nHistory JSON:\n${JSON.stringify(history)}`;
}

// ─── Distill Step 2: Extract variables/inputs ───

export const DISTILL_STEP2_SYSTEM = `Ты анализируешь историю сессии AI-агента.

Контекст: результат сессии уже определён (см. user message).

Задача: найди все ПЕРЕМЕННЫЕ ВЕЛИЧИНЫ — значения, которые при повторном запуске могут измениться, НЕ меняя логику задачи.

Примеры переменных: имя файла, тема отчёта, период дат, ФИО, URL, валюта, язык.
НЕ переменные: имена инструментов, структура промпта, формат вывода.

ВАЖНО: выделяй только СУЩЕСТВЕННЫЕ параметры, которые пользователь РЕАЛЬНО захочет менять при повторном запуске.
НЕ выделяй:
- session_id, workspace/cwd пути — это системные переменные, не параметры задачи
- Промежуточные результаты и вычисляемые значения (source: "computed") — не включай их вообще
- Технические детали реализации (имена переменных, форматы данных)
- Историю сессии (history, messages, контекст) — это ВНУТРЕННИЕ данные системы, пользователь их не видит и не вводит
- JSON-данные, массивы объектов, структуры данных — это НЕ пользовательские параметры

Типичные СУЩЕСТВЕННЫЕ параметры: тема/предмет анализа, период дат, целевая валюта, язык отчёта, формат вывода.
Обычно 1-4 параметра, не больше. Лучше меньше, но точнее.
Параметр должен быть ПРОСТЫМ значением, которое человек вводит в форму (строка, число, дата, URL).

Для каждой переменной определи:
- source: "user_input" — нужно спросить у пользователя ДО запуска (станет Input)
- source: "computed" — вычисляется в ходе работы (результат tool call или LLM)
- source: "constant" — фиксированная часть логики

Ответь JSON (без markdown-обёртки):
{
  "variables": [
    {
      "id": "snake_case_id",
      "title": "Человекочитаемое название",
      "description": "Что это за параметр",
      "type": "string | number | date | url | file_path | secret | boolean | enum | text",
      "source": "user_input | computed | constant",
      "value_in_session": "значение из текущей сессии",
      "enum_values": ["только", "для", "enum"]
    }
  ]
}`;

export function buildDistillStep2User(sessionId: string, cwd: string, history: any[], resultAnalysis: any): string {
  return `Session ID: ${sessionId}\nCWD: ${cwd}\n\nРезультат сессии:\n${JSON.stringify(resultAnalysis)}\n\nHistory JSON:\n${JSON.stringify(history)}`;
}

// ─── Distill Step 3: Build chain of prompts ───

export const DISTILL_STEP3_SYSTEM = `Ты создаёшь мини-приложение (chain of prompts) из истории сессии AI-агента.

Контекст: результат сессии и входные параметры уже определены (см. user message).

Задача: построить ЦЕПОЧКУ ПРОМПТОВ (chain), которая ВОСПРОИЗВОДИТ РАБОТУ оригинальной сессии:
- Каждый шаг — один сфокусированный промпт для AI-агента, который ВЫПОЛНЯЕТ конкретное действие
- Оркестратор (код, не LLM) последовательно выполняет шаги
- Результат каждого шага передаётся в следующий через {{steps.step_id.result}}
- Входные данные пользователя доступны через {{inputs.variable_id}}

ГЛАВНЫЙ ПРИНЦИП: цепочка должна ДЕЛАТЬ ТУ ЖЕ РАБОТУ, что делала оригинальная сессия.
Если оригинальная сессия скачивала данные с API, строила графики, создавала CSV — цепочка должна делать ТО ЖЕ САМОЕ.
Цепочка НЕ должна "описывать" или "перечислять" что было сделано — она должна ВЫПОЛНЯТЬ действия.

Правила построения цепочки:
1. Проанализируй историю и найди ОПТИМАЛЬНЫЙ путь к результату (убери отладочные/лишние шаги)
2. Каждый шаг должен быть СФОКУСИРОВАН на одной подзадаче
3. Промпт шага должен быть ПОЛНОЙ инструкцией (не "продолжи", а конкретное задание)
4. 3-7 шагов для типичной задачи
5. Для каждого шага укажи какие tools нужны

КРИТИЧЕСКИ ВАЖНО для prompt_template:
- Промпт каждого шага должен описывать КОНКРЕТНОЕ ДЕЙСТВИЕ: скачать данные с API, обработать таблицу, построить график и т.д.
- НЕ ссылайся на "историю сессии", "history_json", "контекст разговора" — агент при реплее НЕ будет иметь историю оригинальной сессии
- Агент получает ТОЛЬКО входные параметры ({{inputs.*}}) и результаты предыдущих шагов ({{steps.*.result}})
- Если в оригинальной сессии агент вызывал API — промпт должен сказать "Вызови API по URL..." а не "Проанализируй данные из сессии"
- Промпт должен быть САМОДОСТАТОЧНЫМ — содержать все URL, форматы, структуры данных, нужные для выполнения
- НЕ создавай шаги типа "опиши что было сделано" или "составь отчёт о блоках кода" — это мета-задачи, а не реальная работа

Также создай:
- validation: финальный промпт для проверки и доведения результата
- acceptance_criteria: критерии приёмки (из требований к результату)
- name, description, goal, icon для мини-приложения
- constraints: ограничения (если есть)

ВАЖНО для name, description, goal:
- НЕ включай конкретные значения параметров из сессии (даты, имена файлов, темы)
- Используй ОБЩИЕ формулировки. Пример: "Анализ новостного влияния на курсы валют" а НЕ "Анализ влияния новостей на USD/RUB и BTC/RUB за 90 дней"
- Параметры должны быть в inputs, а не в названии

Ответь JSON (без markdown-обёртки):
{
  "id": "slug-id",
  "name": "Название мини-приложения",
  "description": "Краткое описание",
  "icon": "эмодзи",
  "goal": "Цель задачи",
  "definition_of_done": "Критерии готовности",
  "constraints": ["ограничение1"],
  "chain": [
    {
      "id": "step_1",
      "title": "Название шага",
      "prompt_template": "Полная инструкция для агента. Входные данные: {{inputs.topic}}...",
      "tools": ["search_web", "read_file"],
      "output_key": "research"
    },
    {
      "id": "step_2",
      "title": "Название шага",
      "prompt_template": "На основе данных:\\n{{steps.step_1.result}}\\n\\nСоздай...",
      "tools": ["write_file"],
      "output_key": "draft"
    }
  ],
  "validation": {
    "acceptance_criteria": "Чёткие критерии приёмки результата",
    "prompt_template": "Цель задачи: ...\\nТребования: ...\\nТекущий результат:\\n{{steps.LAST_STEP.result}}\\n\\nПроверь результат по критериям. Если есть проблемы — исправь. Если всё ок — выведи финальный результат.",
    "tools": ["read_file", "write_file", "edit_file"],
    "max_fix_attempts": 3
  },
  "artifacts": [
    { "type": "file|text|link|table", "title": "Название файла/артефакта", "description": "Подробное описание содержимого, формата и структуры — будет использовано для сверки результата с эталоном" }
  ],
  "tools_required": ["search_web", "write_file"]
}`;

export function buildDistillStep3User(
  sessionId: string,
  cwd: string,
  history: any[],
  resultAnalysis: any,
  variablesAnalysis: any
): string {
  return `Session ID: ${sessionId}\nCWD: ${cwd}\n\nРезультат сессии:\n${JSON.stringify(resultAnalysis)}\n\nВходные параметры (variables):\n${JSON.stringify(variablesAnalysis)}\n\nHistory JSON:\n${JSON.stringify(history)}`;
}

// ─── Distill Step 4: Scriptify deterministic steps ───

export const DISTILL_STEP4_SYSTEM = `Ты оптимизируешь мини-приложение, заменяя детерминированные шаги Python-скриптами.

КОНТЕКСТ:
- Цепочка промптов (chain) уже построена.
- Тебе даны РЕАЛЬНЫЕ фрагменты кода, которые агент выполнял в оригинальной сессии (execute_python блоки).
- Твоя задача — взять этот РЕАЛЬНЫЙ код и превратить его в автономные Python-скрипты.

КРИТИЧЕСКИ ВАЖНО:
Скрипты должны ВОСПРОИЗВОДИТЬ ДЕЙСТВИЯ из оригинальной сессии:
- Если агент вызывал API (requests.get("https://...")) — скрипт должен вызывать тот же API
- Если агент делал pandas-трансформации — скрипт должен делать те же трансформации
- Если агент строил график matplotlib — скрипт должен строить такой же график
- Если агент парсил HTML/XML — скрипт должен парсить так же

НЕ ДЕЛАЙ:
- НЕ пиши скрипты, которые АНАЛИЗИРУЮТ историю сессии или JSON-данные сессии
- НЕ пиши скрипты, которые парсят STEP_*_RESULT как "историю" — это результат ПРЕДЫДУЩЕГО шага цепочки
- НЕ путай входные данные задачи (API URL, параметры) с метаданными сессии

Шаг МОЖНО заскриптовать если он:
- Скачивает данные по API (fetch URL, парсинг JSON/CSV/HTML)
- Выполняет математические/статистические вычисления
- Форматирует/трансформирует данные (merge, pivot, filter)
- Генерирует файлы по шаблону (CSV, JSON)
- Строит графики (matplotlib, plotly)

Шаг НЕЛЬЗЯ заскриптовать если он:
- Требует "творческого" анализа, написания текста, принятия решений
- Зависит от неструктурированного контекста
- Требует интерпретации результатов

ПРАВИЛА написания скриптов:
1. Бери РЕАЛЬНЫЙ код из execute_python блоков и адаптируй его:
   - Параметризуй жёстко зашитые значения через переменные окружения
   - INPUTS_<id> — пользовательские параметры (напр. INPUTS_topic, INPUTS_date_from)
   - STEP_<id>_RESULT — результат предыдущего скриптового шага (строка/JSON)
2. Скрипт должен быть ПОЛНЫМ и РАБОЧИМ (все импорты, все вычисления)
3. Результат — в stdout (print/sys.stdout.write)
4. Обработка ошибок: try/except с понятными сообщениями
5. Библиотеки: стандартные + requests, pandas, matplotlib, numpy, beautifulsoup4

Ответь JSON (без markdown-обёртки):
{
  "scripts": [
    {
      "step_id": "id шага из chain",
      "language": "python",
      "code": "полный Python-код скрипта",
      "reason": "почему этот шаг можно заскриптовать"
    }
  ],
  "kept_as_llm": [
    {
      "step_id": "id шага",
      "reason": "почему этот шаг нельзя заскриптовать"
    }
  ]
}`;

export function buildDistillStep4User(chain: any[], inputs: any[], history: any[]): string {
  // Extract actual execute_python code blocks from history so the LLM can
  // see what the agent REALLY did (not raw history JSON)
  const codeBlocks: { index: number; explanation?: string; code: string }[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m?.type === "tool_use" && m?.name === "execute_python" && m?.input?.code) {
      codeBlocks.push({
        index: i,
        explanation: m.input.explanation || undefined,
        code: m.input.code
      });
    }
  }

  let codeSection: string;
  if (codeBlocks.length > 0) {
    codeSection = codeBlocks.map((b, idx) => {
      const header = `--- Блок ${idx + 1}${b.explanation ? ` (${b.explanation})` : ""} ---`;
      return `${header}\n${b.code}`;
    }).join("\n\n");
  } else {
    codeSection = "(execute_python блоки не найдены в истории)";
  }

  return `Цепочка шагов (chain):\n${JSON.stringify(chain, null, 2)}\n\nВходные параметры:\n${JSON.stringify(inputs)}\n\nРЕАЛЬНЫЙ код, выполненный агентом в оригинальной сессии (execute_python блоки):\n${codeSection}`;
}

// ─── Assemble MiniWorkflow from distill step 3 output ───

export function assembleWorkflow(
  step3Output: any,
  variablesAnalysis: any,
  sessionId: string,
  cwd?: string,
  step4Output?: any
): MiniWorkflow {
  const now = new Date().toISOString();
  const userInputVars = (variablesAnalysis.variables || []).filter((v: any) => v.source === "user_input");

  const inputs = userInputVars.map((v: any) => ({
    id: v.id,
    title: v.title || v.id,
    description: v.description || "",
    type: v.type || "string",
    required: true,
    default: v.value_in_session,
    enum_values: v.enum_values,
    redaction: /(token|secret|key|password)/i.test(v.id)
  }));

  // Build scripts map from step 4
  const scriptsMap = new Map<string, { language: string; code: string }>();
  if (step4Output?.scripts) {
    for (const s of step4Output.scripts) {
      if (s.step_id && s.code) {
        scriptsMap.set(s.step_id, { language: s.language || "python", code: s.code });
      }
    }
  }

  const chain: ChainStep[] = (step3Output.chain || []).map((s: any) => {
    const script = scriptsMap.get(s.id);
    return {
      id: s.id,
      title: s.title || s.id,
      prompt_template: s.prompt_template || "",
      tools: Array.isArray(s.tools) ? s.tools : [],
      output_key: s.output_key || s.id,
      execution: script ? "script" as const : "llm" as const,
      ...(script ? { script: { language: script.language as "python" | "javascript", code: script.code } } : {})
    };
  });

  const validation: ValidationConfig = {
    acceptance_criteria: step3Output.validation?.acceptance_criteria || step3Output.definition_of_done || "",
    prompt_template: step3Output.validation?.prompt_template || "",
    tools: Array.isArray(step3Output.validation?.tools) ? step3Output.validation.tools : [],
    max_fix_attempts: step3Output.validation?.max_fix_attempts ?? 3
  };

  const toolsRequired = Array.from(new Set([
    ...chain.flatMap(s => s.tools),
    ...validation.tools,
    ...(step3Output.tools_required || [])
  ]));

  return {
    id: step3Output.id || slugify(step3Output.name || "workflow"),
    name: step3Output.name || "Mini-workflow",
    description: step3Output.description || "",
    icon: step3Output.icon || "🧩",
    version: "0.1.0",
    created_at: now,
    updated_at: now,
    source_session_id: sessionId,
    source_session_cwd: cwd,
    tags: ["distilled"],
    status: "draft",
    compatibility: {
      valedesk_min_version: "0.0.8",
      tools_required: toolsRequired,
      tools_optional: []
    },
    goal: step3Output.goal || "",
    definition_of_done: step3Output.definition_of_done || validation.acceptance_criteria,
    constraints: Array.isArray(step3Output.constraints) ? step3Output.constraints : [],
    inputs,
    chain,
    validation,
    artifacts: Array.isArray(step3Output.artifacts) ? step3Output.artifacts : [],
    safety: {
      permission_mode_on_replay: "ask",
      side_effects: [],
      network_policy: "allow_web_read"
    }
  };
}

// ─── Validation ───

export function validateWorkflow(workflow: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const VALID_INPUT_TYPES = ["string", "text", "number", "boolean", "enum", "date", "datetime", "file_path", "url", "secret"];
  const VALID_EXECUTION_TYPES = ["llm", "script"];
  const VALID_SCRIPT_LANGUAGES = ["python", "javascript"];

  // ─── Top-level required fields ───
  const required = ["id", "name", "version", "goal", "definition_of_done", "inputs", "chain", "validation", "artifacts", "safety"];
  for (const field of required) {
    if (!(field in workflow)) errors.push(`missing required field: ${field}`);
  }
  if (typeof workflow.id !== "string" || !workflow.id) errors.push("id must be non-empty string");
  if (typeof workflow.name !== "string" || !workflow.name) errors.push("name must be non-empty string");
  if (typeof workflow.goal !== "string") errors.push("goal must be string");
  if (typeof workflow.definition_of_done !== "string") errors.push("definition_of_done must be string");
  if (!Array.isArray(workflow.inputs)) errors.push("inputs must be array");
  if (!Array.isArray(workflow.chain)) errors.push("chain must be array");
  if (!Array.isArray(workflow.artifacts)) errors.push("artifacts must be array");
  if (!workflow.safety || typeof workflow.safety !== "object") errors.push("safety must be object");
  if (!workflow.validation || typeof workflow.validation !== "object") errors.push("validation must be object");

  // ─── Inputs validation ───
  const inputs = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  const inputIds = new Set<string>();
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i] as Record<string, unknown> | undefined;
    if (!inp || typeof inp !== "object") { errors.push(`inputs[${i}]: must be object`); continue; }
    if (typeof inp.id !== "string" || !inp.id) errors.push(`inputs[${i}]: id must be non-empty string`);
    else if (inputIds.has(inp.id)) errors.push(`inputs[${i}]: duplicate id "${inp.id}"`);
    else inputIds.add(inp.id);
    if (typeof inp.title !== "string") errors.push(`input "${inp.id}": title must be string`);
    if (typeof inp.type !== "string" || !VALID_INPUT_TYPES.includes(inp.type)) {
      errors.push(`input "${inp.id}": type must be one of: ${VALID_INPUT_TYPES.join(", ")}`);
    }
    if (inp.type === "enum" && (!Array.isArray(inp.enum_values) || inp.enum_values.length === 0)) {
      errors.push(`input "${inp.id}": enum type requires non-empty enum_values array`);
    }
  }

  // ─── Chain steps validation ───
  const chain = Array.isArray(workflow.chain) ? workflow.chain : [];
  if (chain.length === 0 && errors.length === 0) errors.push("chain must have at least one step");
  const stepIds = new Set<string>();
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i] as Record<string, unknown> | undefined;
    if (!step || typeof step !== "object") { errors.push(`chain[${i}]: must be object`); continue; }

    const stepId = String(step.id || `step_${i}`);
    if (typeof step.id !== "string" || !step.id) errors.push(`chain[${i}]: id must be non-empty string`);
    else if (stepIds.has(step.id)) errors.push(`chain[${i}]: duplicate step id "${step.id}"`);
    else stepIds.add(step.id);

    if (typeof step.title !== "string") errors.push(`step "${stepId}": title must be string`);
    if (typeof step.prompt_template !== "string") errors.push(`step "${stepId}": prompt_template must be string`);
    if (!Array.isArray(step.tools)) errors.push(`step "${stepId}": tools must be array`);
    if (typeof step.output_key !== "string") errors.push(`step "${stepId}": output_key must be string`);

    // execution type
    const execution = step.execution;
    if (typeof execution !== "string" || !VALID_EXECUTION_TYPES.includes(execution)) {
      errors.push(`step "${stepId}": execution must be one of: ${VALID_EXECUTION_TYPES.join(", ")}`);
    }

    // script validation for script steps
    if (execution === "script") {
      const script = step.script as Record<string, unknown> | undefined;
      if (!script || typeof script !== "object") {
        errors.push(`step "${stepId}": script step must have a script object`);
      } else {
        if (typeof script.language !== "string" || !VALID_SCRIPT_LANGUAGES.includes(script.language)) {
          errors.push(`step "${stepId}": script.language must be one of: ${VALID_SCRIPT_LANGUAGES.join(", ")}`);
        }
        if (typeof script.code !== "string" || !script.code.trim()) {
          errors.push(`step "${stepId}": script.code must be non-empty string`);
        }
      }
    }
  }

  // ─── Validation config ───
  const validation = workflow.validation as Record<string, unknown> | undefined;
  if (validation && typeof validation === "object") {
    if (typeof validation.acceptance_criteria !== "string") errors.push("validation.acceptance_criteria must be string");
    if (typeof validation.max_fix_attempts !== "number" || validation.max_fix_attempts < 0) {
      errors.push("validation.max_fix_attempts must be a non-negative number");
    }
  }

  // ─── Safety config ───
  const safety = workflow.safety as Record<string, unknown> | undefined;
  if (safety && typeof safety === "object") {
    if (!["ask", "auto"].includes(String(safety.permission_mode_on_replay))) errors.push("safety.permission_mode_on_replay must be 'ask' or 'auto'");
    if (!["offline", "allow_web_read", "allow_web_write"].includes(String(safety.network_policy))) errors.push("safety.network_policy must be 'offline', 'allow_web_read', or 'allow_web_write'");
    if (safety.side_effects !== undefined && !Array.isArray(safety.side_effects)) errors.push("safety.side_effects must be array");
  }

  return { valid: errors.length === 0, errors };
}

// ─── Replay prompt building ───

/** Get LLM-only chain steps (skip script steps which are pre-computed) */
export function getLlmSteps(workflow: MiniWorkflow): ChainStep[] {
  return workflow.chain.filter((s) => s.execution !== "script");
}

/** Build context object for template rendering with current step results */
function buildTemplateContext(
  inputs: Record<string, unknown>,
  stepResults: Record<string, string>
): { inputs: Record<string, unknown>; steps: Record<string, { result: string }> } {
  const steps: Record<string, { result: string }> = {};
  for (const [id, result] of Object.entries(stepResults)) {
    steps[id] = { result };
  }
  return { inputs, steps };
}

/** Build a prompt for a single chain step */
export function buildStepPrompt(
  workflow: MiniWorkflow,
  step: ChainStep,
  stepIndex: number,
  totalSteps: number,
  inputs: Record<string, unknown>,
  stepResults: Record<string, string>
): string {
  const secretFields = new Set(
    workflow.inputs.filter((i) => i.type === "secret" || i.redaction).map((i) => i.id)
  );

  const ctx = buildTemplateContext(inputs, stepResults);
  const expanded = renderTemplate(step.prompt_template, ctx);

  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  // First step: full context (goal, inputs, constraints)
  // Subsequent steps: only task + previous step results (compact)
  if (isFirstStep) {
    const inputLines = workflow.inputs.length > 0
      ? workflow.inputs.map((i) => {
          const val = inputs[i.id] ?? i.default ?? "";
          const display = secretFields.has(i.id) ? `{{secret::${i.id}}}` : String(val);
          return `- ${i.title}: ${display}`;
        }).join("\n")
      : "Входные данные не требуются.";

    const constraintsText = workflow.constraints.length > 0
      ? `\nОграничения:\n${workflow.constraints.map(c => `- ${c}`).join("\n")}\n`
      : "";

    return `Мини-приложение "${workflow.name}" — Шаг 1/${totalSteps}: ${step.title}

Цель: ${workflow.goal}
Входные данные:
${inputLines}
${constraintsText}
Задача:
${expanded}

Выполни ТОЛЬКО этот шаг.`;
  }

  // Subsequent steps: compact — task + previous results only
  const prevResults = Object.entries(stepResults).map(([id, result]) => {
    const prevStep = workflow.chain.find(s => s.id === id);
    const truncated = result.length > 2000 ? result.slice(0, 2000) + "\n...(truncated)" : result;
    return `### ${prevStep?.title || id}\n${truncated}`;
  }).join("\n\n");

  const validationBlock = isLastStep
    ? `\n\nКритерии готовности: ${workflow.definition_of_done || workflow.validation.acceptance_criteria || ""}
Если результат не проходит критерии — исправь (до ${workflow.validation.max_fix_attempts} попыток).`
    : "";

  return `Мини-приложение "${workflow.name}" — Шаг ${stepIndex + 1}/${totalSteps}: ${step.title}

Результаты предыдущих шагов:
${prevResults}

Задача:
${expanded}${validationBlock}

Выполни ТОЛЬКО этот шаг.`;
}

/** Build a single combined prompt (legacy fallback for single-step workflows) */
export function buildReplayPrompt(workflow: MiniWorkflow, inputs: Record<string, unknown>): { prompt: string; redactedInputs: Record<string, unknown> } {
  const secretFields = new Set(
    workflow.inputs.filter((i) => i.type === "secret" || i.redaction).map((i) => i.id)
  );

  const inputLines = workflow.inputs.length > 0
    ? workflow.inputs.map((i) => {
        const val = inputs[i.id] ?? i.default ?? "";
        const display = secretFields.has(i.id) ? `{{secret::${i.id}}}` : String(val);
        return `- ${i.title}: ${display}`;
      }).join("\n")
    : "Входные данные не требуются.";

  const templateContext = buildTemplateContext(inputs, {});

  const chainLines = workflow.chain
    .filter((s) => s.execution !== "script")
    .map((s, idx) => {
      const expanded = renderTemplate(s.prompt_template, templateContext);
      return `### Шаг ${idx + 1}: ${s.title}\n${expanded}`;
    }).join("\n\n");

  const constraintsText = workflow.constraints.length > 0
    ? workflow.constraints.map(c => `- ${c}`).join("\n")
    : "Нет дополнительных ограничений.";

  const dodText = workflow.definition_of_done && workflow.validation.acceptance_criteria
    && workflow.definition_of_done !== workflow.validation.acceptance_criteria
    ? `${workflow.definition_of_done}\n${workflow.validation.acceptance_criteria}`
    : workflow.validation.acceptance_criteria || workflow.definition_of_done || "";

  const prompt = `Выполни мини-приложение "${workflow.name}".

Цель: ${workflow.goal}
Входные данные:
${inputLines}
${workflow.constraints.length > 0 ? `\nОграничения:\n${constraintsText}\n` : ""}
Пошаговый план:

${chainLines}

Критерии готовности: ${dodText}

Валидация (до ${workflow.validation.max_fix_attempts} попыток):
1. Проверь результат по критериям готовности
2. Если результат не проходит критерии — исправь и повтори проверку`;

  return {
    prompt,
    redactedInputs: redactSecrets(inputs, secretFields)
  };
}

// ─── SKILL.md generation ───

export async function generateSkillMarkdown(workflow: MiniWorkflow): Promise<string> {
  const tools = workflow.compatibility.tools_required.map((t) => `"${t}"`).join(", ");
  const inputsYaml = workflow.inputs
    .map((i) => `  - id: ${i.id}\n    title: "${i.title.replace(/"/g, '\\"')}"\n    type: ${i.type}\n    required: ${i.required ? "true" : "false"}`)
    .join("\n");

  const chainMd = workflow.chain
    .map((s, idx) => `${idx + 1}. **${s.title}**\n   Tools: ${s.tools.join(", ") || "none"}`)
    .join("\n");

  const inputsMd = workflow.inputs.length > 0
    ? workflow.inputs.map((i) => `- \`${i.id}\` (${i.type})${i.required ? " [required]" : ""} — ${i.description || i.title}`).join("\n")
    : "- Нет входных параметров.";

  const constraintsMd = workflow.constraints.length > 0
    ? workflow.constraints.map((c) => `- ${c}`).join("\n")
    : "- Нет дополнительных ограничений.";

  return `---
name: ${workflow.name}
description: ${workflow.description}
type: mini-workflow
icon: ${workflow.icon}
allowed-tools: [${tools}]
inputs:
${inputsYaml || "  []"}
workflow-file: workflow.json
---

# ${workflow.name}

## Цель
${workflow.goal}

## Входные данные
${inputsMd}

## Цепочка шагов
${chainMd}

## Ограничения
${constraintsMd}

## Критерии готовности
${workflow.definition_of_done || workflow.validation.acceptance_criteria}
`;
}

// ─── Store: save / load / list / delete ───

export async function saveNewVersion(workflow: MiniWorkflow, options?: { baseDir?: string }): Promise<{ versionFolder: string; totalVersions: number }> {
  const { skillsDir, workflowsDir } = baseDirs(options?.baseDir);
  const workflowDir = join(skillsDir, workflow.id);
  const versionsDir = join(workflowsDir, workflow.id, "versions");
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.mkdir(versionsDir, { recursive: true });

  const skillMd = await generateSkillMarkdown(workflow);
  await fs.writeFile(join(workflowDir, "workflow.json"), JSON.stringify(workflow, null, 2), "utf8");
  await fs.writeFile(join(workflowDir, "SKILL.md"), skillMd, "utf8");

  const entries = await fs.readdir(versionsDir, { withFileTypes: true }).catch(() => []);
  const nums = entries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => Number(e.name.slice(1)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const next = (nums[nums.length - 1] ?? 0) + 1;
  const folder = join(versionsDir, `v${next}`);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(join(folder, "workflow.json"), JSON.stringify(workflow, null, 2), "utf8");
  await fs.writeFile(join(folder, "SKILL.md"), skillMd, "utf8");

  const nowEntries = await fs.readdir(versionsDir, { withFileTypes: true });
  const nowNums = nowEntries
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => Number(e.name.slice(1)))
    .sort((a, b) => a - b);
  while (nowNums.length > 5) {
    const oldest = nowNums.shift();
    if (oldest !== undefined) await fs.rm(join(versionsDir, `v${oldest}`), { recursive: true, force: true });
  }
  return { versionFolder: `v${next}`, totalVersions: Math.min(nowNums.length, 5) };
}

export class MiniWorkflowStore {
  private async listOneRoot(options?: { baseDir?: string }): Promise<MiniWorkflowSummary[]> {
    const { skillsDir } = baseDirs(options?.baseDir);
    await fs.mkdir(skillsDir, { recursive: true });
    const dirs = await fs.readdir(skillsDir, { withFileTypes: true });
    const result: MiniWorkflowSummary[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const wfPath = join(skillsDir, dir.name, "workflow.json");
      try {
        const raw = await fs.readFile(wfPath, "utf8");
        const wf = JSON.parse(raw) as MiniWorkflow;
        if (wf.status === "archived") continue;
        result.push({
          id: wf.id,
          name: wf.name,
          description: wf.description,
          icon: wf.icon,
          version: wf.version,
          status: wf.status,
          tags: wf.tags,
          inputs_count: wf.inputs.length,
          updated_at: wf.updated_at
        });
      } catch {
        // ignore invalid entries
      }
    }
    return result.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async list(options?: { baseDir?: string; projectCwd?: string; includeProject?: boolean }): Promise<MiniWorkflowSummary[]> {
    const globalItems = await this.listOneRoot({ baseDir: options?.baseDir });
    if (!options?.includeProject || !options.projectCwd) return globalItems;
    const projectItems = await this.listOneRoot({ baseDir: options.projectCwd });
    return dedupeById([...projectItems, ...globalItems]);
  }

  async load(workflowId: string, options?: { baseDir?: string; projectCwd?: string; preferProject?: boolean }): Promise<MiniWorkflow | null> {
    if (options?.preferProject && options.projectCwd) {
      const local = await this.load(workflowId, { baseDir: options.projectCwd });
      if (local) return local;
    }
    const { skillsDir } = baseDirs(options?.baseDir);
    const wfPath = join(skillsDir, workflowId, "workflow.json");
    try {
      const raw = await fs.readFile(wfPath, "utf8");
      return JSON.parse(raw) as MiniWorkflow;
    } catch {
      return null;
    }
  }

  async save(workflow: MiniWorkflow, options?: { baseDir?: string; projectCwd?: string; scope?: "global" | "project" }): Promise<MiniWorkflow> {
    const targetBaseDir = options?.scope === "project" && options.projectCwd ? options.projectCwd : options?.baseDir;
    const current = await this.load(workflow.id, { baseDir: targetBaseDir });
    const patch = current ? parsePatch(current.version) : -1;
    const incomingPatch = parsePatch(workflow.version);
    const version = incomingPatch <= patch ? nextPatch(current?.version ?? "0.1.0") : workflow.version;
    const now = new Date().toISOString();
    const toSave: MiniWorkflow = {
      ...workflow,
      version,
      created_at: current?.created_at ?? workflow.created_at ?? now,
      updated_at: now
    };
    await saveNewVersion(toSave, { baseDir: targetBaseDir });
    return toSave;
  }

  async delete(workflowId: string, options?: { baseDir?: string; projectCwd?: string; scope?: "global" | "project" | "both" }): Promise<void> {
    if (options?.scope === "both" && options.projectCwd) {
      await this.delete(workflowId, { baseDir: options.baseDir, scope: "global" });
      await this.delete(workflowId, { baseDir: options.projectCwd, scope: "project" });
      return;
    }
    const targetBaseDir =
      options?.scope === "project" && options.projectCwd
        ? options.projectCwd
        : options?.baseDir;
    const { skillsDir, workflowsDir } = baseDirs(targetBaseDir);
    await fs.rm(join(skillsDir, workflowId), { recursive: true, force: true });
    await fs.rm(join(workflowsDir, workflowId), { recursive: true, force: true });
  }
}

// ─── Replay log ───

export async function writeReplayLog(workflow: MiniWorkflow, payload: { inputs: Record<string, unknown>; final_status: "success" | "partial" | "failed" | "aborted"; step_results?: Array<{ step_id: string; status: string; duration_ms?: number }> }, options?: { baseDir?: string }): Promise<void> {
  const base = options?.baseDir ?? homedir();
  const runId = randomUUID();
  const runDir = join(base, ".valera", "workflows", workflow.id, "runs");
  try {
    await fs.mkdir(runDir, { recursive: true });
    const secretFields = new Set(workflow.inputs.filter((i) => i.type === "secret" || i.redaction).map((i) => i.id));
    const content = {
      run_id: runId,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      inputs: redactSecrets(payload.inputs, secretFields),
      step_results: payload.step_results || [],
      final_status: payload.final_status
    };
    await fs.writeFile(join(runDir, `${runId}.json`), JSON.stringify(content, null, 2), "utf8");
  } catch {
    // Non-blocking by spec
  }
}
