import { useState, useRef, useEffect, useCallback } from "react";
import type { MiniWorkflow, ChainStep } from "../../shared/mini-workflow-types";
import { detectPermissions } from "../types";
import MDContent from "../render/markdown";
import { getPlatform } from "../platform";

type ReplayVerification = {
  match: boolean;
  summary: string;
  discrepancies: string[];
  suggestions: string[];
};

type DistillPanelProps = {
  distillLoading: boolean;
  distillWorkflow: MiniWorkflow | null;
  distillError: string | null;
  distillQuestions: string[];
  distillUsage: { input_tokens: number; output_tokens: number } | null;
  distillProgress: { step: number; totalSteps: number; label: string } | null;
  activeSessionId: string | null;
  activeSessionCwd?: string;
  onClose: () => void;
  onSave: (workflow: MiniWorkflow, status: "published" | "draft") => void;
  onRetry: (validationErrors: string[]) => void;
  onSetWorkflow: (wf: MiniWorkflow) => void;
  sendEvent: (event: any) => void;
  replayVerification?: ReplayVerification | null;
  replayArtifacts?: { filesCreated: string[]; stepResults: Record<string, string>; workspaceDir?: string } | null;
  verifyCycles?: { used: number; max: number } | null;
  debugLogPath?: string | null;
};

// ─── Left panel: editable chain steps ───

