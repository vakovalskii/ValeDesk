/**
 * Base interfaces for all tools
 */

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

export interface ToolExecutionContext {
  cwd: string;
  isPathSafe: (path: string) => boolean;
  sessionId?: string;
  onTodosChanged?: (todos: any[]) => void;
}

export abstract class BaseTool {
  abstract get definition(): ToolDefinition;
  abstract execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult>;
}


