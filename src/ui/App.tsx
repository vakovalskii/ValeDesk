import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { useIPC } from "./hooks/useIPC";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent, ApiSettings, ClientEvent, LLMModel, MiniWorkflow, MiniWorkflowSummary } from "./types";
import { I18nProvider, useI18n, mapSystemLocaleToSupported } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModalWithActions } from "./components/StartSessionModal";
import { SessionEditModal } from "./components/SessionEditModal";
import { TaskDialog } from "./components/TaskDialog";
import { RoleGroupDialog } from "./components/RoleGroupDialog";
import { SettingsModal } from "./components/SettingsModal";
import { FileBrowser } from "./components/FileBrowser";
import { PromptInput } from "./components/PromptInput";
import { MessageCard } from "./components/EventCard";
import DistillPanel from "./components/DistillPanel";
import { AppFooter } from "./components/AppFooter";
import { TodoPanel } from "./components/TodoPanel";
import MDContent from "./render/markdown";
import { getPlatform } from "./platform";
import { basenameFsPath } from "./platform/fs-path";

function AppHeader({
  activeSessionId,
  setShowSessionEditModal,
  autoScrollEnabled,
  setAutoScrollEnabled,
  apiSettings,
  setApiSettings,
  sendEvent,
  activeSession,
  showFileBrowser,
  setShowFileBrowser,
  showWorkflowPanel,
  setShowWorkflowPanel,
}: {
  activeSessionId: string | null;
  setShowSessionEditModal: (v: boolean) => void;
  autoScrollEnabled: boolean;
  setAutoScrollEnabled: (v: boolean) => void;
  apiSettings: ApiSettings | null;
  setApiSettings: (s: ApiSettings | null) => void;
  sendEvent: (e: ClientEvent) => void;
  activeSession: { cwd?: string; title?: string } | undefined;
  showFileBrowser: boolean;
  setShowFileBrowser: (v: boolean) => void;
  showWorkflowPanel?: boolean;
  setShowWorkflowPanel?: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="relative z-[60] flex items-center justify-between h-12 min-h-[48px] border-b border-ink-900/10 bg-surface-cream select-none px-4 gap-2"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 flex-shrink-0" />
      <span className="text-sm font-medium text-ink-700 truncate flex-shrink min-w-0">{activeSession?.title ?? t("app.defaultTitle")}</span>
      <div className="flex items-center gap-2 flex-shrink-0">
        {activeSessionId && (
          <button
            onClick={() => setShowSessionEditModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-ink-900/5 border border-ink-900/10 text-ink-600 rounded-lg hover:bg-ink-100 transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title={t("app.editSessionSettings")}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
        <button
          onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            autoScrollEnabled ? "bg-info/10 border-info/30 text-info" : "bg-ink-900/5 border-ink-900/10 text-ink-500"
          }`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={autoScrollEnabled ? t("app.autoScrollEnabled") : t("app.autoScrollDisabled")}
        >
          <svg className={`w-4 h-4 transition-transform ${autoScrollEnabled ? "text-info" : "text-ink-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>{t("app.autoScroll")}</span>
        </button>
        {!activeSession?.cwd && activeSessionId && (
          <button
            onClick={async () => {
              try {
                const result = await getPlatform().selectDirectory();
                if (result && activeSessionId) {
                  sendEvent({ type: "session.update-cwd", payload: { sessionId: activeSessionId, cwd: result } });
                }
              } catch (error) {
                console.error("[App] selectDirectory failed", { error });
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title={t("app.setWorkspaceFolderTitle")}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {t("app.setWorkspaceFolder")}
          </button>
        )}
        {activeSession?.cwd && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFileBrowser(!showFileBrowser)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono bg-white border rounded-l-lg transition-colors max-w-xs ${
                showFileBrowser ? "text-accent border-accent/30 bg-accent/5" : "text-ink-600 border-ink-900/10 hover:bg-ink-50 hover:text-ink-900"
              }`}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title={activeSession.cwd}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate">{basenameFsPath(activeSession.cwd)}</span>
            </button>
            <button
              onClick={() => {
                void getPlatform().invoke("open-path-in-finder", activeSession.cwd).catch((error) => console.error("[App] open-path-in-finder failed", { error, path: activeSession.cwd }));
              }}
              className="flex items-center justify-center w-8 h-8 text-ink-600 bg-white border border-l-0 border-ink-900/10 rounded-r-lg hover:bg-ink-50 hover:text-ink-900 transition-colors"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title={t("app.openInFileManager")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
        )}
        {setShowWorkflowPanel && (
          <button
            onClick={() => setShowWorkflowPanel((v: boolean) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showWorkflowPanel
                ? "bg-accent/10 border-accent/30 text-accent"
                : "bg-ink-900/5 border-ink-900/10 text-ink-600"
            }`}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title="Vale Apps"
          >
            Vale Apps
          </button>
        )}
        <button
          onClick={() => {
            const newMode = apiSettings?.permissionMode === "ask" ? "default" : "ask";
            const newSettings = { ...apiSettings, permissionMode: newMode } as ApiSettings;
            sendEvent({ type: "settings.save", payload: { settings: newSettings } });
            setApiSettings(newSettings);
          }}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            apiSettings?.permissionMode === "ask" ? "bg-ink-100 border-ink-300 text-ink-700" : "bg-success/10 border-success/30 text-success"
          }`}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={apiSettings?.permissionMode === "ask" ? t("app.askBeforeEachTool") : t("app.autoExecuteTools")}
        >
          <span className={`w-2 h-2 rounded-full ${apiSettings?.permissionMode === "ask" ? "bg-ink-400" : "bg-success"}`}></span>
          {apiSettings?.permissionMode === "ask" ? t("app.askMode") : t("app.autoMode")}
        </button>
      </div>
    </div>
  );
}

function AppEmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-lg font-medium text-ink-700">{t("app.noMessagesYet")}</div>
      <p className="mt-2 text-sm text-muted">{t("app.startConversation")}</p>
    </div>
  );
}

type AppModalsProps = {
  showStartModal: boolean;
  setShowStartModal: (v: boolean) => void;
  showTaskDialog: boolean;
  setShowTaskDialog: (v: boolean) => void;
  showRoleGroupDialog: boolean;
  setShowRoleGroupDialog: (v: boolean) => void;
  showSettingsModal: boolean;
  setShowSettingsModal: (v: boolean) => void;
  showSessionEditModal: boolean;
  setShowSessionEditModal: (v: boolean) => void;
  activeSessionId: string | null;
  activeSession: { model?: string; temperature?: number; title?: string } | undefined;
  sendEvent: (e: ClientEvent) => void;
  cwd: string;
  prompt: string;
  pendingStart: boolean;
  setCwd: (v: string) => void;
  setPrompt: (v: string) => void;
  apiSettings: ApiSettings | null;
  availableModels: Array<{ id: string; name: string; description?: string }>;
  selectedModel: string | null;
  setSelectedModel: (v: string | null) => void;
  llmModels: LLMModel[];
  selectedTemperature: number;
  setSelectedTemperature: (v: number) => void;
  sendTemperature: boolean;
  setSendTemperature: (v: boolean) => void;
  handleSaveSettings: (s: ApiSettings) => void;
  handleCreateTask: (payload: any) => void;
  handleCreateRoleGroupTask: (payload: any) => void;
};

export function AppModals(props: AppModalsProps) {
  const { isReady } = useI18n();
  return (
    <>
      {props.showStartModal && isReady && (
        <StartSessionModalWithActions
          sendEvent={props.sendEvent}
          cwd={props.cwd}
          prompt={props.prompt}
          pendingStart={props.pendingStart}
          onCwdChange={props.setCwd}
          onPromptChange={props.setPrompt}
          onClose={() => props.setShowStartModal(false)}
          apiSettings={props.apiSettings}
          availableModels={props.availableModels}
          selectedModel={props.selectedModel}
          onModelChange={props.setSelectedModel}
          llmModels={props.llmModels}
          temperature={props.selectedTemperature}
          onTemperatureChange={props.setSelectedTemperature}
          sendTemperature={props.sendTemperature}
          onSendTemperatureChange={props.setSendTemperature}
        />
      )}
      {props.showTaskDialog && isReady && (
        <TaskDialog
          cwd={props.cwd}
          onClose={() => props.setShowTaskDialog(false)}
          onCreateTask={props.handleCreateTask}
          apiSettings={props.apiSettings}
          availableModels={props.availableModels}
          llmModels={props.llmModels}
        />
      )}
      {props.showRoleGroupDialog && isReady && (
        <RoleGroupDialog
          cwd={props.cwd}
          onClose={() => props.setShowRoleGroupDialog(false)}
          onCreateTask={props.handleCreateRoleGroupTask}
          apiSettings={props.apiSettings}
          availableModels={props.availableModels}
          llmModels={props.llmModels}
        />
      )}
      {props.showSettingsModal && isReady && (
        <SettingsModal
          currentSettings={props.apiSettings}
          onSave={props.handleSaveSettings}
          onClose={() => props.setShowSettingsModal(false)}
        />
      )}
      {props.showSessionEditModal && isReady && props.activeSessionId && props.activeSession && (
        <SessionEditModal
          currentModel={props.activeSession.model}
          currentTemperature={props.activeSession.temperature}
          currentTitle={props.activeSession.title}
          llmModels={props.llmModels}
          onSave={(updates) => {
            if (props.activeSessionId) {
              props.sendEvent({
                type: "session.update",
                payload: {
                  sessionId: props.activeSessionId,
                  ...updates
                }
              });
            }
          }}
          onClose={() => props.setShowSessionEditModal(false)}
        />
      )}
    </>
  );
}

function App() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const partialMessageRef = useRef("");
  const [partialMessage, setPartialMessage] = useState("");
  const [showPartialMessage, setShowPartialMessage] = useState(false);
  const isUserScrolledUpRef = useRef(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showWorkflowPanel, setShowWorkflowPanelRaw] = useState(false);
  const setShowWorkflowPanel = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setShowWorkflowPanelRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (next !== prev) {
        try { getPlatform().send?.("toggle-side-panel", next); } catch { /* non-electron */ }
      }
      return next;
    });
  }, []);
  const [miniWorkflows, setMiniWorkflows] = useState<MiniWorkflowSummary[]>([]);
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [pendingWorkflowAction, setPendingWorkflowAction] = useState<"run" | "edit">("run");
  const [openWorkflowMenuId, setOpenWorkflowMenuId] = useState<string | null>(null);
  const [distillSessionId, setDistillSessionId] = useState<string | null>(null);
  const [distillLoading, setDistillLoading] = useState(false);
  const [distillWorkflow, setDistillWorkflow] = useState<MiniWorkflow | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [distillQuestions, setDistillQuestions] = useState<string[]>([]);
  const [distillUsage, setDistillUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null);
  const [distillProgress, setDistillProgress] = useState<{ step: number; totalSteps: number; label: string } | null>(null);
  const [replayVerification, setReplayVerification] = useState<{ match: boolean; summary: string; discrepancies: string[]; suggestions: string[] } | null>(null);
  const [replayArtifacts, setReplayArtifacts] = useState<{ filesCreated: string[]; stepResults: Record<string, string>; workspaceDir?: string } | null>(null);
  const [verifyCycles, setVerifyCycles] = useState<{ used: number; max: number } | null>(null);
  const [distillDebugLogPath, setDistillDebugLogPath] = useState<string | null>(null);
  const [showDistillConfig, setShowDistillConfig] = useState(false);
  const [distillConfigModel, setDistillConfigModel] = useState("");
  const [distillConfigMaxCycles, setDistillConfigMaxCycles] = useState(3);
  const [runWorkflow, setRunWorkflow] = useState<MiniWorkflow | null>(null);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [runModel, setRunModel] = useState<string>("");
  const [deleteWorkflowCandidate, setDeleteWorkflowCandidate] = useState<MiniWorkflowSummary | null>(null);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showRoleGroupDialog, setShowRoleGroupDialog] = useState(false);
  const [showSessionEditModal, setShowSessionEditModal] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Track if settings have been loaded from backend
  const [llmProvidersLoaded, setLlmProvidersLoaded] = useState(false); // Track if LLM providers have been loaded
  const [systemLocale, setSystemLocale] = useState<string | null>(null);
  const partialUpdateScheduledRef = useRef(false);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const selectedTemperature = useAppStore((s) => s.selectedTemperature);
  const setSelectedTemperature = useAppStore((s) => s.setSelectedTemperature);
  const sendTemperature = useAppStore((s) => s.sendTemperature);
  const setSendTemperature = useAppStore((s) => s.setSendTemperature);
  const availableModels = useAppStore((s) => s.availableModels);
  const llmModels = useAppStore((s) => s.llmModels);

  const sessions = useAppStore((s) => s.sessions);
  const sessionsLoaded = useAppStore((s) => s.sessionsLoaded);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showStartModal = useAppStore((s) => s.showStartModal);
  const setShowStartModal = useAppStore((s) => s.setShowStartModal);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const historyRequested = useAppStore((s) => s.historyRequested);
  const markHistoryRequested = useAppStore((s) => s.markHistoryRequested);
  const setHistoryLoading = useAppStore((s) => s.setHistoryLoading);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const cwd = useAppStore((s) => s.cwd);
  const setCwd = useAppStore((s) => s.setCwd);
  const pendingStart = useAppStore((s) => s.pendingStart);
  const autoScrollEnabled = useAppStore((s) => s.autoScrollEnabled);
  const setAutoScrollEnabled = useAppStore((s) => s.setAutoScrollEnabled);
  const pendingPrependRef = useRef<null | { sessionId: string; prevScrollHeight: number; prevScrollTop: number }>(null);

  // Helper function to extract partial message content
  const getPartialMessageContent = (eventMessage: any) => {
    try {
      const realType = eventMessage.delta.type.split("_")[0];
      return eventMessage.delta[realType];
    } catch (error) {
      console.error(error);
      return "";
    }
  };

  // Handle partial messages from stream events
  const handlePartialMessages = useCallback((partialEvent: ServerEvent) => {
    if (partialEvent.type !== "stream.message" || partialEvent.payload.message.type !== "stream_event") return;

    const message = partialEvent.payload.message as any;
    if (message.event.type === "content_block_start") {
      partialMessageRef.current = "";
      setPartialMessage(partialMessageRef.current);
      setShowPartialMessage(true);
    }

    if (message.event.type === "content_block_delta") {
      partialMessageRef.current += getPartialMessageContent(message.event) || "";
      
      // Schedule UI update using requestAnimationFrame (smart throttling)
      if (!partialUpdateScheduledRef.current) {
        partialUpdateScheduledRef.current = true;
        requestAnimationFrame(() => {
          setPartialMessage(partialMessageRef.current);
          partialUpdateScheduledRef.current = false;
        });
      }
    }

    if (message.event.type === "content_block_stop") {
      // Cancel any scheduled update
      partialUpdateScheduledRef.current = false;
      
      // Force final update
      setPartialMessage(partialMessageRef.current);
      
      setShowPartialMessage(false);
      setTimeout(() => {
        partialMessageRef.current = "";
        setPartialMessage(partialMessageRef.current);
      }, 500);
    }
  }, []);

  // Combined event handler
  const onEvent = useCallback((event: ServerEvent) => {
    handleServerEvent(event);
    handlePartialMessages(event);
    
    // Handle settings loaded event
    if (event.type === "settings.loaded") {
      setApiSettings(event.payload.settings);
      setSettingsLoaded(true);
    }
    
    // Handle LLM providers loaded event
    if (event.type === "llm.providers.loaded") {
      setLlmProvidersLoaded(true);
    }

    if (event.type === "miniworkflow.list") {
      setMiniWorkflows(event.payload.workflows);
    }
    if (event.type === "miniworkflow.distill.progress") {
      const { step, totalSteps, label, usage } = event.payload;
      setDistillProgress({ step, totalSteps, label });
      if (usage) setDistillUsage(usage);
    }
    if (event.type === "miniworkflow.distill.result") {
      setDistillLoading(false);
      setDistillProgress(null);
      setDistillUsage(event.payload.usage || null);
      if (event.payload.debugLogPath) setDistillDebugLogPath(event.payload.debugLogPath);
      const result = event.payload.result as any;
      if (result.status === "success") {
        // Sanitize workflow to ensure all fields are correct types for rendering
        const wf = result.workflow as any;
        try {
          const sanitized: MiniWorkflow = {
            ...wf,
            name: String(wf.name || ""),
            description: String(wf.description || ""),
            goal: String(wf.goal || ""),
            inputs: Array.isArray(wf.inputs) ? wf.inputs.map((inp: any) => ({
              ...inp,
              id: String(inp.id || ""),
              title: String(inp.title || ""),
              description: String(inp.description || ""),
              type: String(inp.type || "string"),
              required: Boolean(inp.required),
            })) : [],
            chain: Array.isArray(wf.chain) ? wf.chain.map((s: any) => ({
              ...s,
              id: String(s.id || ""),
              title: String(s.title || ""),
              prompt_template: String(s.prompt_template || ""),
              tools: Array.isArray(s.tools) ? s.tools.map(String) : [],
              output_key: String(s.output_key || ""),
              execution: s.execution || "llm",
              script: s.script || undefined,
            })) : [],
            validation: wf.validation ? {
              acceptance_criteria: String(wf.validation.acceptance_criteria || ""),
              prompt_template: String(wf.validation.prompt_template || ""),
              tools: Array.isArray(wf.validation.tools) ? wf.validation.tools.map(String) : [],
              max_fix_attempts: Number(wf.validation.max_fix_attempts) || 3,
            } : { acceptance_criteria: "", prompt_template: "", tools: [], max_fix_attempts: 3 },
            artifacts: Array.isArray(wf.artifacts) ? wf.artifacts : [],
          };
          setDistillWorkflow(sanitized);
          setDistillError(null);
          setDistillQuestions([]);
          console.log("[UI] Distill workflow set:", sanitized.id, sanitized.name, "inputs:", sanitized.inputs.length, "chain:", sanitized.chain.length);
        } catch (e) {
          console.error("[UI] Failed to sanitize workflow:", e, wf);
          setDistillWorkflow(null);
          setDistillQuestions([]);
          setDistillError(`Ошибка обработки workflow: ${String(e)}`);
        }
      } else if (result.status === "needs_clarification") {
        setDistillWorkflow(null);
        setDistillQuestions(result.questions || []);
        setDistillError("Нужны уточнения для построения workflow.");
      } else {
        setDistillWorkflow(null);
        setDistillQuestions([]);
        setDistillError(result.reason || "Сессия не подходит для distill.");
      }
    }
    if (event.type === "miniworkflow.loaded") {
      const full = event.payload.workflow;
      if (pendingWorkflowAction === "edit") {
        setDistillSessionId(full.source_session_id || "manual");
        setDistillWorkflow(full);
        setDistillLoading(false);
        setDistillError(null);
        setDistillQuestions([]);
      } else {
        const defaults: Record<string, string> = {};
        for (const input of full.inputs) defaults[input.id] = String(input.default ?? "");
        setRunInputs(defaults);
        setRunWorkflow(full);
      }
    }
    if (event.type === "miniworkflow.replay.verified") {
      setReplayVerification(event.payload.verification);
      setReplayArtifacts(event.payload.replayArtifacts || null);
      setVerifyCycles(event.payload.verifyCycles || null);
    }
    if (event.type === "miniworkflow.refine.result") {
      // Forward to DistillPanel via CustomEvent
      window.dispatchEvent(new CustomEvent("distill-refine", { detail: event }));
    }
    if (event.type === "miniworkflow.error") {
      setGlobalError(event.payload.message);
    }
    if (event.type === "miniworkflow.replay.started") {
      const { sessionId } = event.payload;
      useAppStore.getState().setActiveSessionId(sessionId);
    }

    // Scheduler notifications are now handled natively by Rust
    if (event.type === "scheduler.notification") {
      console.log(`[scheduler] 🔔 ${event.payload.title}: ${event.payload.body}`);
    }
  }, [handleServerEvent, handlePartialMessages, pendingWorkflowAction, setGlobalError]);

  const { connected, sendEvent } = useIPC(onEvent);


  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSession?.messages ?? [];
  const permissionRequests = activeSession?.permissionRequests ?? [];
  const isRunning = activeSession?.status === "running";

  useEffect(() => {
    if (connected) {
      sendEvent({ type: "session.list" });
      sendEvent({ type: "miniworkflow.list", payload: { cwd: activeSession?.cwd, global: true } });
      sendEvent({ type: "settings.get" });
      sendEvent({ type: "models.get" });
      sendEvent({ type: "llm.providers.get" });
      sendEvent({ type: "scheduler.default_model.get" });
      sendEvent({ type: "scheduler.default_temperature.get" });
    }
  }, [connected, sendEvent]);

  // Reload workflow list when active session changes — use any known cwd as fallback
  const anyCwd = activeSession?.cwd || Object.values(sessions).find(s => s.cwd)?.cwd;
  useEffect(() => {
    if (connected && anyCwd) {
      sendEvent({ type: "miniworkflow.list", payload: { cwd: anyCwd, global: true } });
    }
  }, [connected, activeSessionId, anyCwd, sendEvent]);

  // Detect system locale for first-run (Tauri: getLocale, Electron: navigator.language)
  useEffect(() => {
    if (typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined") {
      import("tauri-plugin-locale-api")
        .then(({ getLocale }) => getLocale())
        .then((loc) => setSystemLocale(mapSystemLocaleToSupported(loc)))
        .catch(() => setSystemLocale("en"));
    } else {
      setSystemLocale(mapSystemLocaleToSupported(navigator.language));
    }
  }, []);

  // Persist system locale on first run when no saved locale exists
  const hasPersistedInitialLocale = useRef(false);
  useEffect(() => {
    if (
      !settingsLoaded ||
      hasPersistedInitialLocale.current ||
      apiSettings?.locale != null
    )
      return;
    if (systemLocale) {
      hasPersistedInitialLocale.current = true;
      const newSettings: ApiSettings = {
        ...(apiSettings ?? { apiKey: "", baseUrl: "", model: "" }),
        locale: systemLocale,
      };
      sendEvent({ type: "settings.save", payload: { settings: newSettings } });
      setApiSettings(newSettings);
    }
  }, [settingsLoaded, apiSettings, systemLocale, sendEvent]);

  // Check if API key or LLM providers are configured on first load
  useEffect(() => {
    // Wait until both settings AND llm providers are loaded from backend
    if (!settingsLoaded || !llmProvidersLoaded) return;
    
    // Check if we have any enabled models from LLM providers (enabled !== false)
    const hasEnabledModels = llmModels.some(m => m.enabled !== false);
    const hasNoSessions = sessionsLoaded && Object.keys(sessions).length === 0;
    
    // If we have enabled models from LLM providers, show Start when no sessions
    if (hasEnabledModels) {
      console.log('[App] LLM providers with enabled models found:', llmModels.length, 'models');
      if (hasNoSessions) {
        setShowStartModal(true);
      }
      return;
    }
    
    // No LLM models - check legacy API settings
    if (apiSettings === null) {
      console.log('[App] No settings or LLM providers found, opening Settings modal');
      setShowStartModal(false);
      setShowSettingsModal(true);
      return;
    }
    
    // Settings exist - check if API key is valid
    const hasValidApiKey = apiSettings.apiKey && 
                          apiSettings.apiKey.trim() !== '' && 
                          apiSettings.apiKey !== 'null' &&
                          apiSettings.apiKey !== 'undefined';
    
    if (!hasValidApiKey) {
      console.log('[App] No valid API key or enabled LLM models found, opening Settings modal');
      setShowStartModal(false);
      setShowSettingsModal(true);
    } else {
      console.log('[App] Valid API key found');
      if (hasNoSessions) {
        setShowStartModal(true);
      }
    }
  }, [apiSettings, settingsLoaded, llmProvidersLoaded, llmModels, sessions, sessionsLoaded, setShowStartModal]);

  useEffect(() => {
    if (!activeSessionId || !connected) return;
    const session = sessions[activeSessionId];
    if (session && !session.hydrated && !historyRequested.has(activeSessionId)) {
      markHistoryRequested(activeSessionId);
      setHistoryLoading(activeSessionId, true);
      sendEvent({ type: "session.history", payload: { sessionId: activeSessionId, limit: 20 } });
    }
  }, [activeSessionId, connected, sessions, historyRequested, markHistoryRequested, sendEvent, setHistoryLoading]);

  // Track user scroll position to disable auto-scroll when user scrolls up
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollPosition = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;

      // User is considered "scrolled up" if they're more than 100px from the bottom
      const distanceFromBottom = scrollHeight - scrollPosition - clientHeight;
      isUserScrolledUpRef.current = distanceFromBottom > 100;

      // Infinite scroll: load older messages when near the top
      const nearTop = scrollPosition <= 120;
      const session = activeSessionId ? sessions[activeSessionId] : undefined;
      if (nearTop && session?.historyHasMore && !session.historyLoading && session.historyCursor) {
        if (!messagesContainerRef.current) return;
        pendingPrependRef.current = {
          sessionId: activeSessionId!,
          prevScrollHeight: messagesContainerRef.current.scrollHeight,
          prevScrollTop: messagesContainerRef.current.scrollTop
        };
        setHistoryLoading(activeSessionId!, true);
        sendEvent({
          type: "session.history",
          payload: { sessionId: activeSessionId!, limit: 10, before: session.historyCursor }
        });
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [activeSessionId, sessions, sendEvent, setHistoryLoading]);

  // Auto-scroll when a complete message is added
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    // Only scroll if we actually added a new message (not just updated existing ones)
    if (messages.length > prevMessagesLengthRef.current) {
      console.log('[AutoScroll] New message detected, autoScrollEnabled:', autoScrollEnabled, 'isUserScrolledUp:', isUserScrolledUpRef.current);
      if (autoScrollEnabled && !isUserScrolledUpRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
      prevMessagesLengthRef.current = messages.length;
    }
  }, [messages, autoScrollEnabled]);

  // Auto-scroll during streaming - ONLY if autoScrollEnabled is true AND user hasn't scrolled up
  const lastScrollTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!showPartialMessage || !partialMessage || !autoScrollEnabled || isUserScrolledUpRef.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    const now = Date.now();
    // Throttle scroll calls to max once per 30ms for more responsive scrolling
    if (now - lastScrollTimeRef.current > 30) {
      lastScrollTimeRef.current = now;
      // Force scroll to bottom immediately for long messages
      container.scrollTop = container.scrollHeight;
    }
  }, [showPartialMessage, partialMessage, autoScrollEnabled]);

  // Scroll handling for paginated history loads
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !activeSessionId) return;

    if (activeSession?.historyLoadType === "prepend") {
      const pending = pendingPrependRef.current;
      if (pending && pending.sessionId === activeSessionId) {
        requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = pending.prevScrollTop + (newScrollHeight - pending.prevScrollHeight);
          pendingPrependRef.current = null;
        });
      }
      return;
    }

    if (activeSession?.historyLoadType === "initial" && autoScrollEnabled && messages.length > 0) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [activeSession?.historyLoadId, activeSession?.historyLoadType, activeSessionId, autoScrollEnabled, messages.length]);

  const handleNewSession = useCallback(() => {
    useAppStore.getState().setActiveSessionId(null);
    setShowStartModal(true);
  }, [setShowStartModal]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    sendEvent({ type: "session.delete", payload: { sessionId } });
  }, [sendEvent]);

  const handlePermissionResult = useCallback((toolUseId: string, result: PermissionResult) => {
    if (!activeSessionId) return;
    sendEvent({ type: "permission.response", payload: { sessionId: activeSessionId, toolUseId, result } });
    resolvePermissionRequest(activeSessionId, toolUseId);
  }, [activeSessionId, sendEvent, resolvePermissionRequest]);

  const handleEditMessage = useCallback((messageIndex: number, newPrompt: string) => {
    if (!activeSessionId) return;
    
    // Send event to edit and re-run from this message
    sendEvent({ 
      type: "message.edit", 
      payload: { 
        sessionId: activeSessionId, 
        messageIndex, 
        newPrompt 
      } 
    });
  }, [activeSessionId, sendEvent]);

  const handleRetry = useCallback((retryPrompt?: string) => {
    if (!activeSessionId) return;
    if (isRunning) {
      setGlobalError("Session is still running. Please wait for it to finish.");
      return;
    }

    const lastPrompt = retryPrompt || (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as any;
        if (msg?.type === "user_prompt") return msg.prompt as string;
      }
      return "";
    })();

    if (!lastPrompt) {
      setGlobalError("No prompt available to retry.");
      return;
    }

    sendEvent({
      type: "session.continue",
      payload: {
        sessionId: activeSessionId,
        prompt: lastPrompt,
        retry: true,
        retryReason: "manual"
      }
    });
  }, [activeSessionId, isRunning, messages, sendEvent, setGlobalError]);

  const handleSaveSettings = useCallback((settings: ApiSettings) => {
    sendEvent({ type: "settings.save", payload: { settings } });
    setApiSettings(settings);
  }, [sendEvent]);

  const effectiveLocale =
    apiSettings?.locale ??
    systemLocale ??
    mapSystemLocaleToSupported(navigator.language);

  const handleLocaleChange = useCallback(
    (locale: string) => {
      const newSettings: ApiSettings = {
        ...(apiSettings ?? {
          apiKey: "",
          baseUrl: "",
          model: "",
        }),
        locale,
      };
      handleSaveSettings(newSettings);
    },
    [apiSettings, handleSaveSettings]
  );

  const handleConfirmChanges = useCallback((sessionId: string) => {
    sendEvent({ type: "file_changes.confirm", payload: { sessionId } });
  }, [sendEvent]);

  const handleRollbackChanges = useCallback((sessionId: string) => {
    sendEvent({ type: "file_changes.rollback", payload: { sessionId } });
  }, [sendEvent]);

  const handleCreateTask = useCallback((payload: any) => {
    // Create task - it will auto-start on backend
    sendEvent({ type: "task.create", payload });
    setShowTaskDialog(false);
  }, [sendEvent]);

  const handleCreateRoleGroupTask = useCallback((payload: any) => {
    if (payload?.mode === "role_group") {
      const prompt = payload.roleGroupPrompt || "";
      const state = useAppStore.getState();
      const model =
        payload.roleGroupModel ||
        payload.tasks?.[0]?.model ||
        state.schedulerDefaultModel ||
        state.apiSettings?.model;
      if (!prompt.trim()) {
        setGlobalError("Role Group prompt is empty.");
        return;
      }
      if (!model) {
        setGlobalError("No default model. Set scheduler default model or API model in Settings.");
        return;
      }
      sendEvent({
        type: "session.start",
        payload: {
          title: payload.title || "Role Group",
          prompt,
          cwd: payload.cwd,
          model
        }
      });
    } else {
      sendEvent({ type: "task.create", payload });
    }
    setShowRoleGroupDialog(false);
  }, [sendEvent, setGlobalError]);

  const handleDistillWorkflow = useCallback(() => {
    if (!activeSessionId) return;
    // Pre-set model from session
    const sessionModel = activeSession?.model || "";
    setDistillConfigModel(sessionModel);
    setDistillConfigMaxCycles(3);
    setShowDistillConfig(true);
  }, [activeSessionId, activeSession]);

  const handleDistillStart = useCallback((model: string, maxCycles: number) => {
    if (!activeSessionId) return;
    setShowDistillConfig(false);
    setDistillSessionId(activeSessionId);
    setDistillLoading(true);
    setDistillWorkflow(null);
    setDistillError(null);
    setDistillQuestions([]);
    setDistillUsage(null);
    setDistillProgress(null);
    setReplayVerification(null);
    setVerifyCycles(null);
    setDistillDebugLogPath(null);
    sendEvent({
      type: "miniworkflow.distill",
      payload: {
        sessionId: activeSessionId,
        model: model || undefined,
        maxVerifyCycles: maxCycles
      }
    });
  }, [activeSessionId, sendEvent]);

  const hasToolUseInMessages = messages.some((m: any) => m?.type === "tool_use")
    || messages.some((m: any) => m?.type === "assistant" && Array.isArray(m?.message?.content) && m.message.content.some((c: any) => c?.type === "tool_use"));
  const canSaveMiniWorkflow = Boolean(
    activeSessionId &&
    activeSession &&
    (activeSession.status === "completed" || activeSession.status === "idle") &&
    hasToolUseInMessages &&
    !distillLoading
  );
  const saveMiniWorkflowHint = !activeSessionId
    ? "Откройте сессию"
    : distillLoading
      ? "Идет анализ сессии..."
      : activeSession?.status === "running"
      ? "Дождитесь завершения сессии"
      : !hasToolUseInMessages
        ? "Нет вызовов инструментов в сессии"
        : undefined;

  return (
    <I18nProvider
      initialLocale={effectiveLocale}
      onLocaleChange={handleLocaleChange}
    >
    <div className="flex h-screen bg-surface">
      <Sidebar
        connected={connected}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenTaskDialog={() => setShowTaskDialog(true)}
        onOpenRoleGroupDialog={() => setShowRoleGroupDialog(true)}
        apiSettings={apiSettings}
      />

      <main className={`flex flex-1 flex-col ml-[280px] bg-surface-cream overflow-hidden ${showWorkflowPanel ? "mr-[320px]" : ""}`}>
        <AppHeader
          activeSessionId={activeSessionId}
          setShowSessionEditModal={setShowSessionEditModal}
          autoScrollEnabled={autoScrollEnabled}
          setAutoScrollEnabled={setAutoScrollEnabled}
          apiSettings={apiSettings}
          setApiSettings={setApiSettings}
          sendEvent={sendEvent}
          activeSession={activeSession}
          showFileBrowser={showFileBrowser}
          setShowFileBrowser={setShowFileBrowser}
          showWorkflowPanel={showWorkflowPanel}
          setShowWorkflowPanel={setShowWorkflowPanel}
        />

        <div ref={messagesContainerRef} id="messages-container" className={`flex-1 overflow-y-auto overflow-x-hidden px-8 pt-6 min-w-0 ${activeSession?.todos && activeSession.todos.length > 0 ? 'pb-4' : 'pb-40'}`}>
          <div className="mx-auto w-full max-w-4xl min-w-0">
            {messages.length === 0 ? (
              <AppEmptyState />
            ) : (
              messages.map((msg, idx) => (
                <MessageCard
                  key={idx}
                  message={msg}
                  messageIndex={idx}
                  isLast={idx === messages.length - 1}
                  isRunning={isRunning}
                  permissionRequest={permissionRequests[0]}
                  onPermissionResult={handlePermissionResult}
                  onEditMessage={handleEditMessage}
                  fileChanges={activeSession?.fileChanges}
                  sessionId={activeSessionId || undefined}
                  onConfirmChanges={handleConfirmChanges}
                  onRollbackChanges={handleRollbackChanges}
                  onRetry={handleRetry}
                />
              ))
            )}

            {/* Partial message display with skeleton loading */}
            <div className="partial-message">
              <MDContent text={partialMessage} />
              {showPartialMessage && (
                <div className="mt-3 flex flex-col gap-2 px-1">
                  <div className="relative h-3 w-2/12 overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-4/12 overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                </div>
              )}
            </div>

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Todo Panel - fixed above input */}
        {activeSession?.todos && activeSession.todos.length > 0 && (
          <div className="flex-shrink-0 px-4 pb-2 mx-auto w-full max-w-4xl" style={{ marginBottom: '120px' }}>
            <TodoPanel
              todos={activeSession.todos}
              fileChanges={activeSession.fileChanges}
              activeSessionId={activeSessionId}
              onConfirmChanges={handleConfirmChanges}
              onRollbackChanges={handleRollbackChanges}
            />
          </div>
        )}

        <PromptInput
          sendEvent={sendEvent}
          onSaveMiniWorkflow={handleDistillWorkflow}
          canSaveMiniWorkflow={canSaveMiniWorkflow}
          saveMiniWorkflowHint={saveMiniWorkflowHint}
          workflowPanelOpen={showWorkflowPanel}
          saveMiniWorkflowLoading={distillLoading}
        />
      </main>

      <aside
        className={`fixed inset-y-0 right-0 z-[70] w-[320px] border-l border-ink-900/10 bg-[#FAF9F6] px-3 pt-3 pb-3 overflow-y-auto transition-transform duration-200 ease-out ${
          showWorkflowPanel ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-700">Vale Apps</h3>
            <button
              type="button"
              className="rounded-lg border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
              onClick={() => setShowWorkflowPanel(false)}
            >
              X
            </button>
          </div>
          <input
            className="mb-3 w-full rounded-xl border border-ink-900/10 bg-white pl-2.5 pr-2.5 py-1.5 text-xs text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
            placeholder="Filter by name/tags..."
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
          />
          {miniWorkflows.length === 0 ? (
            <div className="rounded-lg border border-ink-900/10 bg-white p-3 text-xs text-muted">
              No published workflows yet.
            </div>
          ) : (
            <div className="space-y-2">
              {miniWorkflows
                .filter((wf) => {
                  const q = workflowFilter.trim().toLowerCase();
                  if (!q) return true;
                  const tags = (wf.tags || []).join(" ").toLowerCase();
                  return wf.name.toLowerCase().includes(q) || wf.description.toLowerCase().includes(q) || tags.includes(q);
                })
                .map((wf) => (
                <div key={wf.id} className="rounded-lg border border-ink-900/10 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-800">{wf.icon} {wf.name}</div>
                      <div className="text-[11px] text-muted">v{wf.version} - inputs: {wf.inputs_count}</div>
                    </div>
                    <div className="relative">
                      <button
                        className="rounded-md border border-ink-900/10 px-2 py-1 text-[11px] text-ink-600 hover:bg-ink-100"
                        onClick={() => setOpenWorkflowMenuId((prev) => prev === wf.id ? null : wf.id)}
                      >
                        ...
                      </button>
                      {openWorkflowMenuId === wf.id && (
                        <div className="absolute right-0 top-7 z-20 min-w-[140px] rounded-lg border border-ink-900/10 bg-white p-1 shadow-lg">
                          <button
                            className="block w-full rounded px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-100"
                            onClick={() => {
                              setPendingWorkflowAction("edit");
                              sendEvent({ type: "miniworkflow.get", payload: { workflowId: wf.id, cwd: activeSession?.cwd } });
                              setOpenWorkflowMenuId(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="block w-full rounded px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-100"
                            onClick={() => {
                              sendEvent({ type: "miniworkflow.archive", payload: { workflowId: wf.id, cwd: activeSession?.cwd } });
                              setOpenWorkflowMenuId(null);
                            }}
                          >
                            Archive
                          </button>
                          <button
                            className="block w-full rounded px-2 py-1 text-left text-xs text-error hover:bg-error/10"
                            onClick={() => {
                              setDeleteWorkflowCandidate(wf);
                              setOpenWorkflowMenuId(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-600">{wf.description}</p>
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/20"
                      onClick={() => {
                        setPendingWorkflowAction("run");
                        sendEvent({ type: "miniworkflow.get", payload: { workflowId: wf.id, cwd: activeSession?.cwd } });
                      }}
                    >
                      Run
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </aside>

      <AppModals
        showStartModal={showStartModal}
        setShowStartModal={setShowStartModal}
        showTaskDialog={showTaskDialog}
        setShowTaskDialog={setShowTaskDialog}
        showRoleGroupDialog={showRoleGroupDialog}
        setShowRoleGroupDialog={setShowRoleGroupDialog}
        showSettingsModal={showSettingsModal}
        setShowSettingsModal={setShowSettingsModal}
        showSessionEditModal={showSessionEditModal}
        setShowSessionEditModal={setShowSessionEditModal}
        activeSessionId={activeSessionId}
        activeSession={activeSession}
        sendEvent={sendEvent}
        cwd={cwd}
        prompt={prompt}
        pendingStart={pendingStart}
        setCwd={setCwd}
        setPrompt={setPrompt}
        apiSettings={apiSettings}
        availableModels={availableModels}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        llmModels={llmModels}
        selectedTemperature={selectedTemperature}
        setSelectedTemperature={setSelectedTemperature}
        sendTemperature={sendTemperature}
        setSendTemperature={setSendTemperature}
        handleSaveSettings={handleSaveSettings}
        handleCreateTask={handleCreateTask}
        handleCreateRoleGroupTask={handleCreateRoleGroupTask}
      />

      {showDistillConfig && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-ink-900/10 bg-white shadow-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-ink-800">Настройки дистилляции</h3>
            <label className="block text-xs text-ink-700">
              Модель
              <div className="text-[10px] text-ink-400 mb-1">Рекомендуется использовать самую мощную / размышляющую модель</div>
              <select
                className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                value={distillConfigModel}
                onChange={(e) => setDistillConfigModel(e.target.value)}
              >
                <option value="">Модель сессии ({activeSession?.model?.split("::").pop() || "default"})</option>
                {llmModels.filter(m => m.enabled !== false).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.providerType})</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-700">
              Макс. циклов ревью-багфикс
              <div className="text-[10px] text-ink-400 mb-1">Сколько итераций "тестовый прогон → верификация → исправление" (1-10)</div>
              <input
                type="number"
                min={1}
                max={10}
                className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                value={distillConfigMaxCycles}
                onChange={(e) => setDistillConfigMaxCycles(Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="rounded-lg border border-ink-900/20 bg-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-200"
                onClick={() => setShowDistillConfig(false)}
              >
                Отмена
              </button>
              <button
                className="rounded-lg bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover"
                onClick={() => handleDistillStart(distillConfigModel, distillConfigMaxCycles)}
              >
                Начать дистилляцию
              </button>
            </div>
          </div>
        </div>
      )}

      {distillSessionId && (
        <DistillPanel
          distillLoading={distillLoading}
          distillWorkflow={distillWorkflow}
          distillError={distillError}
          distillQuestions={distillQuestions}
          distillUsage={distillUsage}
          distillProgress={distillProgress}
          activeSessionId={distillSessionId}
          activeSessionCwd={activeSession?.cwd}
          onClose={() => {
            setDistillSessionId(null);
            setDistillWorkflow(null);
            setReplayVerification(null);
            setReplayArtifacts(null);
            setVerifyCycles(null);
            setDistillDebugLogPath(null);
          }}
          onSave={(wf, status) => {
            sendEvent({
              type: "miniworkflow.save",
              payload: {
                workflow: { ...wf, status },
                scope: activeSession?.cwd ? "project" : "global",
                cwd: activeSession?.cwd
              }
            });
            setDistillSessionId(null);
            setDistillWorkflow(null);
            setReplayVerification(null);
            setReplayArtifacts(null);
            setVerifyCycles(null);
            setDistillDebugLogPath(null);
          }}
          onRetry={(errors) => {
            if (!activeSessionId) return;
            setDistillLoading(true);
            setDistillError(null);
            sendEvent({
              type: "miniworkflow.distill",
              payload: { sessionId: activeSessionId, validationErrors: errors }
            });
          }}
          onSetWorkflow={setDistillWorkflow}
          sendEvent={sendEvent}
          replayVerification={replayVerification}
          replayArtifacts={replayArtifacts}
          verifyCycles={verifyCycles}
          debugLogPath={distillDebugLogPath}
        />
      )}

      {runWorkflow && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-ink-900/10 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-800">Запуск: {runWorkflow.name}</h3>
              <button className="rounded-md border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100" onClick={() => setRunWorkflow(null)}>
                Close
              </button>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-ink-700 font-medium mb-1">Model</label>
              {(() => {
                const enabledModels = llmModels.filter(m => m.enabled !== false);
                if (enabledModels.length === 0) {
                  return <p className="text-xs text-ink-500">No models configured</p>;
                }
                return (
                  <select
                    className="w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                    value={runModel || enabledModels[0]?.id || ""}
                    onChange={(e) => setRunModel(e.target.value)}
                  >
                    {enabledModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                );
              })()}
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {runWorkflow.inputs.map((input) => (
                <label key={input.id} className="block text-xs text-ink-700">
                  {input.title || input.id}
                  {input.type === "boolean" ? (
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-ink-900/10 px-2 py-1.5 bg-white">
                      <input
                        type="checkbox"
                        checked={String(runInputs[input.id] ?? "").toLowerCase() === "true"}
                        onChange={(e) => setRunInputs((prev) => ({ ...prev, [input.id]: String(e.target.checked) }))}
                      />
                      <span className="text-xs text-ink-600">{input.description || input.id}</span>
                    </div>
                  ) : input.type === "enum" && Array.isArray(input.enum_values) ? (
                    <select
                      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                      value={runInputs[input.id] ?? ""}
                      onChange={(e) => setRunInputs((prev) => ({ ...prev, [input.id]: e.target.value }))}
                    >
                      <option value="">Выберите значение</option>
                      {input.enum_values.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input
                      type={
                        input.type === "secret" ? "password"
                          : input.type === "number" ? "number"
                            : input.type === "date" ? "date"
                              : input.type === "datetime" ? "datetime-local"
                                : input.type === "url" ? "url"
                                  : "text"
                      }
                      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                      value={runInputs[input.id] ?? ""}
                      onChange={(e) => setRunInputs((prev) => ({ ...prev, [input.id]: e.target.value }))}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-ink-900/10 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100" onClick={() => setRunWorkflow(null)}>
                Отмена
              </button>
              <button
                className={`rounded-lg px-3 py-1.5 text-xs text-white ${
                  runWorkflow.inputs.some((input) => input.required && !String(runInputs[input.id] ?? "").trim())
                    ? "bg-ink-400 cursor-not-allowed"
                    : "bg-accent hover:bg-accent-hover"
                }`}
                onClick={() => {
                  if (runWorkflow.inputs.some((input) => input.required && !String(runInputs[input.id] ?? "").trim())) return;
                  sendEvent({
                    type: "miniworkflow.replay",
                    payload: { workflowId: runWorkflow.id, inputs: runInputs, cwd: activeSession?.cwd, model: runModel || undefined }
                  });
                  setRunWorkflow(null);
                }}
              >
                Запустить
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteWorkflowCandidate && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-ink-900/10 bg-white p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-ink-800">Удалить workflow</h3>
            <p className="mt-2 text-sm text-ink-700">
              Удалить workflow "{deleteWorkflowCandidate.name}"? Это действие необратимо.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-ink-900/10 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-100"
                onClick={() => setDeleteWorkflowCandidate(null)}
              >
                Отмена
              </button>
              <button
                className="rounded-lg bg-error px-3 py-1.5 text-xs text-white hover:bg-error/90"
                onClick={() => {
                  sendEvent({
                    type: "miniworkflow.delete",
                    payload: { workflowId: deleteWorkflowCandidate.id, scope: "both", cwd: activeSession?.cwd }
                  });
                  setDeleteWorkflowCandidate(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {globalError && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-error/20 bg-error-light px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-sm text-error">{globalError}</span>
            <button className="text-error hover:text-error/80" onClick={() => setGlobalError(null)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {showFileBrowser && activeSession?.cwd && (
        <FileBrowser 
          cwd={activeSession.cwd} 
          onClose={() => setShowFileBrowser(false)} 
        />
      )}

      <AppFooter workflowPanelOpen={showWorkflowPanel} />
    </div>
    </I18nProvider>
  );
}

export default App;
