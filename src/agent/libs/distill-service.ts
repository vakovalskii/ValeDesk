/**
 * Distillation service — LLM calls, test-run, verification, and refinement
 * for the MiniWorkflow distillation pipeline.
 *
 * Extracted from ipc-handlers.ts to keep IPC routing thin.
 */

import OpenAI from "openai";
import { join } from "path";
import { promises as fs } from "fs";
import { loadApiSettings } from "./settings-store.js";
import { loadLLMProviderSettings } from "./llm-providers-store.js";
import {
  buildConciseHistory,
  formatChatLog,
  assembleWorkflow,
  getMiniWorkflowSchemaPrompt,
  validateWorkflow,
  DISTILL_STEP1_SYSTEM,
  DISTILL_STEP2_SYSTEM,
  DISTILL_STEP3_SYSTEM,
  DISTILL_STEP4_SYSTEM,
  buildDistillStep1User,
  buildDistillStep4User,
} from "./mini-workflow.js";

// ─── Types ───

export interface TestRunResult {
  scriptOutputs: Record<string, string>;
  scriptErrors: Record<string, string>;
  filesCreated: string[];
}

export interface DistillDebugEntry {
  step: string;
  timestamp: string;
  system: string;
  user: string;
  response: string;
  parsed: any;
  usage: { input_tokens: number; output_tokens: number };
}

export type DistillDebugLog = DistillDebugEntry[];

export type DistillUsage = { input_tokens: number; output_tokens: number };

export type DistillChainResult =
  | { status: "success"; workflow: any; usage: DistillUsage; debugLog: DistillDebugLog }
  | { status: "not_suitable"; reason: string; usage: DistillUsage; debugLog: DistillDebugLog };

export type DistillProgressCallback = (step: number, totalSteps: number, label: string, usage: DistillUsage) => void;

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export interface ReplayResult {
  stepResults: Record<string, string>;   // all step outputs (scripts + LLM)
  scriptErrors: Record<string, string>;  // errors from script steps only
  filesCreated: string[];                // files in workspace after replay
  inputs?: Record<string, unknown>;      // actual inputs used for this replay
}

export interface VerifyResult {
  match: boolean;
  summary: string;
  discrepancies: string[];
  suggestions: string[];
  usage: { input_tokens: number; output_tokens: number };
}

// ─── Helpers ───

export function extractJsonObject(raw: string): string | null {
  const fenced = Array.from(raw.matchAll(/```json\s*([\s\S]*?)```/gi)).map((m) => m[1]?.trim()).filter(Boolean) as string[];
  for (const candidate of fenced) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

export function getLlmConnection(model?: string): { client: OpenAI; modelName: string } {
  const isProviderModel = model?.includes("::");
  if (isProviderModel && model) {
    const [providerId, modelId] = model.split("::");
    const llmSettings = loadLLMProviderSettings();
    const provider = llmSettings?.providers.find((p) => p.id === providerId && p.enabled);
    if (!provider) throw new Error(`Provider not found: ${providerId}`);
    let baseURL = provider.baseUrl || "";
    if (provider.type === "openrouter") baseURL = "https://openrouter.ai/api/v1";
    else if (provider.type === "zai") {
      const prefix = provider.zaiApiPrefix === "coding" ? "api/coding/paas" : "api/paas";
      baseURL = `https://api.z.ai/${prefix}/v4`;
    }
    return {
      client: new OpenAI({ apiKey: provider.apiKey, baseURL, dangerouslyAllowBrowser: false }),
      modelName: modelId
    };
  }
  const settings = loadApiSettings();
  if (!settings?.apiKey || !settings?.baseUrl || !(model || settings.model)) {
    throw new Error("LLM settings are not configured");
  }
  return {
    client: new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl, dangerouslyAllowBrowser: false }),
    modelName: model || settings.model
  };
}

// ─── Redaction ───