function StepsPanel({
  workflow,
  onUpdate,
}: {
  workflow: MiniWorkflow;
  onUpdate: (wf: MiniWorkflow) => void;
}) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);

  const systemPrompt = `Цель: ${workflow.goal}\nDefinition of done: ${workflow.definition_of_done || ""}${
    workflow.constraints.length > 0 ? "\nОграничения:\n" + workflow.constraints.map(c => `- ${c}`).join("\n") : ""
  }`;

  const updateStep = (index: number, patch: Partial<ChainStep>) => {
    const chain = [...workflow.chain];
    chain[index] = { ...chain[index], ...patch };
    onUpdate({ ...workflow, chain });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs font-semibold text-ink-700 px-3 pt-3 pb-2">
        Шаги ({workflow.chain.length})
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {/* Step 0: System context */}
        <div className="rounded-lg border border-ink-900/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedStep(expandedStep === "__system" ? null : "__system")}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-tertiary transition-colors"
          >
            <span className="text-[10px] font-bold text-ink-400 w-5 text-center">0</span>
            <span className="text-xs font-medium text-ink-700 flex-1 truncate">Системный контекст</span>
            <svg className={`w-3 h-3 text-ink-400 transition-transform ${expandedStep === "__system" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedStep === "__system" && (
            <div className="px-2.5 pb-2.5 border-t border-ink-900/5">
              <textarea
                className="mt-2 w-full rounded border border-ink-900/10 px-2 py-1.5 text-xs font-mono resize-y min-h-[80px]"
                value={systemPrompt}
                readOnly
              />
              <div className="mt-1 text-[10px] text-muted">Системный контекст (read-only, меняется через Goal/Constraints)</div>
            </div>
          )}
        </div>

        {/* Chain steps */}
        {workflow.chain.map((step, i) => (
          <div key={step.id} className="rounded-lg border border-ink-900/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-tertiary transition-colors"
            >
              <span className="text-[10px] font-bold text-ink-400 w-5 text-center">{i + 1}</span>
              <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                step.execution === "script" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
              }`}>
                {step.execution === "script" ? "script" : "LLM"}
              </span>
              <span className="text-xs font-medium text-ink-700 flex-1 truncate">{step.title}</span>
              <svg className={`w-3 h-3 text-ink-400 transition-transform ${expandedStep === step.id ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedStep === step.id && (
              <div className="px-2.5 pb-2.5 border-t border-ink-900/5 space-y-2">
                <label className="block mt-2">
                  <span className="text-[10px] text-ink-500">Title</span>
                  <input
                    className="w-full rounded border border-ink-900/10 px-2 py-1 text-xs"
                    value={step.title}
                    onChange={(e) => updateStep(i, { title: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-ink-500">Prompt template</span>
                  <textarea
                    className="w-full rounded border border-ink-900/10 px-2 py-1.5 text-xs font-mono resize-y min-h-[100px]"
                    value={step.prompt_template}
                    onChange={(e) => updateStep(i, { prompt_template: e.target.value })}
                  />
                </label>
                {step.execution === "script" && step.script && (
                  <label className="block">
                    <span className="text-[10px] text-ink-500">Script ({step.script.language})</span>
                    <textarea
                      className="w-full rounded border border-ink-900/10 px-2 py-1.5 text-xs font-mono resize-y min-h-[80px]"
                      value={step.script.code}
                      onChange={(e) => updateStep(i, { script: { ...step.script!, code: e.target.value } })}
                    />
                  </label>
                )}
                <div className="text-[10px] text-muted">
                  Tools: {(step.tools || []).join(", ") || "none"} · Output: {step.output_key}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Session result (verification) */}
        {workflow.source_result && (
          <div className="rounded-lg border border-accent/20 bg-accent/5 p-2.5 mt-3 space-y-1.5">
            <div className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Результат сессии</div>
            <div className="text-xs text-ink-700">{workflow.source_result.description}</div>
            {workflow.source_result.requirements && (
              <div className="text-[10px] text-ink-500">
                <span className="font-medium">Требования:</span> {workflow.source_result.requirements}
              </div>
            )}
            {workflow.source_result.artifacts.length > 0 && (
              <div className="space-y-1 mt-1">
                {workflow.source_result.artifacts.map((art, i) => {
                  const isPath = /[/\\]/.test(art) || /\.\w{1,10}$/.test(art);
                  return isPath ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => getPlatform().sendClientEvent({ type: "open.path", payload: { path: art, cwd: workflow.source_session_cwd } })}
                      className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded border border-accent/20 bg-white text-xs text-accent hover:bg-accent/10 transition-colors cursor-pointer truncate"
                      title={art}
                    >
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate">{art.split(/[/\\]/).pop()}</span>
                    </button>
                  ) : (
                    <div key={i} className="text-[10px] text-ink-600 px-2 py-1 rounded border border-ink-900/10 bg-white">
                      {art}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Source context (collapsible) */}
        {workflow.source_context && (
          <div className="rounded-lg border border-ink-900/10 overflow-hidden mt-3">
            <button
              type="button"
              onClick={() => setContextExpanded(!contextExpanded)}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-tertiary transition-colors"
            >
              <span className="text-[10px] text-ink-400">📋</span>
              <span className="text-xs font-medium text-ink-500 flex-1">Контекст исходной сессии</span>
              <svg className={`w-3 h-3 text-ink-400 transition-transform ${contextExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {contextExpanded && (
              <div className="px-2.5 pb-2.5 border-t border-ink-900/5">
                <pre className="mt-2 text-[10px] font-mono text-ink-600 whitespace-pre-wrap max-h-[400px] overflow-y-auto leading-relaxed">
                  {workflow.source_context}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Right panel: chat with distill agent ───

type ChatMessage = { role: "user" | "assistant"; text: string };

function ChatPanel({
  workflow,
  onUpdateWorkflow,
  sendEvent,
  sessionId,
}: {
  workflow: MiniWorkflow;
  onUpdateWorkflow: (wf: MiniWorkflow) => void;
  sendEvent: (event: any) => void;
  sessionId: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages(prev => [...prev, { role: "user", text: userMsg }]);
    setLoading(true);

    // Send refinement request to backend
    console.log("[ChatPanel] Sending refine event", { sessionId, userMessage: userMsg, hasWorkflow: !!workflow, source_model: workflow?.source_model });
    try {
      sendEvent({
        type: "miniworkflow.refine",
        payload: {
          sessionId,
          workflow,
          userMessage: userMsg,
        }
      });
      console.log("[ChatPanel] sendEvent completed");
    } catch (err) {
      console.error("[ChatPanel] sendEvent failed:", err);
      setLoading(false);
      setMessages(prev => [...prev, { role: "assistant", text: `Ошибка отправки: ${err}` }]);
    }
  }, [input, loading, sendEvent, sessionId, workflow]);

  // Listen for refinement results
  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      const data = evt.detail;
      if (data?.type === "miniworkflow.refine.result" && data.payload?.sessionId === sessionId) {
        setLoading(false);
        if (data.payload.result?.status === "success") {
          setMessages(prev => [...prev, { role: "assistant", text: data.payload.result.message || "Workflow обновлён." }]);
          if (data.payload.result.workflow) {
            onUpdateWorkflow(data.payload.result.workflow);
          }
        } else {
          setMessages(prev => [...prev, { role: "assistant", text: data.payload.result?.message || "Ошибка при обработке." }]);
        }
      }
    };
    window.addEventListener("distill-refine" as any, handler as any);
    return () => window.removeEventListener("distill-refine" as any, handler as any);
  }, [sessionId, onUpdateWorkflow]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2">
        <div className="text-xs font-semibold text-ink-700">Чат с агентом</div>
        {workflow.source_model && (
          <div className="text-[10px] text-ink-400 mt-0.5 truncate" title={workflow.source_model}>
            {workflow.source_model.split("::").pop()}
          </div>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-muted py-4 text-center">
            Уточни результат дистилляции: попроси изменить шаги, добавить inputs, поменять промпты...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`text-xs rounded-lg px-2.5 py-2 ${
            msg.role === "user"
              ? "bg-accent/10 text-ink-800 ml-6"
              : "bg-surface-tertiary text-ink-700 mr-6"
          }`}>
            <div className="distill-chat-md [&_p]:!text-xs [&_p]:!mt-1 [&_h3]:!text-sm [&_h3]:!mt-2 [&_code]:!text-xs [&_pre]:!text-xs [&_table]:!text-xs [&_li]:!text-xs [&_ul]:!mt-1 [&_ol]:!mt-1">
              <MDContent text={msg.text} />
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-xs text-muted py-2 text-center">Обрабатываю...</div>
        )}
      </div>
      <div className="px-3 pb-3 pt-2 border-t border-ink-900/5">
        <div className="flex gap-1.5 items-end">
          <textarea
            ref={textareaRef}
            className="flex-1 rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none resize-none overflow-hidden"
            placeholder="Уточнение по workflow..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize: reset to 1 row then expand to content (max 6 rows)
              const el = e.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={loading}
            rows={1}
            style={{ minHeight: "32px", maxHeight: "120px" }}
          />
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50 flex-shrink-0"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel: metadata + actions ───

export default function DistillPanel({
  distillLoading,
  distillWorkflow,
  distillError,
  distillQuestions,
  distillUsage,
  distillProgress,
  activeSessionId,
  activeSessionCwd,
  onClose,
  onSave,
  onRetry,
  onSetWorkflow,
  sendEvent,
  replayVerification,
  replayArtifacts,
  verifyCycles,
  debugLogPath,
}: DistillPanelProps) {
  return (
    <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-[95vw] h-[90vh] rounded-xl border border-ink-900/10 bg-white shadow-xl flex overflow-hidden">

        {/* Left panel: chain steps (only when workflow loaded) */}
        {distillWorkflow && (
          <div className="w-72 flex-shrink-0 border-r border-ink-900/10 bg-surface overflow-hidden">
            <StepsPanel workflow={distillWorkflow} onUpdate={onSetWorkflow} />
          </div>
        )}

        {/* Center panel: main form */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-900/10">
            <h3 className="text-sm font-semibold text-ink-800">Create Vale App</h3>
            <div className="flex items-center gap-3">
              {distillUsage && (
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span><span className="font-medium text-ink-700">{distillUsage.input_tokens.toLocaleString()}</span> in</span>
                  <span>/ <span className="font-medium text-ink-700">{distillUsage.output_tokens.toLocaleString()}</span> out</span>
                  <span>= <span className="font-medium text-ink-700">{(distillUsage.input_tokens + distillUsage.output_tokens).toLocaleString()}</span></span>
                </div>
              )}
              {debugLogPath && (
                <button
                  className="rounded-md border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
                  onClick={() => getPlatform().sendClientEvent({ type: "open.path", payload: { path: debugLogPath } })}
                  title={debugLogPath}
                >
                  Debug Log
                </button>
              )}
              <button
                className="rounded-md border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {distillLoading && (
              <div className="rounded-lg border border-ink-900/10 bg-surface p-4 text-sm text-ink-700 space-y-3">
                <div className="font-medium">Анализирую сессию...</div>
                {distillProgress && (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-surface-tertiary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-500"
                          style={{ width: `${(distillProgress.step / distillProgress.totalSteps) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-ink-500 whitespace-nowrap">
                        {distillProgress.step}/{distillProgress.totalSteps}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500">{distillProgress.label}</div>
                    {distillUsage && (
                      <div className="text-xs text-ink-400">
                        Токены: {distillUsage.input_tokens.toLocaleString()} in / {distillUsage.output_tokens.toLocaleString()} out
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {!distillLoading && distillError && (
              <div className="rounded-lg border border-error/20 bg-error-light p-4 text-sm text-error">
                {distillError}
                {distillQuestions.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs font-semibold text-error/80 mb-1">Ошибки валидации:</div>
                    <ul className="list-disc pl-4 text-xs">
                      {distillQuestions.map((q) => <li key={q}>{q}</li>)}
                    </ul>
                    <div className="flex justify-end">
                      <button
                        className="rounded-lg px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent-hover"
                        onClick={() => onRetry(distillQuestions)}
                      >
                        Повторить дистилляцию
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!distillLoading && distillWorkflow && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-ink-700">
                    Name
                    <input
                      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                      value={distillWorkflow.name}
                      onChange={(e) => onSetWorkflow({ ...distillWorkflow, name: e.target.value })}
                    />
                  </label>
                  <label className="text-xs text-ink-700">
                    Description
                    <input
                      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                      value={distillWorkflow.description}
                      onChange={(e) => onSetWorkflow({ ...distillWorkflow, description: e.target.value })}
                    />
                  </label>
                </div>

                <label className="block text-xs text-ink-700">
                  Goal
                  <textarea
                    className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                    rows={2}
                    value={distillWorkflow.goal}
                    onChange={(e) => onSetWorkflow({ ...distillWorkflow, goal: e.target.value })}
                  />
                </label>

                {/* Inputs */}
                <div className="rounded-lg border border-ink-900/10 p-3">
                  <div className="text-xs font-semibold text-ink-700 mb-2">Inputs ({distillWorkflow.inputs.length})</div>
                  {distillWorkflow.inputs.length === 0 ? (
                    <div className="text-xs text-muted">Inputs не найдены автоматически.</div>
                  ) : (
                    <div className="space-y-2">
                      {distillWorkflow.inputs.map((input, index) => (
                        <div key={input.id} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            className="col-span-3 rounded border border-ink-900/10 px-2 py-1 text-xs"
                            value={input.id}
                            onChange={(e) => {
                              const next = [...distillWorkflow.inputs];
                              next[index] = { ...next[index], id: e.target.value };
                              onSetWorkflow({ ...distillWorkflow, inputs: next });
                            }}
                          />
                          <input
                            className="col-span-4 rounded border border-ink-900/10 px-2 py-1 text-xs"
                            value={input.title}
                            onChange={(e) => {
                              const next = [...distillWorkflow.inputs];
                              next[index] = { ...next[index], title: e.target.value };
                              onSetWorkflow({ ...distillWorkflow, inputs: next });
                            }}
                          />
                          <select
                            className="col-span-3 rounded border border-ink-900/10 px-2 py-1 text-xs"
                            value={input.type}
                            onChange={(e) => {
                              const next = [...distillWorkflow.inputs];
                              next[index] = { ...next[index], type: e.target.value as any };
                              onSetWorkflow({ ...distillWorkflow, inputs: next });
                            }}
                          >
                            {["string", "text", "number", "boolean", "enum", "date", "datetime", "file_path", "url", "secret"].map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <label className="col-span-2 flex items-center gap-1 text-[11px] text-ink-600">
                            <input
                              type="checkbox"
                              checked={Boolean(input.required)}
                              onChange={(e) => {
                                const next = [...distillWorkflow.inputs];
                                next[index] = { ...next[index], required: e.target.checked };
                                onSetWorkflow({ ...distillWorkflow, inputs: next });
                              }}
                            />
                            req
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Acceptance criteria */}
                {distillWorkflow.validation?.acceptance_criteria && (
                  <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                    <div className="text-xs font-semibold text-ink-700 mb-1">Acceptance Criteria</div>
                    <div className="text-xs text-ink-600">{distillWorkflow.validation.acceptance_criteria}</div>
                  </div>
                )}

                {/* Replay verification result */}
                {replayVerification && (
                  <div className={`rounded-lg border p-3 space-y-2 ${
                    replayVerification.match
                      ? "border-success/20 bg-success/5"
                      : "border-amber-300/40 bg-amber-50"
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{replayVerification.match ? "✅" : "⚠️"}</span>
                      <div className="text-xs font-semibold text-ink-700">
                        Результат верификации
                      </div>
                      {verifyCycles && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-ink-100 text-ink-500">
                          {verifyCycles.used}/{verifyCycles.max} итер.
                        </span>
                      )}
                      <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        replayVerification.match
                          ? "bg-success/20 text-green-700"
                          : "bg-amber-200 text-amber-800"
                      }`}>
                        {replayVerification.match ? "совпадает" : "расхождения"}
                      </span>
                    </div>
                    <div className="text-xs text-ink-600">{replayVerification.summary}</div>
                    {replayVerification.discrepancies.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Расхождения</div>
                        <ul className="list-disc pl-4 text-xs text-ink-600 space-y-0.5">
                          {replayVerification.discrepancies.map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      </div>
                    )}
                    {replayVerification.suggestions.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">Рекомендации</div>
                        <ul className="list-disc pl-4 text-xs text-ink-600 space-y-0.5">
                          {replayVerification.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Action buttons: re-verify / fix discrepancies */}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={distillLoading}
                        onClick={() => {
                          if (!activeSessionId || !distillWorkflow) return;
                          sendEvent({ type: "miniworkflow.verify", payload: { sessionId: activeSessionId, workflow: distillWorkflow } });
                        }}
                        className="px-2.5 py-1 rounded text-[11px] font-medium border border-ink-900/15 bg-surface-secondary hover:bg-surface-tertiary text-ink-600 disabled:opacity-50 transition-colors"
                      >
                        Повторить ревью
                      </button>
                      {!replayVerification.match && replayVerification.discrepancies.length > 0 && (
                        <button
                          type="button"
                          disabled={distillLoading}
                          onClick={() => {
                            if (!activeSessionId || !distillWorkflow) return;
                            sendEvent({
                              type: "miniworkflow.fix-discrepancies",
                              payload: {
                                sessionId: activeSessionId,
                                workflow: distillWorkflow,
                                discrepancies: replayVerification!.discrepancies,
                                suggestions: replayVerification!.suggestions,
                              },
                            });
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-50 transition-colors"
                        >
                          Устранить расхождения
                        </button>
                      )}
                    </div>

                    {/* Verification replay artifacts (files created during verification) */}
                    {replayArtifacts && replayArtifacts.filesCreated.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <div className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide">
                          Артефакты верификации ({replayArtifacts.filesCreated.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {replayArtifacts.filesCreated.map((file, i) => {
                            const fileName = file.split(/[/\\]/).pop() || file;
                            const canOpen = !!replayArtifacts.workspaceDir;
                            return (
                              <button
                                key={i}
                                type="button"
                                title={canOpen ? file : `${file} (workspace удалён)`}
                                disabled={!canOpen}
                                onClick={() => {
                                  if (canOpen) {
                                    getPlatform().sendClientEvent({ type: "open.path", payload: { path: file, cwd: replayArtifacts.workspaceDir } });
                                  }
                                }}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                                  canOpen
                                    ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer"
                                    : "border-ink-900/10 bg-surface-tertiary text-ink-400 cursor-default"
                                }`}
                              >
                                <span>📄</span>
                                <span className="max-w-[120px] truncate">{fileName}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Step results from verification replay */}
                    {replayArtifacts && Object.keys(replayArtifacts.stepResults).length > 0 && (
                      <details className="pt-1">
                        <summary className="text-[10px] font-semibold text-ink-500 uppercase tracking-wide cursor-pointer hover:text-ink-700">
                          Результаты шагов ({Object.keys(replayArtifacts.stepResults).length})
                        </summary>
                        <div className="mt-1 space-y-1 max-h-[200px] overflow-y-auto">
                          {Object.entries(replayArtifacts.stepResults).map(([stepId, result]) => (
                            <div key={stepId} className="rounded border border-ink-900/10 px-2 py-1.5">
                              <div className="text-[10px] font-medium text-ink-600">{stepId}</div>
                              <pre className="text-[10px] text-ink-500 font-mono whitespace-pre-wrap mt-0.5 max-h-[80px] overflow-y-auto">{
                                typeof result === "string" && result.length > 500
                                  ? result.slice(0, 500) + "..."
                                  : result
                              }</pre>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* Permissions */}
                {(() => {
                  const perms = detectPermissions(distillWorkflow.chain || []);
                  const badges = [
                    { label: "Network", icon: "🌐", active: perms.network, tooltip: perms.reasons.filter(r => r.permission === "network").map(r => r.reason).join(", ") || "no network" },
                    { label: "File System", icon: "📁", active: perms.local_fs, tooltip: perms.reasons.filter(r => r.permission === "local_fs").map(r => r.reason).join(", ") || "no fs" },
                    { label: "Git", icon: "🔀", active: perms.git, tooltip: perms.reasons.filter(r => r.permission === "git").map(r => r.reason).join(", ") || "no git" },
                  ];
                  return (
                    <div className="flex flex-wrap gap-2">
                      {badges.map(b => (
                        <span
                          key={b.label}
                          title={b.tooltip}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border ${
                            b.active
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-ink-900/10 bg-surface-tertiary text-ink-400"
                          }`}
                        >
                          <span>{b.icon}</span>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
                    onClick={() => onSave(distillWorkflow, "published")}
                  >
                    Publish
                  </button>
                  <button
                    className="rounded-lg border border-ink-900/20 bg-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-200"
                    onClick={() => onSave(distillWorkflow, "draft")}
                  >
                    Save as draft
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: chat (only when workflow loaded) */}
        {distillWorkflow && activeSessionId && (
          <div className="w-80 flex-shrink-0 border-l border-ink-900/10 bg-surface overflow-hidden">
            <ChatPanel
              workflow={distillWorkflow}
              onUpdateWorkflow={onSetWorkflow}
              sendEvent={sendEvent}
              sessionId={activeSessionId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
