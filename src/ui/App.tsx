import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { useIPC } from "./hooks/useIPC";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent, ApiSettings } from "./types";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModal } from "./components/StartSessionModal";
import { SessionEditModal } from "./components/SessionEditModal";
import { TaskDialog } from "./components/TaskDialog";
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
  const [showTaskDialog, setShowTaskDialog] = useState(false);
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
  }, [handleServerEvent, handlePartialMessages]);

  const { connected, sendEvent } = useIPC(onEvent);
  const { handleStartFromModal } = usePromptActions(sendEvent);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSession?.messages ?? [];
  const permissionRequests = activeSession?.permissionRequests ?? [];
  const isRunning = activeSession?.status === "running";

  useEffect(() => {
    if (connected) {
      sendEvent({ type: "session.list" });
      sendEvent({ type: "settings.get" });
      sendEvent({ type: "models.get" });
      sendEvent({ type: "llm.providers.get" });
    }
  }, [connected, sendEvent]);

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

  return (
    <div className="flex h-screen bg-surface">
      <Sidebar
        connected={connected}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenTaskDialog={() => setShowTaskDialog(true)}
        apiSettings={apiSettings}
      />

      <main className="flex flex-1 flex-col ml-[280px] bg-surface-cream overflow-hidden">
        <div 
          className="flex items-center justify-between h-12 min-h-[48px] border-b border-ink-900/10 bg-surface-cream select-none px-4 gap-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 flex-shrink-0" />
          <span className="text-sm font-medium text-ink-700 truncate flex-shrink min-w-0">{activeSession?.title || "LocalDesk"}</span>
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

        <PromptInput sendEvent={sendEvent} />
      </main>

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
