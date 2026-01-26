import { useState } from "react";
import type { MultiThreadTask, SessionInfo, TaskMode } from "../types";

interface MultiThreadTaskItemProps {
  task: MultiThreadTask;
  sessions: Record<string, SessionInfo>;
  onSelectSession: (sessionId: string) => void;
  onDeleteTask: (taskId: string) => void;
  sendEvent: (event: any) => void;
  isActive?: boolean;
}

export function MultiThreadTaskItem({
  task,
  sessions,
  onSelectSession,
  onDeleteTask,
  sendEvent,
  isActive = false
}: MultiThreadTaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const threads = task.threadIds.map(id => sessions[id]).filter(Boolean);
  const runningCount = threads.filter(t => t?.status === "running").length;
  const completedCount = threads.filter(t => t?.status === "completed").length;
  const errorCount = threads.filter(t => t?.status === "error").length;
  const totalCount = threads.length;

  // Calculate total tokens for this task
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

  const getTaskModeLabel = (mode: TaskMode) => {
    if (mode === "consensus") return "Consensus";
    if (mode === "role_group") return "Roles";
    return "Multi";
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5">
      {/* Main task item - always visible */}
      <div
        className={`cursor-pointer rounded-xl px-2 py-3 text-left transition ${
          isActive ? "border-accent/50 bg-accent/10" : "hover:bg-accent/10"
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIsExpanded(!isExpanded); } }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
            {/* Status indicator */}
            <span className="flex-shrink-0">
              {isCreated && (
                <span className="w-3.5 h-3.5 rounded-full bg-warning" title="Ready to start" />
              )}
              {isRunning && (
                <span className="w-3.5 h-3.5 rounded-full bg-info animate-pulse" />
              )}
              {isCompleted && (
                <span className="w-3.5 h-3.5 rounded-full bg-success" />
              )}
            </span>

            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-1.5">
                <div className={`text-[12px] font-medium truncate text-accent`}>
                  {task.title}
                </div>
                <svg
                  className={`w-3 h-3 text-accent/60 transition-transform flex-shrink-0 ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              
              <div className="flex items-center justify-between mt-0.5 text-xs text-muted">
                <span>
                  {isCreated
                    ? `${totalCount} threads ready`
                    : `${completedCount}/${totalCount} threads done`
                  }
                </span>
                <div className="flex items-center gap-2">
                  {/* Mode badge */}
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                    {getTaskModeLabel(task.mode)}
                  </span>
                  {totalTokens > 0 && (
                    <span className="text-[10px] text-muted bg-ink-100 px-1.5 py-0.5 rounded-full">
                      {totalTokens.toLocaleString()} tokens
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Status text */}
            {isCreated && (
              <span className="text-warning text-xs font-medium px-2 py-1 bg-warning/10 rounded">
                Ready
              </span>
            )}
            {isRunning && (
              <span className="text-info text-xs font-medium">
                {runningCount} running...
              </span>
            )}
            {isCompleted && (
              <span className="text-success text-xs font-medium">
                ✓ Complete
              </span>
            )}
            {errorCount > 0 && (
              <span className="text-error text-xs font-medium">
                {errorCount} errors
              </span>
            )}
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

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-accent/20 bg-accent/5 px-3 py-3">
          {/* Action buttons */}
          <div className="flex items-center gap-2 mb-3">
            {isCreated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sendEvent({ type: 'task.start', payload: { taskId: task.id } });
                }}
                className="text-xs font-medium px-2 py-1 bg-warning text-white rounded hover:bg-warning/80 transition-colors"
              >
                ▶ Start All Threads
              </button>
            )}
            
            {/* Additional info badges */}
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
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteTask(task.id);
              }}
              className="text-xs text-muted hover:text-error transition-colors ml-auto"
              title="Remove task"
            >
              Delete
            </button>
          </div>

          {/* Thread list */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-ink-500 mb-2 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Threads working together
            </div>
            {threads.map((thread) => {
              const isSummaryThread = thread.id === task.summaryThreadId;
              return (
                <button
                  key={thread.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSession(thread.id);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-50 transition-colors text-left ${
                    isSummaryThread ? 'bg-purple-50 border border-purple-200' : 'bg-white/50'
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
                    <div className="flex items-center justify-between">
                      <span className={`text-xs truncate ${isSummaryThread ? 'text-purple-700 font-medium' : 'text-ink-600'}`}>
                        {isSummaryThread ? '📋 Summary' : thread.model || 'Unknown'}
                      </span>
                      <span className="text-[10px] text-muted">
                        {((thread.inputTokens || 0) + (thread.outputTokens || 0)).toLocaleString()} tokens
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}