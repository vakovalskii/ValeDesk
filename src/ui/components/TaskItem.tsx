import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { MultiThreadTask, SessionInfo, TaskMode } from "../types";

interface TaskItemProps {
  task: MultiThreadTask;
  sessions: Record<string, SessionInfo>;
  onSelectSession: (sessionId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onRenameTask?: (taskId: string, newTitle: string) => void;
  sendEvent: (event: any) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function TaskItem({
  task,
  sessions,
  onSelectSession,
  onDeleteTask,
  onRenameTask,
  sendEvent,
  isCollapsed = false,
  onToggleCollapse
}: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);

  const threads = task.threadIds.map(id => sessions[id]).filter(Boolean);
  const runningCount = threads.filter(t => t?.status === "running").length;
  const completedCount = threads.filter(t => t?.status === "completed").length;
  const errorCount = threads.filter(t => t?.status === "error").length;
  const totalCount = threads.length;

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

  const getTaskModeLabel = (mode: TaskMode) => {
    if (mode === "consensus") return "Consensus";
    if (mode === "role_group") return "Role Group";
    return "Different Tasks";
  };

  const handleRename = () => {
    if (editTitle.trim() && editTitle !== task.title && onRenameTask) {
      onRenameTask(task.id, editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRename();
    } else if (e.key === 'Escape') {
      setEditTitle(task.title);
      setIsEditing(false);
    }
  };

  return (
    <div className="w-full rounded-lg border border-ink-200 hover:border-ink-300 transition-all duration-200">
      {/* Main task item - always visible */}
      <div 
        className={`w-full px-3 py-2.5 cursor-pointer transition-colors ${
          isCollapsed 
            ? 'hover:bg-ink-50/50' 
            : 'bg-surface/50 hover:bg-surface'
        }`}
        onClick={onToggleCollapse}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Chevron for expand/collapse */}
            <svg 
              className={`w-4 h-4 text-ink-400 transition-transform duration-200 flex-shrink-0 ${
                isCollapsed ? '' : 'rotate-90'
              }`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

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

            {/* Task title or input */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-1 py-0.5 text-sm bg-white border border-ink-300 rounded focus:outline-none focus:border-accent"
                  autoFocus
                />
              ) : (
                <span className="text-sm font-medium text-ink-800 truncate">
                  {task.title}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Status badges */}
            {isCreated && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sendEvent({ type: 'task.start', payload: { taskId: task.id } });
                }}
                className="text-xs font-medium px-2 py-1 bg-warning text-white rounded hover:bg-warning/80 transition-colors"
                title="Start all threads"
              >
                ▶ Start
              </button>
            )}
            
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="p-1 text-ink-400 hover:text-ink-600 transition-colors"
                  title="More options"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="bg-white border border-ink-200 rounded-md shadow-lg p-1 z-50"
                  side="bottom"
                  align="end"
                >
                  <DropdownMenu.Item
                    className="px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 cursor-pointer rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditing(true);
                    }}
                  >
                    Rename
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTask(task.id);
                    }}
                  >
                    Delete
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        {/* Brief status info */}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted">
          {isCreated ? (
            <span>{totalCount} threads ready</span>
          ) : (
            <>
              <span>{completedCount}/{totalCount} done</span>
              {runningCount > 0 && <span>• {runningCount} running</span>}
              {errorCount > 0 && <span>• {errorCount} errors</span>}
            </>
          )}
          {totalTokens > 0 && (
            <span>• {totalTokens.toLocaleString()} tokens</span>
          )}
        </div>

        {/* Progress bar - hide when created */}
        {!isCreated && (
          <div className="mt-2 h-1 bg-ink-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isCompleted ? 'bg-success' : isRunning ? 'bg-info' : 'bg-ink-300'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Expanded content */}
      {!isCollapsed && (
        <div className="border-t border-ink-200 bg-surface/30 px-3 py-2">
          {/* Mode badges */}
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-accent/10 text-accent">
              {getTaskModeLabel(task.mode)}
            </span>
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
            <div className="text-[10px] font-medium text-ink-500 mb-1 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Threads
            </div>
            {threads.map((thread) => {
              const isSummaryThread = thread.id === task.summaryThreadId;
              return (
                <button
                  key={thread.id}
                  onClick={() => onSelectSession(thread.id)}
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
                      <span className={`text-xs truncate ${
                        isSummaryThread ? 'text-purple-700 font-medium' : 'text-ink-600'
                      }`}>
                        {isSummaryThread ? '📋 Summary' : thread.model || 'Unknown'}
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