/** Mask API keys, tokens, and secrets in debug log text */
function redactSecretsInDebugLog(text: string): string {
  return text
    .replace(/\b(sk-[a-zA-Z0-9_-]{10,})\b/g, "sk-***REDACTED***")
    .replace(/\b(tvly-[a-zA-Z0-9_-]{10,})\b/g, "tvly-***REDACTED***")
    .replace(/(Bearer\s+)[a-zA-Z0-9_\-.]+/gi, "$1***REDACTED***")
    .replace(/(api[_-]?key|apikey|token|secret|password|credential|auth)["\s:=]+["']?[a-zA-Z0-9_\-./]{8,}["']?/gi, "$1=***REDACTED***")
    .replace(/\b[a-zA-Z0-9_-]{32,}\b/g, (match) => {
      if (/[a-z]/.test(match) && /[A-Z]/.test(match) && /[0-9]/.test(match) && match.length >= 40) {
        return "***REDACTED_KEY***";
      }
      return match;
    });
}

export function redactDebugLog(log: DistillDebugLog): DistillDebugLog {
  return log.map(entry => ({
    ...entry,
    system: redactSecretsInDebugLog(entry.system),
    user: redactSecretsInDebugLog(entry.user),
    response: redactSecretsInDebugLog(entry.response),
    parsed: JSON.parse(redactSecretsInDebugLog(JSON.stringify(entry.parsed)))
  }));
}

// ─── LLM Call wrappers ───

export async function llmCall(
  client: OpenAI, modelName: string, system: string, user: string,
  debugLog?: DistillDebugLog, debugStep?: string, signal?: AbortSignal
): Promise<{ data: any; usage: { input_tokens: number; output_tokens: number } }> {
  const response = await client.chat.completions.create({
    model: modelName,
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  }, { signal });
  const text = response.choices?.[0]?.message?.content || "";
  const jsonRaw = extractJsonObject(text);
  if (!jsonRaw) throw new Error("LLM returned non-JSON response");
  const usage = {
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0
  };
  const parsed = JSON.parse(jsonRaw);
  if (debugLog) {
    debugLog.push({
      step: debugStep || "unknown",
      timestamp: new Date().toISOString(),
      system, user, response: text, parsed, usage
    });
  }
  return { data: parsed, usage };
}

export async function llmCallMultiTurn(
  client: OpenAI,
  modelName: string,
  messages: ChatMsg[],
  debugLog?: DistillDebugLog, debugStep?: string, signal?: AbortSignal
): Promise<{ data: any; usage: { input_tokens: number; output_tokens: number }; assistantMessage: string }> {
  const response = await client.chat.completions.create({
    model: modelName,
    temperature: 0.1,
    messages
  }, { signal });
  const text = response.choices?.[0]?.message?.content || "";
  const jsonRaw = extractJsonObject(text);
  if (!jsonRaw) throw new Error("LLM returned non-JSON response");
  const usage = {
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0
  };
  const parsed = JSON.parse(jsonRaw);
  if (debugLog) {
    debugLog.push({
      step: debugStep || "unknown",
      timestamp: new Date().toISOString(),
      system: messages.find(m => m.role === "system")?.content || "",
      user: messages.filter(m => m.role === "user").pop()?.content || "",
      response: text, parsed, usage
    });
  }
  return { data: parsed, usage, assistantMessage: text };
}

// ─── Test-run scripts ───

