/**
 * TodoPanel - Displays agent's task plan with progress bar (collapsible)
 * and file changes with Confirm/Rollback buttons
 */

import { useState } from "react";
import type { TodoItem, TodoStatus, FileChange } from "../types";
import { DiffViewerModal } from "./DiffViewerModal";
import type { ChangedFile } from "./ChangedFiles";
import { useAppStore } from "../store/useAppStore";

interface TodoPanelProps {
  todos: TodoItem[];
  fileChanges?: FileChange[];
  activeSessionId?: string | null;
  onConfirmChanges?: (sessionId: string) => void;
  onRollbackChanges?: (sessionId: string) => void;
}

const statusConfig: Record<TodoStatus, { emoji: string }> = {
  pending: { emoji: '⬜' },
  in_progress: { emoji: '🔄' },
  completed: { emoji: '✅' },
  cancelled: { emoji: '❌' }
};

export function TodoPanel({
  todos,
  fileChanges = [],
  activeSessionId,
  onConfirmChanges,
  onRollbackChanges
}: TodoPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  
  // Get cwd from store
  const sessions = useAppStore((state) => state.sessions);
  const cwd = activeSessionId ? sessions[activeSessionId]?.cwd : undefined;

  if (!todos || todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const cancelled = todos.filter(t => t.status === 'cancelled').length;
  const total = todos.length;
  const percent = Math.round((completed / total) * 100);
  const inProgress = todos.find(t => t.status === 'in_progress');
  const isAllDone = completed + cancelled === total;

  // Filter pending file changes (only these can be rolled back)
  const pendingFileChanges = fileChanges.filter(c => c.status === 'pending');
  const hasPendingChanges = pendingFileChanges.length > 0;

  // Show only 4 files by default, unless showAllFiles is true
  const visibleFileChanges = showAllFiles ? pendingFileChanges : pendingFileChanges.slice(0, 4);
  const hasMoreFiles = pendingFileChanges.length > 4;

  // Calculate total additions and deletions
  const totalAdditions = pendingFileChanges.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = pendingFileChanges.reduce((sum, c) => sum + c.deletions, 0);

  const handleConfirm = () => {
    if (activeSessionId && onConfirmChanges) {
      onConfirmChanges(activeSessionId);
    }
  };

  const handleRollback = () => {
    if (activeSessionId && onRollbackChanges) {
      onRollbackChanges(activeSessionId);
    }
  };

  // Convert FileChange to ChangedFile format
  const convertToChangedFile = (change: FileChange): ChangedFile => {
    return {
      file_path: change.path,
      lines_added: change.additions,
      lines_removed: change.deletions,
      content_old: undefined,
      content_new: undefined
    };
  };

  const handleViewDiff = (change: FileChange) => {
    const changedFile = convertToChangedFile(change);
    setSelectedFile(changedFile);
    setDiffModalOpen(true);
  };

  // Convert all fileChanges to ChangedFile[] for navigation
  const changedFiles: ChangedFile[] = fileChanges.map(convertToChangedFile);

  return (
    <div className={`border rounded-lg shadow-sm ${isAllDone ? 'bg-green-50 border-green-200' : 'bg-white border-ink-200'}`}>
      {/* Header - always visible, clickable to expand/collapse */}
      <button
        type="button"
        className="w-full flex items-center justify-between p-2.5 cursor-pointer select-none hover:bg-ink-50/50 transition-colors text-left rounded-lg"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs text-ink-400 transition-transform duration-200 inline-block flex-shrink-0"
            style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          >
            ▼
          </span>
          <span className="text-sm font-medium text-ink-700 flex-shrink-0">
            {isAllDone ? '✅ Plan Complete' : '📋 Task Plan'}
          </span>
          <span className="text-xs text-ink-500 flex-shrink-0">
            {completed}/{total}
          </span>
          {/* Show current task when collapsed */}
          {!isExpanded && inProgress && (
            <span className="text-xs text-blue-600 truncate ml-1">
              → {inProgress.content}
            </span>
          )}
          {/* Show completion message when collapsed and done */}
          {!isExpanded && isAllDone && (
            <span className="text-xs text-green-600 ml-1">
              All tasks completed!
            </span>
          )}
          {/* Show file changes summary when collapsed */}
          {!isExpanded && hasPendingChanges && (
            <span className="text-xs text-orange-600 ml-1">
              ({pendingFileChanges.length} files changed)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mini progress bar when collapsed */}
          {!isExpanded && (
            <div className="h-1.5 w-16 bg-ink-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isAllDone ? 'bg-green-500' : 'bg-green-500'}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <span className={`text-xs font-mono ${isAllDone ? 'text-green-600 font-semibold' : 'text-ink-500'}`}>{percent}%</span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <>
          {/* Progress bar */}
          <div className={`h-1.5 mx-3 mb-2 rounded-full overflow-hidden ${isAllDone ? 'bg-green-200' : 'bg-ink-100'}`}>
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="px-3 pb-3">
            {/* Completion banner */}
            {isAllDone && (
              <div className="bg-green-100 border border-green-300 rounded px-2 py-1.5 mb-2 text-center">
                <span className="text-xs text-green-700 font-medium">
                  🎉 All {completed} tasks completed!
                </span>
              </div>
            )}

            {/* Current task highlight */}
            {!isAllDone && inProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">🔄</span>
                  <span className="text-xs text-blue-700 font-medium">
                    {inProgress.content}
                  </span>
                </div>
              </div>
            )}

            {/* File Changes Section */}
            {hasPendingChanges && (
              <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1.5 mb-2">
                {/* File changes header with stats */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📁</span>
                    <span className="text-xs text-orange-700 font-medium">
                      Changed Files ({pendingFileChanges.length})
                    </span>
                    {/* Summary stats */}
                    {(totalAdditions > 0 || totalDeletions > 0) && (
                      <span className="text-xs font-mono">
                        {totalAdditions > 0 && (
                          <span className="text-green-600">+{totalAdditions}</span>
                        )}
                        {totalAdditions > 0 && totalDeletions > 0 && (
                          <span className="text-ink-400 mx-1">·</span>
                        )}
                        {totalDeletions > 0 && (
                          <span className="text-red-600">-{totalDeletions}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* File changes list */}
                {visibleFileChanges.map((change) => (
                  <div
                    key={change.path}
                    className="flex items-center justify-between py-1 px-1.5 text-xs bg-white rounded mb-1"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <svg className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-ink-700 font-mono truncate flex-shrink-0">
                        {change.path}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="flex items-center gap-1.5 font-mono">
                        {change.additions > 0 && (
                          <span className="text-green-600">+{change.additions}</span>
                        )}
                        {change.deletions > 0 && (
                          <span className="text-red-600">-{change.deletions}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleViewDiff(change)}
                        className="ml-2 px-2 py-0.5 text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-100 rounded transition-colors flex-shrink-0"
                        title="View diff"
                      >
                        View Diff
                      </button>
                    </div>
                  </div>
                ))}

                {/* Show more/less button */}
                {hasMoreFiles && (
                  <button
                    type="button"
                    onClick={() => setShowAllFiles(!showAllFiles)}
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium mt-1 ml-1"
                  >
                    {showAllFiles
                      ? `Show less (-${pendingFileChanges.length - 4} files)`
                      : `Show ${pendingFileChanges.length - 4} more files...`
                    }
                  </button>
                )}

                {/* Confirm/Rollback buttons */}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-orange-200">
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={handleRollback}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Rollback
                  </button>
                </div>
              </div>
            )}

            {/* Task list - SCROLLABLE */}
            <div
              className="todo-scroll-container"
              onWheel={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                el.scrollTop += e.deltaY;
              }}
              style={{
                maxHeight: '150px',
                overflowY: 'auto',
                overflowX: 'hidden'
              }}
            >
              <div className="space-y-1 pr-1">
                {todos.map((todo) => {
                  const config = statusConfig[todo.status];
                  return (
                    <div
                      key={todo.id}
                      className={`flex items-start gap-2 px-2 py-1 rounded text-xs ${
                        todo.status === 'in_progress' ? 'bg-blue-50' : 'hover:bg-ink-50'
                      }`}
                    >
                      <span className="flex-shrink-0">{config.emoji}</span>
                      <span
                        className={`break-words ${
                          todo.status === 'completed' ? 'line-through text-ink-400' :
                          todo.status === 'cancelled' ? 'line-through text-ink-400' :
                          'text-ink-700'
                        }`}
                      >
                        {todo.content}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Diff Viewer Modal */}
      <DiffViewerModal
        file={selectedFile}
        files={changedFiles}
        cwd={cwd}
        open={diffModalOpen}
        onClose={() => {
          setDiffModalOpen(false);
          setSelectedFile(null);
        }}
        onFileChange={(file) => {
          setSelectedFile(file);
        }}
      />
    </div>
  );
}
