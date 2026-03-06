import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { useIPC } from "./hooks/useIPC";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent, ApiSettings, MiniWorkflow, MiniWorkflowSummary } from "./types";
import { detectPermissions } from "./types";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModal } from "./components/StartSessionModal";
import { SessionEditModal } from "./components/SessionEditModal";
import { TaskDialog } from "./components/TaskDialog";
import { RoleGroupDialog } from "./components/RoleGroupDialog";
import { SettingsModal } from "./components/SettingsModal";
import { FileBrowser } from "./components/FileBrowser";
import { PromptInput, usePromptActions } from "./components/PromptInput";
import { MessageCard } from "./components/EventCard";
import { AppFooter } from "./components/AppFooter";
import { TodoPanel } from "./components/TodoPanel";
import MDContent from "./render/markdown";
import { getPlatform } from "./platform";
import { basenameFsPath } from "./platform/fs-path";

function App() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const partialMessageRef = useRef("");
  const [partialMessage, setPartialMessage] = useState("");
  const [showPartialMessage, setShowPartialMessage] = useState(false);
  const isUserScrolledUpRef = useRef(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
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
    if (event.type === "miniworkflow.distill.result") {
      setDistillLoading(false);
      setDistillUsage(event.payload.usage || null);
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
  const { handleStartFromModal } = usePromptActions(sendEvent);


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

  // Check if API key or LLM providers are configured on first load
  useEffect(() => {
    // Wait until both settings AND llm providers are loaded from backend
    if (!settingsLoaded || !llmProvidersLoaded) return;
    
    // Check if we have any enabled models from LLM providers (enabled !== false)
    const hasEnabledModels = llmModels.some(m => m.enabled !== false);
    
    // If we have enabled models from LLM providers, we're good - don't open Settings
    if (hasEnabledModels) {
      console.log('[App] LLM providers with enabled models found:', llmModels.length, 'models');
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
    }
  }, [apiSettings, settingsLoaded, llmProvidersLoaded, llmModels, setShowStartModal]);

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
    setDistillSessionId(activeSessionId);
    setDistillLoading(true);
    setDistillWorkflow(null);
    setDistillError(null);
    setDistillQuestions([]);
    setDistillUsage(null);
    sendEvent({ type: "miniworkflow.distill", payload: { sessionId: activeSessionId } });
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
        <div 
          className="flex items-center justify-between h-12 min-h-[48px] border-b border-ink-900/10 bg-surface-cream select-none px-4 gap-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 flex-shrink-0" />
          <span className="text-sm font-medium text-ink-700 truncate flex-shrink min-w-0">{activeSession?.title || "ValeDesk"}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Edit session button */}
            {activeSessionId && (
              <button
                onClick={() => setShowSessionEditModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-ink-900/5 border border-ink-900/10 text-ink-600 rounded-lg hover:bg-ink-100 transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Edit session settings"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            {/* Auto scroll toggle */}
            <button
              onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                autoScrollEnabled
                  ? 'bg-info/10 border-info/30 text-info'
                  : 'bg-ink-900/5 border-ink-900/10 text-ink-500'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={autoScrollEnabled ? 'Auto scroll enabled' : 'Auto scroll disabled'}
            >
              <svg className={`w-4 h-4 transition-transform ${autoScrollEnabled ? 'text-info' : 'text-ink-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>Auto Scroll</span>
            </button>
            <button
              onClick={() => setShowWorkflowPanel((v) => !v)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showWorkflowPanel
                  ? "bg-accent/10 border-accent/30 text-accent"
                  : "bg-ink-900/5 border-ink-900/10 text-ink-600"
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title="Mini-workflows"
            >
              📋 Workflows
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
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title="Set workspace folder to enable file operations"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                Set Workspace Folder
              </button>
            )}
            {activeSession?.cwd && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowFileBrowser(!showFileBrowser)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono bg-white border rounded-l-lg transition-colors max-w-xs ${
                    showFileBrowser 
                      ? 'text-accent border-accent/30 bg-accent/5' 
                      : 'text-ink-600 border-ink-900/10 hover:bg-ink-50 hover:text-ink-900'
                  }`}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={activeSession.cwd}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate">{basenameFsPath(activeSession.cwd)}</span>
                </button>
                <button
                  onClick={() => {
                    void getPlatform()
                      .invoke('open-path-in-finder', activeSession.cwd)
                      .catch((error) => console.error('[App] open-path-in-finder failed', { error, path: activeSession.cwd }));
                  }}
                  className="flex items-center justify-center w-8 h-8 text-ink-600 bg-white border border-l-0 border-ink-900/10 rounded-r-lg hover:bg-ink-50 hover:text-ink-900 transition-colors"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title="Open in file manager"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>
            )}
            <button
              onClick={() => {
                const newMode = apiSettings?.permissionMode === 'ask' ? 'default' : 'ask';
                const newSettings = { ...apiSettings, permissionMode: newMode } as ApiSettings;
                sendEvent({ type: 'settings.save', payload: { settings: newSettings } });
                setApiSettings(newSettings);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                apiSettings?.permissionMode === 'ask'
                  ? 'bg-ink-100 border-ink-300 text-ink-700'
                  : 'bg-success/10 border-success/30 text-success'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={apiSettings?.permissionMode === 'ask' ? 'Ask before each tool' : 'Auto-execute tools'}
            >
              <span className={`w-2 h-2 rounded-full ${
                apiSettings?.permissionMode === 'ask' ? 'bg-ink-400' : 'bg-success'
              }`}></span>
              {apiSettings?.permissionMode === 'ask' ? 'Ask Mode' : 'Auto Mode'}
            </button>
          </div>
        </div>

        <div ref={messagesContainerRef} id="messages-container" className={`flex-1 overflow-y-auto overflow-x-hidden px-8 pt-6 min-w-0 ${activeSession?.todos && activeSession.todos.length > 0 ? 'pb-4' : 'pb-40'}`}>
          <div className="mx-auto w-full max-w-4xl min-w-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="text-lg font-medium text-ink-700">No messages yet</div>
                <p className="mt-2 text-sm text-muted">Start a conversation with Claude Code</p>
              </div>
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
        className={`fixed inset-y-0 right-0 z-30 w-[320px] border-l border-ink-900/10 bg-surface px-3 pt-12 pb-3 overflow-y-auto transition-transform duration-200 ease-out ${
          showWorkflowPanel ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-700">Mini-workflows</h3>
            <button
              type="button"
              className="rounded-lg border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
              onClick={() => setShowWorkflowPanel(false)}
            >
              ✕
            </button>
          </div>
          <input
            className="mb-3 w-full rounded-lg border border-ink-900/10 px-2.5 py-1.5 text-xs"
            placeholder="🔍 Filter by name/tags..."
            value={workflowFilter}
            onChange={(e) => setWorkflowFilter(e.target.value)}
          />
          {miniWorkflows.length === 0 ? (
            <div className="rounded-lg border border-ink-900/10 bg-white p-3 text-xs text-muted">
              Пока нет опубликованных workflow.
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
                      <div className="text-[11px] text-muted">v{wf.version} • inputs: {wf.inputs_count}</div>
                    </div>
                    <div className="relative">
                      <button
                        className="rounded-md border border-ink-900/10 px-2 py-1 text-[11px] text-ink-600 hover:bg-ink-100"
                        onClick={() => setOpenWorkflowMenuId((prev) => prev === wf.id ? null : wf.id)}
                      >
                        ⋯
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
                            Редактировать
                          </button>
                          <button
                            className="block w-full rounded px-2 py-1 text-left text-xs text-ink-700 hover:bg-ink-100"
                            onClick={() => {
                              sendEvent({ type: "miniworkflow.archive", payload: { workflowId: wf.id, cwd: activeSession?.cwd } });
                              setOpenWorkflowMenuId(null);
                            }}
                          >
                            Архивировать
                          </button>
                          <button
                            className="block w-full rounded px-2 py-1 text-left text-xs text-error hover:bg-error/10"
                            onClick={() => {
                              setDeleteWorkflowCandidate(wf);
                              setOpenWorkflowMenuId(null);
                            }}
                          >
                            Удалить
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
                      Запустить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </aside>

      {showStartModal && (
        <StartSessionModal
          cwd={cwd}
          prompt={prompt}
          pendingStart={pendingStart}
          onCwdChange={setCwd}
          onPromptChange={setPrompt}
          onStart={handleStartFromModal}
          onClose={() => setShowStartModal(false)}
          apiSettings={apiSettings}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          llmModels={llmModels}
          temperature={selectedTemperature}
          onTemperatureChange={setSelectedTemperature}
          sendTemperature={sendTemperature}
          onSendTemperatureChange={setSendTemperature}
        />
      )}

      {showTaskDialog && (
        <TaskDialog
          cwd={cwd}
          onClose={() => setShowTaskDialog(false)}
          onCreateTask={handleCreateTask}
          apiSettings={apiSettings}
          availableModels={availableModels}
          llmModels={llmModels}
        />
      )}

      {showRoleGroupDialog && (
        <RoleGroupDialog
          cwd={cwd}
          onClose={() => setShowRoleGroupDialog(false)}
          onCreateTask={handleCreateRoleGroupTask}
          apiSettings={apiSettings}
          availableModels={availableModels}
          llmModels={llmModels}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          currentSettings={apiSettings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {showSessionEditModal && activeSessionId && activeSession && (
        <SessionEditModal
          currentModel={activeSession.model}
          currentTemperature={activeSession.temperature}
          currentTitle={activeSession.title}
          llmModels={llmModels}
          onSave={(updates) => {
            sendEvent({
              type: "session.update",
              payload: {
                sessionId: activeSessionId,
                ...updates
              }
            });
          }}
          onClose={() => setShowSessionEditModal(false)}
        />
      )}

      {distillSessionId && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl border border-ink-900/10 bg-white p-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-800">Distill Mini-workflow</h3>
              <button
                className="rounded-md border border-ink-900/10 px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
                onClick={() => {
                  setDistillSessionId(null);
                  setDistillWorkflow(null);
                }}
              >
                Close
              </button>
            </div>
            {distillUsage && (
              <div className="mb-2 flex items-center gap-3 text-xs text-ink-500">
                <span>Tokens: <span className="font-medium text-ink-700">{distillUsage.input_tokens.toLocaleString()}</span> in</span>
                <span>/ <span className="font-medium text-ink-700">{distillUsage.output_tokens.toLocaleString()}</span> out</span>
                <span>= <span className="font-medium text-ink-700">{(distillUsage.input_tokens + distillUsage.output_tokens).toLocaleString()}</span> total</span>
              </div>
            )}
            {distillLoading && (
              <div className="rounded-lg border border-ink-900/10 bg-surface p-4 text-sm text-ink-700">
                Анализирую сессию...
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
                        onClick={() => {
                          if (!activeSessionId) return;
                          setDistillLoading(true);
                          setDistillError(null);
                          sendEvent({
                            type: "miniworkflow.distill",
                            payload: {
                              sessionId: activeSessionId,
                              validationErrors: distillQuestions
                            }
                          });
                        }}
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
                      onChange={(e) => setDistillWorkflow({ ...distillWorkflow, name: e.target.value })}
                    />
                  </label>
                  <label className="text-xs text-ink-700">
                    Description
                    <input
                      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                      value={distillWorkflow.description}
                      onChange={(e) => setDistillWorkflow({ ...distillWorkflow, description: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-xs text-ink-700">
                  Goal
                  <textarea
                    className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
                    rows={3}
                    value={distillWorkflow.goal}
                    onChange={(e) => setDistillWorkflow({ ...distillWorkflow, goal: e.target.value })}
                  />
                </label>
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
                              setDistillWorkflow({ ...distillWorkflow, inputs: next });
                            }}
                          />
                          <input
                            className="col-span-4 rounded border border-ink-900/10 px-2 py-1 text-xs"
                            value={input.title}
                            onChange={(e) => {
                              const next = [...distillWorkflow.inputs];
                              next[index] = { ...next[index], title: e.target.value };
                              setDistillWorkflow({ ...distillWorkflow, inputs: next });
                            }}
                          />
                          <select
                            className="col-span-3 rounded border border-ink-900/10 px-2 py-1 text-xs"
                            value={input.type}
                            onChange={(e) => {
                              const next = [...distillWorkflow.inputs];
                              next[index] = { ...next[index], type: e.target.value as any };
                              setDistillWorkflow({ ...distillWorkflow, inputs: next });
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
                                setDistillWorkflow({ ...distillWorkflow, inputs: next });
                              }}
                            />
                            req
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-ink-900/10 p-3">
                  {(() => {
                    const steps = distillWorkflow.chain || [];
                    const scriptCount = steps.filter((s: any) => s.execution === "script").length;
                    const llmCount = steps.length - scriptCount;
                    return (
                      <div className="text-xs font-semibold text-ink-700 mb-2">
                        Chain ({steps.length} steps{scriptCount > 0 ? ` — ${scriptCount} script, ${llmCount} LLM` : ""})
                      </div>
                    );
                  })()}
                  <ol className="list-decimal pl-4 space-y-1">
                    {(distillWorkflow.chain || []).map((step: any) => (
                      <li key={step.id} className="text-xs text-ink-600">
                        {step.execution === "script" ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="px-1 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">script</span>
                            {step.title}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium">LLM</span>
                            {step.title}
                          </span>
                        )}
                        <span className="text-muted ml-1">[{(step.tools || []).join(", ") || "no tools"}]</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {distillWorkflow.validation?.acceptance_criteria && (
                  <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                    <div className="text-xs font-semibold text-ink-700 mb-1">Acceptance Criteria</div>
                    <div className="text-xs text-ink-600">{distillWorkflow.validation.acceptance_criteria}</div>
                  </div>
                )}
                {/* Permissions detected from chain steps */}
                {(() => {
                  const perms = detectPermissions(distillWorkflow.chain || []);
                  const badges: { label: string; icon: string; active: boolean; tooltip: string }[] = [
                    { label: "Network", icon: "🌐", active: perms.network, tooltip: perms.reasons.filter(r => r.permission === "network").map(r => r.reason).join(", ") || "no network access" },
                    { label: "File System", icon: "📁", active: perms.local_fs, tooltip: perms.reasons.filter(r => r.permission === "local_fs").map(r => r.reason).join(", ") || "no fs access" },
                    { label: "Git", icon: "🔀", active: perms.git, tooltip: perms.reasons.filter(r => r.permission === "git").map(r => r.reason).join(", ") || "no git access" },
                  ];
                  return (
                    <div className="rounded-lg border border-ink-900/10 p-3">
                      <div className="text-xs font-semibold text-ink-700 mb-2">Permissions</div>
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
                    </div>
                  );
                })()}
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover"
                    onClick={() => {
                      sendEvent({
                        type: "miniworkflow.save",
                        payload: {
                          workflow: { ...distillWorkflow, status: "published" },
                          scope: activeSession?.cwd ? "project" : "global",
                          cwd: activeSession?.cwd
                        }
                      });
                      setDistillSessionId(null);
                      setDistillWorkflow(null);
                    }}
                  >
                    Publish
                  </button>
                  <button
                    className="rounded-lg border border-ink-900/20 bg-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-200"
                    onClick={() => {
                      sendEvent({
                        type: "miniworkflow.save",
                        payload: {
                          workflow: { ...distillWorkflow, status: "draft" },
                          scope: activeSession?.cwd ? "project" : "global",
                          cwd: activeSession?.cwd
                        }
                      });
                      setDistillSessionId(null);
                      setDistillWorkflow(null);
                    }}
                  >
                    Save as draft
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>
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

      <AppFooter />
    </div>
  );
}

export default App;