/** Run only script steps of a workflow in a temp workspace and return outputs */
export async function testRunScripts(workflow: any, workspaceDir: string): Promise<TestRunResult> {
  await fs.mkdir(workspaceDir, { recursive: true });

  const scriptSteps = (workflow.chain || []).filter((s: any) => s.execution === "script" && s.script?.code);
  const scriptOutputs: Record<string, string> = {};
  const scriptErrors: Record<string, string> = {};

  if (scriptSteps.length === 0) return { scriptOutputs, scriptErrors, filesCreated: [] };

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  // Build default inputs from workflow
  const inputs: Record<string, string> = {};
  for (const inp of workflow.inputs || []) {
    inputs[inp.id] = String(inp.default ?? "");
  }

  for (const step of scriptSteps) {
    try {
      const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "SYSTEMROOT", "COMSPEC", "SHELL", "PYTHONPATH", "PYTHONHOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "WINDIR"]);
      const SECRET_PATTERNS = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIAL|_AUTH)$|^(OPENAI|ANTHROPIC|TAVILY|ZAI|AWS_|AZURE_|GOOGLE_|GITHUB_TOKEN|NPM_TOKEN|CODEX_)/i;
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v == null || SECRET_PATTERNS.test(k)) continue;
        if (SAFE_ENV_KEYS.has(k)) env[k] = v;
      }
      for (const [k, v] of Object.entries(inputs)) env[`INPUTS_${k.toUpperCase()}`] = v;
      for (const [k, v] of Object.entries(scriptOutputs)) env[`STEP_${k.toUpperCase()}_RESULT`] = v;
      env["WORKSPACE"] = workspaceDir;

      const scriptFile = join(workspaceDir, `${step.id}.py`);
      await fs.writeFile(scriptFile, step.script.code, "utf8");

      const { stdout } = await execFileAsync("python", [scriptFile], {
        cwd: workspaceDir,
        env,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024
      });
      scriptOutputs[step.id] = (stdout || "").trim();
    } catch (err: any) {
      scriptErrors[step.id] = err.message || String(err);
      scriptOutputs[step.id] = `[ERROR: ${err.message}]`;
    }
  }

  // List files created in workspace
  let filesCreated: string[] = [];
  try {
    const entries = await fs.readdir(workspaceDir);
    filesCreated = entries.filter(f => !f.endsWith(".py")); // exclude script files
  } catch { /* ignore */ }

  return { scriptOutputs, scriptErrors, filesCreated };
}

// ─── Verification ───

/** Build the verification prompt for the agent-based verifier */
export function buildVerificationPrompt(workflow: any, replayResult: ReplayResult): string {
  const sourceResult = workflow.source_result;
  const hasErrors = Object.keys(replayResult.scriptErrors).length > 0;
  const replayInputs = replayResult.inputs || {};
  const MAX_VERIFY_STEP_RESULT_CHARS = 12_000;
  const stepResultsText = Object.entries(replayResult.stepResults)
    .map(([id, out]) => {
      const rendered = out.length > MAX_VERIFY_STEP_RESULT_CHARS
        ? `${out.slice(0, MAX_VERIFY_STEP_RESULT_CHARS)}\n...(truncated for verifier context)`
        : out;
      return `### ${id}\n${rendered}`;
    })
    .join("\n\n");

  return `Ты агент-ревьювер. Сравни результат полного прогона мини-приложения с ожидаемым результатом.

Ожидаемый результат (из оригинальной сессии):
- Описание: ${sourceResult.description}
- Тип: ${sourceResult.type}
- Артефакты: ${(sourceResult.artifacts || []).join(", ") || "не указаны"}
${sourceResult.requirements ? `- Требования: ${sourceResult.requirements}` : ""}

Критерии приёмки: ${workflow.validation?.acceptance_criteria || workflow.definition_of_done || "не заданы"}

Параметры текущего запуска:
${Object.keys(replayInputs).length > 0
    ? Object.entries(replayInputs).map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n")
    : "не переданы"}

Результат полного прогона:

Ошибки скриптов: ${hasErrors ? JSON.stringify(replayResult.scriptErrors) : "нет"}

Результаты всех шагов:
${stepResultsText}

Файлы в workspace: ${replayResult.filesCreated.join(", ") || "нет файлов"}

ИНСТРУКЦИИ:
0. Результаты шагов выше могут быть КРАТКИМИ манифестами; полные артефакты ищи в workspace, особенно в папках с сохранёнными step outputs.
1. Используй инструменты чтобы РЕАЛЬНО проверить артефакты: прочитай CSV файлы (read_file), посмотри PNG/изображения (attach_image), проверь содержимое.
2. Не пиши "невозможно проверить по логу" — ты МОЖЕШЬ прочитать файлы и посмотреть картинки.
3. Все файлы находятся в текущей рабочей директории.

После проверки ответь ТОЛЬКО JSON (без markdown-обёртки):
{
  "match": true | false,
  "summary": "краткое описание фактического результата",
  "discrepancies": ["конкретное расхождение с указанием какой шаг/скрипт нужно исправить"],
  "suggestions": ["конкретная рекомендация: что изменить в каком шаге/скрипте"]
}`;
}

