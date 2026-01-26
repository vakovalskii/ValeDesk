/**
 * manage_todos Tool - Create and manage task lists for complex operations
 * Allows agent to track progress on multi-step tasks
 */

import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt?: number;
  updatedAt?: number;
}

export const ManageTodosToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "manage_todos",
    description: `Create and manage a structured task list for complex operations.

**When to use:**
- Complex multi-step tasks (3+ steps)
- User provides multiple tasks
- Need to track progress on a plan
- Breaking down a large request into steps

**When NOT to use:**
- Single, simple tasks
- Informational questions
- Tasks completable in 1-2 steps

**Task states:**
- pending: Not started
- in_progress: Currently working on (only ONE at a time)
- completed: Finished
- cancelled: No longer needed

**Best practices:**
- Mark task as in_progress when starting
- Mark completed IMMEDIATELY after finishing
- Keep only one task in_progress at a time`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "clear"],
          description: "create: Set new todo list (replaces existing). update: Merge changes into existing todos. clear: Remove all todos."
        },
        todos: {
          type: "array",
          description: "Array of todo items. Required for create/update actions.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Unique identifier (e.g., '1', '2', 'task-a')"
              },
              content: {
                type: "string",
                description: "Task description (max 100 chars)"
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
                description: "Current status"
              }
            },
            required: ["id", "content", "status"]
          }
        }
      },
      required: ["action"]
    }
  }
};

// In-memory storage keyed by sessionId (for isolation between sessions)
const sessionTodos = new Map<string, TodoItem[]>();

/**
 * Get todos for a specific session
 */
export function getTodos(sessionId: string): TodoItem[] {
  return [...(sessionTodos.get(sessionId) || [])];
}

/**
 * Set todos from loaded session
 */
export function setTodos(sessionId: string, todos: TodoItem[]): void {
  sessionTodos.set(sessionId, [...todos]);
}

/**
 * Clear all todos for a specific session
 */
export function clearTodos(sessionId: string): void {
  sessionTodos.delete(sessionId);
}

/**
 * Execute manage_todos tool
 */
export async function executeManageTodosTool(
  args: { action: 'create' | 'update' | 'clear'; todos?: TodoItem[] },
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { action, todos } = args;
  const now = Date.now();

  if (!context.sessionId) {
    console.error('[manage_todos] No sessionId provided in context');
    return {
      success: false,
      error: '❌ Session ID required for todo management'
    };
  }

  console.log(`[manage_todos] Session: ${context.sessionId}, Action: ${action}, Items: ${todos?.length || 0}`);

  try {
    // Get or create todos for this session
    let currentTodos = sessionTodos.get(context.sessionId) || [];

    switch (action) {
      case 'create': {
        if (!todos || todos.length === 0) {
          return {
            success: false,
            error: '❌ No todos provided for create action'
          };
        }

        // Validate and set new todos
        currentTodos = todos.map(t => ({
          id: t.id,
          content: t.content.slice(0, 100),
          status: t.status,
          createdAt: now,
          updatedAt: now
        }));

        // Store in memory for this session
        sessionTodos.set(context.sessionId, currentTodos);

        // Persist to DB via callback
        if (context.onTodosChanged) {
          context.onTodosChanged(currentTodos);
        }

        return {
          success: true,
          output: formatTodosOutput('📋 Todo list created', currentTodos)
        };
      }

      case 'update': {
        if (!todos || todos.length === 0) {
          return {
            success: false,
            error: '❌ No todos provided for update action'
          };
        }

        // Merge updates into existing todos
        for (const update of todos) {
          const existing = currentTodos.find(t => t.id === update.id);
          if (existing) {
            if (update.content) existing.content = update.content.slice(0, 100);
            if (update.status) existing.status = update.status;
            existing.updatedAt = now;
          } else {
            // Add new todo
            currentTodos.push({
              id: update.id,
              content: update.content.slice(0, 100),
              status: update.status,
              createdAt: now,
              updatedAt: now
            });
          }
        }

        // Store updated todos
        sessionTodos.set(context.sessionId, currentTodos);

        // Persist to DB via callback
        if (context.onTodosChanged) {
          context.onTodosChanged(currentTodos);
        }

        return {
          success: true,
          output: formatTodosOutput('✅ Todos updated', currentTodos)
        };
      }

      case 'clear': {
        // Clear todos for this session only
        sessionTodos.delete(context.sessionId);
        currentTodos = [];

        // Persist to DB via callback
        if (context.onTodosChanged) {
          context.onTodosChanged(currentTodos);
        }

        return {
          success: true,
          output: '🗑️ All todos cleared'
        };
      }

      default:
        return {
          success: false,
          error: `❌ Unknown action: ${action}`
        };
    }
  } catch (error: any) {
    console.error('[manage_todos] Error:', error);
    return {
      success: false,
      error: `❌ Failed to manage todos: ${error.message}`
    };
  }
}

/**
 * Format todos for output
 */
function formatTodosOutput(title: string, todos: TodoItem[]): string {
  if (todos.length === 0) {
    return `${title}\n\n(No tasks)`;
  }
  
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;
  const percent = Math.round((completed / total) * 100);
  
  let output = `${title}\n\n`;
  output += `**Progress:** ${completed}/${total} (${percent}%)\n\n`;
  
  const statusEmoji: Record<TodoStatus, string> = {
    pending: '⬜',
    in_progress: '🔄',
    completed: '✅',
    cancelled: '❌'
  };
  
  todos.forEach(todo => {
    output += `${statusEmoji[todo.status]} ${todo.content}\n`;
  });
  
  return output;
}

/**
 * Get todos summary for system prompt injection
 */
export function getTodosSummary(sessionId: string): string | null {
  const currentTodos = sessionTodos.get(sessionId) || [];
  if (currentTodos.length === 0) return null;

  const completed = currentTodos.filter(t => t.status === 'completed').length;
  const inProgress = currentTodos.find(t => t.status === 'in_progress');
  const pending = currentTodos.filter(t => t.status === 'pending');

  let summary = `\n\n## 📋 Current Task Plan\n`;
  summary += `Progress: ${completed}/${currentTodos.length} completed\n\n`;

  if (inProgress) {
    summary += `**Currently working on:** ${inProgress.content}\n\n`;
  }

  summary += `Tasks:\n`;
  currentTodos.forEach(t => {
    const emoji = t.status === 'completed' ? '✅' :
                  t.status === 'in_progress' ? '🔄' :
                  t.status === 'cancelled' ? '❌' : '⬜';
    summary += `${emoji} ${t.content}\n`;
  });

  if (pending.length > 0 && !inProgress) {
    summary += `\n**Next task:** ${pending[0].content}`;
  }

  return summary;
}
