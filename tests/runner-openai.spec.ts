import { describe, it, expect, vi, beforeEach } from "vitest";

const executeToolMock = vi.fn();
const createMock = vi.fn();

vi.mock("../src/agent/libs/tools-executor.js", () => {
  return {
    ToolExecutor: class {
      updateSettings() {}
      async executeTool(name: string, args: Record<string, unknown>) {
        return executeToolMock(name, args);
      }
    }
  };
});

vi.mock("../src/agent/libs/settings-store.js", () => ({
  loadApiSettings: () => ({
    apiKey: "test-key",
    baseUrl: "http://localhost",
    model: "test-model",
    permissionMode: "default",
    enableMemory: false
  })
}));

vi.mock("../src/agent/libs/llm-providers-store.js", () => ({
  loadLLMProviderSettings: () => null
}));

vi.mock("../src/agent/libs/tools-definitions.js", () => ({
  TOOLS: [],
  getTools: () => [
    {
      type: "function",
      function: { name: "search_web", parameters: { type: "object", properties: {} } }
    }
  ],
  generateToolsSummary: () => ""
}));

vi.mock("../src/agent/libs/prompt-loader.js", () => ({
  getSystemPrompt: () => "system",
  getInitialPrompt: (prompt: string) => prompt
}));

vi.mock("../src/agent/libs/tools/manage-todos-tool.js", () => ({
  getTodosSummary: () => "",
  getTodos: () => [],
  setTodos: () => {},
  clearTodos: () => {}
}));

vi.mock("../src/agent/git-utils.js", () => ({
  isGitRepo: () => false,
  getRelativePath: () => "file",
  getFileDiffStats: () => ({ additions: 0, deletions: 0 })
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  }
}));

const makeStream = (chunks: any[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
});

describe("runner-openai tool flow", () => {
  beforeEach(() => {
    executeToolMock.mockReset();
    createMock.mockReset();
    (global as any).sessionStore = {
      recordMessage: vi.fn(),
      getSessionHistory: vi.fn(() => ({ messages: [], todos: [] }))
    };
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      clone: () => ({ text: async () => "" })
    })) as any;
  });

  it("executes tool call and emits tool_result", async () => {
    executeToolMock.mockResolvedValue({ success: true, output: "ok" });

    createMock
      .mockImplementationOnce(() =>
        makeStream([
          {
            id: "resp1",
            model: "test-model",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: { name: "search_web", arguments: "{\"query\":\"weather" }
                    }
                  ]
                }
              }
            ]
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: "\",\"explanation\":\"test\"}" } }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }
        ])
      )
      .mockImplementationOnce(() =>
        makeStream([
          {
            choices: [
              { delta: { content: "done" }, finish_reason: "stop" }
            ]
          }
        ])
      );

    const events: any[] = [];
    const completion = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 5000);
      const onEvent = (event: any) => {
        events.push(event);
        if (event.type === "session.status" && event.payload.status === "completed") {
          clearTimeout(timeout);
          resolve();
        }
      };

      import("../src/agent/libs/runner-openai.ts").then(({ runClaude }) => {
        runClaude({
          prompt: "hi",
          session: {
            id: "s1",
            title: "t",
            status: "running",
            cwd: "",
            pendingPermissions: new Map()
          } as any,
          onEvent
        });
      });
    });

    await completion;

    expect(executeToolMock).toHaveBeenCalledWith("search_web", { query: "weather", explanation: "test" });
    const toolResult = events.find(
      (e) => e.type === "stream.message" && e.payload?.message?.type === "user"
    );
    expect(toolResult).toBeTruthy();
  });
});