/** Ask LLM to verify replay result against expected source_result (simple text-only, no tools) */
export async function verifyTestRun(
  client: OpenAI,
  modelName: string,
  workflow: any,
  replayResult: ReplayResult,
  debugLog?: DistillDebugLog, debugStep?: string, signal?: AbortSignal
): Promise<VerifyResult> {
  const prompt = buildVerificationPrompt(workflow, replayResult);
  const result = await llmCall(client, modelName, "Ответь JSON.", prompt, debugLog, debugStep, signal);
  return {
    match: Boolean(result.data.match),
    summary: String(result.data.summary || ""),
    discrepancies: Array.isArray(result.data.discrepancies) ? result.data.discrepancies.map(String) : [],
    suggestions: Array.isArray(result.data.suggestions) ? result.data.suggestions.map(String) : [],
    usage: result.usage
  };
}

// ─── Refinement ───

/** Build the refinement prompt for fixing workflow based on verification feedback */
export function buildRefinePrompt(
  workflow: any,
  verification: { discrepancies: string[]; suggestions: string[] },
  schemaRef: string
): string {
  // Strip heavy fields not needed for refinement (source_context is the full session history)
  const { source_context: _sc, ...workflowForRefine } = workflow;
  return `Ты редактор MiniWorkflow. Агент-ревьювер обнаружил расхождения при тестовом прогоне.

${schemaRef}

Текущий workflow (JSON):
\`\`\`json
${JSON.stringify(workflowForRefine, null, 2)}
\`\`\`

Расхождения:
${verification.discrepancies.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Рекомендации:
${verification.suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Исправь workflow так, чтобы тестовый прогон давал результат, соответствующий ожиданиям.

Ответь JSON (без markdown-обёртки):
{
  "message": "что исправлено",
  "workflow": { ...исправленный workflow целиком }
}`;
}

/** Ask LLM to fix workflow based on verification feedback (simple llmCall fallback) */
export async function refineWorkflowFromFeedback(
  client: OpenAI,
  modelName: string,
  workflow: any,
  verification: { discrepancies: string[]; suggestions: string[] },
  schemaRef: string,
  debugLog?: DistillDebugLog, debugStep?: string, signal?: AbortSignal
): Promise<any> {
  const prompt = buildRefinePrompt(workflow, verification, schemaRef);
  const result = await llmCall(client, modelName, "Ответь JSON.", prompt, debugLog, debugStep, signal);
  return { ...result.data, usage: result.usage };
}

// ─── Distillation chain ───

