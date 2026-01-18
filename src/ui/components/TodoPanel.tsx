/**
 * TodoPanel - Displays agent's task plan with progress bar (collapsible)
 */

import { useState } from "react";
import type { TodoItem, TodoStatus } from "../types";

interface TodoPanelProps {
  todos: TodoItem[];
}

const statusConfig: Record<TodoStatus, { emoji: string; color: string; bgColor: string }> = {
  pending: { emoji: '⬜', color: 'text-ink-500', bgColor: 'bg-ink-100' },
  in_progress: { emoji: '🔄', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  completed: { emoji: '✅', color: 'text-green-600', bgColor: 'bg-green-100' },
  cancelled: { emoji: '❌', color: 'text-red-500', bgColor: 'bg-red-100' }
};

export function TodoPanel({ todos }: TodoPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  if (!todos || todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;
  const percent = Math.round((completed / total) * 100);
  const inProgress = todos.find(t => t.status === 'in_progress');

  return (
    <div className="bg-surface-50 border border-border-200 rounded-lg p-3 mb-3 shadow-sm overflow-hidden">
      {/* Header with progress - clickable to collapse */}
      <div 
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <span 
            className="text-xs text-ink-400 transition-transform duration-200"
            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            ▼
          </span>
          <span className="text-sm font-medium text-ink-700">📋 Task Plan</span>
          <span className="text-xs text-ink-500">
            {completed}/{total} completed
          </span>
        </div>
        <span className="text-xs font-mono text-ink-500">{percent}%</span>
      </div>

      {/* Progress bar - always visible */}
      <div className="h-1.5 bg-ink-200 rounded-full mt-2 overflow-hidden">
        <div 
          className="h-full bg-green-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Collapsible content */}
      {!isCollapsed && (
        <div className="mt-3">
          {/* Current task highlight */}
          {inProgress && (
            <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">🔄</span>
                <span className="text-xs text-blue-700 font-medium truncate">
                  {inProgress.content}
                </span>
              </div>
            </div>
          )}

          {/* Task list - scrollable */}
          <div className="space-y-1 max-h-48 overflow-y-auto overscroll-contain">
            {todos.map((todo) => {
              const config = statusConfig[todo.status];
              return (
                <div
                  key={todo.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                    todo.status === 'in_progress' ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className="flex-shrink-0">{config.emoji}</span>
                  <span 
                    className={`truncate ${
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
      )}
    </div>
  );
}
