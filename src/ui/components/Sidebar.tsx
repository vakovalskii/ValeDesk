import { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useAppStore } from "../store/useAppStore";
import { SpinnerIcon } from "./SpinnerIcon";
import type { ApiSettings, TaskMode } from "../types";

interface SidebarProps {
  connected: boolean;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenTaskDialog: () => void;
  onOpenRoleGroupDialog: () => void;
  apiSettings: ApiSettings | null;
}

export function Sidebar({
  onNewSession,
  onDeleteSession,
  onOpenSettings,
  onOpenTaskDialog,
  onOpenRoleGroupDialog,
  apiSettings
}: SidebarProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const setActiveSessionId = useAppStore((state) => state.setActiveSessionId);
  const sendEvent = useAppStore((state) => state.sendEvent);
  const multiThreadTasks = useAppStore((state) => state.multiThreadTasks);
  const deleteMultiThreadTask = useAppStore((state) => state.deleteMultiThreadTask);
  const [searchQuery, setSearchQuery] = useState("");


  const formatCwd = (cwd?: string) => {
    if (!cwd) return "Working dir unavailable";
    const parts = cwd.split(/[\\/]+/).filter(Boolean);
    const tail = parts.slice(-2).join("/");
    return `/${tail || cwd}`;
  };

  const formatNumberWithSpaces = (num: number | undefined): string => {
    if (num === undefined) return "0";
    return num.toLocaleString("ru-RU", { useGrouping: true });
  };

  const getTaskModeLabel = (mode: TaskMode) => {
    if (mode === "consensus") return "Consensus";
    if (mode === "role_group") return "Roles";
    return "Multi";
  };

  // Extract model name from full ID (provider::model -> model)
  const getModelDisplayName = (modelId: string | undefined): string => {
    if (!modelId) return '';
    // If it contains ::, take the part after it
    if (modelId.includes('::')) {
      return modelId.split('::')[1] || modelId;
    }
    return modelId;
  };

  const sessionList = useMemo(() => {
    let sessionsList = Object.values(sessions);
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      sessionsList = sessionsList.filter(session => 
        session.title.toLowerCase().includes(query) ||
        session.cwd?.toLowerCase().includes(query)
      );
    }
    
    // Sort sessions: pinned first, then by updatedAt
    sessionsList.sort((a, b) => {
      const aPinned = a.isPinned || false;
      const bPinned = b.isPinned || false;
      
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    
    return sessionsList;
  }, [sessions, searchQuery]);

  const filteredMultiThreadTasks = useMemo(() => {
    let multiThreadList = Object.values(multiThreadTasks);
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      multiThreadList = multiThreadList.filter(task => 
        task.title.toLowerCase().includes(query)
      );
    }
    
    // Sort multi-thread tasks by updatedAt
    return multiThreadList.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [multiThreadTasks, searchQuery]);

  const togglePin = (sessionId: string) => {
    const session = sessions[sessionId];
    if (!session) return;
    
    const newPinnedState = !session.isPinned;
    sendEvent({ type: 'session.pin', payload: { sessionId, isPinned: newPinnedState } });
  };


  return (
    <aside className="fixed inset-y-0 left-0 flex h-full w-[280px] flex-col gap-4 border-r border-ink-900/5 bg-[#FAF9F6] px-4 pb-4 pt-12">
      <div 
        className="absolute top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex gap-2">
        <Tooltip.Provider>
          <Tooltip.Root delayDuration={200}>
            <Tooltip.Trigger asChild>
              <button
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border border-ink-900/10 bg-surface text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20 transition-colors"
                onClick={onNewSession}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-[100] rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg"
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
              >
                New Task
                <Tooltip.Arrow className="fill-white" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>

        <Tooltip.Provider>
          <Tooltip.Root delayDuration={200}>
            <Tooltip.Trigger asChild>
              <button
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                onClick={onOpenTaskDialog}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                </svg>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-[100] rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg"
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
              >
                Multi-Thread
                <Tooltip.Arrow className="fill-white" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>

        <Tooltip.Provider>
          <Tooltip.Root delayDuration={200}>
            <Tooltip.Trigger asChild>
              <button
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border border-info/30 bg-info/10 text-info hover:bg-info/20 transition-colors"
                onClick={onOpenRoleGroupDialog}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M7 21v-2a4 4 0 0 1 3-3.87" />
                  <circle cx="12" cy="7" r="3" />
                  <path d="M5.5 12.5A3 3 0 1 1 7 6.4" />
                  <path d="M18.5 12.5A3 3 0 1 0 17 6.4" />
                </svg>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-[100] rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg"
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
              >
                Role Group
                <Tooltip.Arrow className="fill-white" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>

        <div className="flex-1" />

        <Tooltip.Provider>
          <Tooltip.Root delayDuration={200}>
            <Tooltip.Trigger asChild>
              <button
                className="flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border border-ink-900/10 bg-surface text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20 transition-colors"
                onClick={onOpenSettings}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
                </svg>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-[100] rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg"
                side="bottom"
                align="center"
                sideOffset={8}
                collisionPadding={12}
              >
                API Settings
                <Tooltip.Arrow className="fill-white" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-ink-900/10 bg-surface pl-9 pr-4 py-2 text-sm text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth="2"/>
          <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto">
        {sessionList.length === 0 && filteredMultiThreadTasks.length === 0 && (
          <div className="rounded-xl border border-ink-900/5 bg-surface px-4 py-5 text-center text-xs text-muted">
            No sessions yet. Start by sending a prompt.
          </div>
        )}
        
        {/* Multi-Thread Tasks - integrated into main list */}
        {filteredMultiThreadTasks.map((task) => {
            const threads = task.threadIds.map(id => sessions[id]).filter(Boolean);
            const runningCount = threads.filter(t => t?.status === "running").length;
            const completedCount = threads.filter(t => t?.status === "completed").length;
            const errorCount = threads.filter(t => t?.status === "error").length;
            const totalCount = threads.length;
            
            const isExpanded = expandedTasks.has(task.id);
            
            // Calculate total tokens for this task (threads + summary)
            const threadInputTokens = threads.reduce((sum, t) => sum + (t?.inputTokens || 0), 0);
            const threadOutputTokens = threads.reduce((sum, t) => sum + (t?.outputTokens || 0), 0);
            const summaryInputTokens = task.summaryThreadId
              ? (sessions[task.summaryThreadId]?.inputTokens || 0)
              : 0;
            const summaryOutputTokens = task.summaryThreadId
              ? (sessions[task.summaryThreadId]?.outputTokens || 0)
              : 0;
            const totalInputTokens = threadInputTokens + summaryInputTokens;
            const totalOutputTokens = threadOutputTokens + summaryOutputTokens;
            const totalTokens = totalInputTokens + totalOutputTokens;
            
            const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
            const isCreated = task.status === 'created';
            const isRunning = task.status === 'running' || runningCount > 0;
            const isCompleted = task.status === 'completed';
            
            return (
              <div
                key={`mt-${task.id}`}
                className={`cursor-pointer rounded-xl border transition-all ${
                  isCompleted
                    ? "border-success/30 bg-success/5"
                    : isRunning
                      ? "border-info/30 bg-info/5"
                      : isCreated
                        ? "border-warning/30 bg-warning/5"
                        : "border-ink-900/10 bg-surface hover:bg-surface-tertiary"
                }`}
                onClick={() => setExpandedTasks(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(task.id)) {
                    newSet.delete(task.id);
                  } else {
                    newSet.add(task.id);
                  }
                  return newSet;
                })}
                onKeyDown={(e) => { 
                  if (e.key === "Enter" || e.key === " ") { 
                    e.preventDefault(); 
                    setExpandedTasks(prev => {
                      const newSet = new Set(prev);
                      if (newSet.has(task.id)) {
                        newSet.delete(task.id);
                      } else {
                        newSet.add(task.id);
                      }
                      return newSet;
                    });
                  } 
                }}
                role="button"
                tabIndex={0}
              >
                {/* Main content - always visible */}
                <div className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                      {/* Status indicator */}
                      {isCreated && (
                        <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" title="Ready to start" />
                      )}
                      {isRunning && (
                        <span className="w-2 h-2 rounded-full bg-info animate-pulse flex-shrink-0" />
                      )}
                      {isCompleted && (
                        <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
                      )}
                      
                      {/* Expand/collapse arrow */}
                      <svg
                        className={`w-3.5 h-3.5 text-ink-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      
                      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <div className={`text-sm font-medium truncate ${
                            isCompleted ? "text-success" : isRunning ? "text-info" : isCreated ? "text-warning" : "text-ink-800"
                          }`}>
                            {task.title}
                          </div>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-accent/10 text-accent whitespace-nowrap">
                            {getTaskModeLabel(task.mode)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5 text-xs text-muted">
                          <span className="truncate">
                            {isCreated
                              ? `${totalCount} threads ready`
                              : `${completedCount}/${totalCount} threads done`
                            }
                          </span>
                          {totalTokens > 0 && (
                            <span className="text-[10px] text-muted bg-ink-100 px-1.5 py-0.5 rounded-full whitespace-nowrap ml-2">
                              {totalTokens.toLocaleString()} tokens
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      {/* Action buttons */}
                      {isCreated && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            sendEvent({ type: 'task.start', payload: { taskId: task.id } });
                          }}
                          className="text-xs font-medium px-2 py-1 bg-warning text-white rounded hover:bg-warning/80 transition-colors flex-shrink-0"
                          title="Start all threads"
                        >
                          ▶
                        </button>
                      )}
                      
                      {isRunning && (
                        <span className="text-xs text-info font-medium flex-shrink-0">
                          {runningCount} running...
                        </span>
                      )}
                      
                      {isCompleted && (
                        <span className="text-xs text-success font-medium flex-shrink-0">
                          ✓ Complete
                        </span>
                      )}
                      
                      {errorCount > 0 && (
                        <span className="text-xs text-error font-medium flex-shrink-0">
                          {errorCount} errors
                        </span>
                      )}
                      
                      {/* Delete button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMultiThreadTask(task.id);
                        }}
                        className="flex-shrink-0 rounded-full p-1.5 text-ink-400 hover:text-error hover:bg-ink-900/5"
                        aria-label="Delete multi-thread task"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l1-12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* Progress bar - hide when created */}
                  {!isCreated && (
                    <div className="mt-2 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isCompleted
                            ? 'bg-success'
                            : isRunning
                              ? 'bg-info'
                              : 'bg-ink-300'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                
                {/* Expanded content - threads */}
                {isExpanded && (
                  <div className="border-t border-ink-200 bg-surface/50">
                    <div className="px-3 py-2">
                      {/* Badges */}
                      <div className="flex items-center gap-1 mb-2">
                        {task.shareWebCache && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-ink-100 text-ink-600">
                            Shared Cache
                          </span>
                        )}
                        {task.autoSummary && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-purple-100 text-purple-600">
                            Auto-Summary
                          </span>
                        )}
                      </div>
                      
                      {/* Threads list */}
                      <div className="space-y-1">
                        {threads.map((thread) => {
                          const isSummaryThread = thread.id === task.summaryThreadId;
                          return (
                            <button
                              key={thread.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveSessionId(thread.id);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-50 transition-colors text-left ${
                                isSummaryThread ? 'bg-purple-50 border border-purple-200' : ''
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  thread.status === 'running'
                                    ? 'bg-info animate-pulse'
                                    : thread.status === 'completed'
                                      ? 'bg-success'
                                      : thread.status === 'error'
                                        ? 'bg-error'
                                        : 'bg-ink-300'
                                }`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className={`text-xs truncate ${isSummaryThread ? 'text-purple-700 font-medium' : 'text-ink-600'}`}>
                                    {isSummaryThread ? '📋 Summary' : thread.model || 'Unknown'}
                                  </span>
                                </div>
                              </div>
                              {(thread.inputTokens !== undefined || thread.outputTokens !== undefined) && (
                                <span className="text-[10px] text-muted bg-ink-100 px-1 py-0.5 rounded">
                                  {((thread.inputTokens || 0) + (thread.outputTokens || 0)).toLocaleString()}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        
        {/* Regular Sessions */}
        {sessionList.map((session) => (
          <div
            key={session.id}
            className={`cursor-pointer rounded-xl border px-2 py-3 text-left transition ${
              session.isPinned 
                ? (activeSessionId === session.id ? "border-info/50 bg-info/10" : "border-info/30 bg-info/5 hover:bg-info/10")
                : (activeSessionId === session.id ? "border-accent/30 bg-accent-subtle" : "border-ink-900/5 bg-surface hover:bg-surface-tertiary")
            }`}
            onClick={() => setActiveSessionId(session.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveSessionId(session.id); } }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                {session.isPinned && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-info flex-shrink-0 fill-info" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 4l-2 10h4l-2-10z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    {session.status === "running" && (
                      <SpinnerIcon className="h-3.5 w-3.5 text-info flex-shrink-0" />
                    )}
                    <div className={`text-[12px] font-medium truncate ${session.status === "running" ? "text-info" : session.status === "completed" ? "text-success" : session.status === "error" ? "text-error" : "text-ink-800"}`}>
                      {session.title}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-xs text-muted">
                    <span className="truncate">{formatCwd(session.cwd)}</span>
                    {(session.model || apiSettings?.model) && (
                      <span className="text-[10px] text-info/80 bg-info/10 px-1.5 py-0.5 rounded whitespace-nowrap ml-2">
                        {getModelDisplayName(session.model || apiSettings?.model)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {(session.inputTokens !== undefined || session.outputTokens !== undefined) && (
                  <Tooltip.Provider>
                    <Tooltip.Root delayDuration={200}>
                      <Tooltip.Trigger asChild>
                        <button
                          className="flex-shrink-0 rounded-full p-1.5 text-ink-400 hover:text-ink-600 hover:bg-ink-900/5"
                          aria-label="View token usage"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="12" cy="17" r="1" fill="currentColor" />
                          </svg>
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content className="z-50 rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg" sideOffset={5}>
                          <div className="flex flex-col gap-1">
                            <div className="text-xs text-muted">
                              <span className="font-medium">Input:</span> {formatNumberWithSpaces(session.inputTokens)} tokens
                            </div>
                            <div className="text-xs text-muted">
                              <span className="font-medium">Output:</span> {formatNumberWithSpaces(session.outputTokens)} tokens
                            </div>
                          </div>
                          <Tooltip.Arrow className="fill-white" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                )}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="flex-shrink-0 rounded-full p-1.5 text-ink-500 hover:bg-ink-900/10" aria-label="Open session menu" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <circle cx="5" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="z-50 min-w-[220px] rounded-xl border border-ink-900/10 bg-white p-1 shadow-lg" align="center" sideOffset={8}>
                      <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => togglePin(session.id)}>
                        <svg viewBox="0 0 24 24" className={`h-4 w-4 ${session.isPinned ? 'text-info fill-info' : 'text-ink-500'}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 4l-2 10h4l-2-10z" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {session.isPinned ? 'Unpin' : 'Pin'} session
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => onDeleteSession(session.id)}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-error/80" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l1-12" />
                        </svg>
                        Delete this session
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