export async function distillChain(
  input: { sessionId: string; cwd?: string; history: any[]; model?: string; previousErrors?: string[] },
  onProgress?: DistillProgressCallback,
  signal?: AbortSignal
): Promise<DistillChainResult> {
  const { client, modelName } = getLlmConnection(input.model);
  const conciseHistory = buildConciseHistory(input.history as any);
  const totalUsage: DistillUsage = { input_tokens: 0, output_tokens: 0 };
  const debugLog: DistillDebugLog = [];

  const addUsage = (u: DistillUsage) => {
    totalUsage.input_tokens += u.input_tokens;
    totalUsage.output_tokens += u.output_tokens;
  };

  // If retrying after validation errors, prepend context
  const retryContext = input.previousErrors?.length
    ? `\n\nВНИМАНИЕ: предыдущая попытка дистилляции завершилась ошибками валидации. Исправь их:\n${input.previousErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n`
    : "";

  const TOTAL_STEPS = 5; // 4 LLM steps + assembly

  // Step 1: Identify result (needs full history)
  onProgress?.(1, TOTAL_STEPS, "Определяю результат сессии...", totalUsage);
  console.log("[Distill] Step 1: Identifying session result...");
  const step1r = await llmCall(
    client, modelName,
    DISTILL_STEP1_SYSTEM,
    buildDistillStep1User(input.sessionId, input.cwd || "", conciseHistory) + retryContext,
    debugLog, "step1_identify_result", signal
  );
  addUsage(step1r.usage);
  const step1 = step1r.data;
  console.log("[Distill] Step 1 result:", JSON.stringify(step1).slice(0, 500));

  if (!step1.result_clear) {
    return { status: "not_suitable", reason: step1.reason || "Результат сессии не определён однозначно.", usage: totalUsage, debugLog };
  }

  // Step 2: Extract variables (needs only step 1 result, no full history)
  onProgress?.(2, TOTAL_STEPS, "Извлекаю переменные...", totalUsage);
  console.log("[Distill] Step 2: Extracting variables...");
  const step2r = await llmCall(
    client, modelName,
    DISTILL_STEP2_SYSTEM,
    `Результат сессии:\n${JSON.stringify(step1)}`,
    debugLog, "step2_extract_variables", signal
  );
  addUsage(step2r.usage);
  const step2 = step2r.data;
  console.log("[Distill] Step 2 result:", JSON.stringify(step2).slice(0, 500));

  // Step 3: Build chain (needs full history for URLs/APIs/code, but as independent call)
  onProgress?.(3, TOTAL_STEPS, "Строю цепочку промптов...", totalUsage);
  console.log("[Distill] Step 3: Building prompt chain...");
  const step3r = await llmCall(
    client, modelName,
    DISTILL_STEP3_SYSTEM,
    `Результат сессии:\n${JSON.stringify(step1)}\n\nВходные параметры (variables):\n${JSON.stringify(step2)}\n\nHistory JSON:\n${JSON.stringify(conciseHistory)}`,
    debugLog, "step3_build_chain", signal
  );
  addUsage(step3r.usage);
  const step3 = step3r.data;
  console.log("[Distill] Step 3 result:", JSON.stringify(step3).slice(0, 500));

  // Step 4: Scriptify deterministic steps
  onProgress?.(4, TOTAL_STEPS, "Оптимизирую шаги (скриптификация)...", totalUsage);
  console.log("[Distill] Step 4: Scriptifying deterministic steps...");
  let step4: any = null;
  try {
    const step4r = await llmCall(
      client, modelName,
      DISTILL_STEP4_SYSTEM,
      buildDistillStep4User(step3.chain || [], step2.variables || [], conciseHistory),
      debugLog, "step4_scriptify", signal
    );
    addUsage(step4r.usage);
    step4 = step4r.data;
    const scriptCount = step4?.scripts?.length || 0;
    const llmCount = step4?.kept_as_llm?.length || 0;
    console.log(`[Distill] Step 4 result: ${scriptCount} scripted, ${llmCount} kept as LLM`);
  } catch (err) {
    console.warn("[Distill] Step 4 (scriptify) failed, all steps will use LLM:", err);
  }

  // Assemble final workflow
  onProgress?.(5, TOTAL_STEPS, "Собираю workflow...", totalUsage);
  console.log("[Distill] Assembling workflow...");
  const sourceContext = formatChatLog(conciseHistory);
  const workflow = assembleWorkflow(step3, step2, {
    sessionId: input.sessionId,
    cwd: input.cwd,
    step4Output: step4,
    sourceContext,
    sourceModel: input.model || modelName,
    step1Output: step1,
  });
  console.log(`[Distill] Workflow assembled: ${workflow.id} ${workflow.name} | Tokens: ${totalUsage.input_tokens} in / ${totalUsage.output_tokens} out`);
  return { status: "success", workflow, usage: totalUsage, debugLog };
}

export { validateWorkflow, getMiniWorkflowSchemaPrompt };
