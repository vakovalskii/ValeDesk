import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockResolveModelCredentials = vi.fn();
const mockLoadApiSettings = vi.fn();
const createMock = vi.fn();

vi.mock("../src/agent/libs/resolve-model.js", () => ({
  resolveModelCredentials: (modelSpec: string | undefined) => mockResolveModelCredentials(modelSpec),
}));

vi.mock("../src/agent/libs/settings-store.js", () => ({
  loadApiSettings: () => mockLoadApiSettings(),
}));

// Mocks needed by util.ts (indirect deps)
vi.mock("../src/agent/libs/claude-settings.js", () => ({
  claudeCodeEnv: {},
  loadClaudeSettingsEnv: () => ({}),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const { generateSessionTitle } = await import("../src/agent/libs/util.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function mockLLMResponse(content: string) {
  createMock.mockResolvedValue({
    choices: [{ message: { content } }],
  });
}

function mockLLMError(err: Error) {
  createMock.mockRejectedValue(err);
}

const RESOLVED_CREDS = {
  apiKey: "sk-test",
  baseURL: "http://localhost/v1",
  modelName: "test-model",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("generateSessionTitle", () => {
  beforeEach(() => {
    mockResolveModelCredentials.mockReset();
    mockLoadApiSettings.mockReset();
    createMock.mockReset();
  });

  // ── Trivial cases ────────────────────────────────────────────────────────

  it("returns 'New Chat' for null input", async () => {
    const result = await generateSessionTitle(null);
    expect(result).toBe("New Chat");
  });

  it("returns 'New Chat' for empty string", async () => {
    const result = await generateSessionTitle("");
    expect(result).toBe("New Chat");
  });

  // ── LLM-based title generation ───────────────────────────────────────────

  it("generates title using resolved model credentials", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("Code Review");

    const result = await generateSessionTitle("please review my code", "or-1::gpt-4o");

    expect(mockResolveModelCredentials).toHaveBeenCalledWith("or-1::gpt-4o");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        temperature: 0.3,
        max_tokens: 10,
      }),
      expect.anything()
    );
    expect(result).toBe("Code Review");
  });

  it("passes prompt as user message to LLM", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("File Analysis");

    await generateSessionTitle("analyze my log files", "or-1::model");

    const callArgs = createMock.mock.calls[0][0];
    const userMsg = callArgs.messages.find((m: any) => m.role === "user");
    expect(userMsg?.content).toBe("analyze my log files");
  });

  it("cleans up LLM response: strips quotes", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse('"Code Review"');

    const result = await generateSessionTitle("review my code", "m");

    expect(result).toBe("Code Review");
  });

  it("cleans up LLM response: strips punctuation", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("File Analysis!");

    const result = await generateSessionTitle("analyze files", "m");

    expect(result).toBe("File Analysis");
  });

  it("cleans up LLM response: limits to 2 words", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("Python Script Debugging Helper");

    const result = await generateSessionTitle("debug my python script", "m");

    expect(result).toBe("Python Script");
  });

  it("cleans up LLM response: limits to 30 chars", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("Verylongtitlewordthatexceedsthirtychars extra");

    const result = await generateSessionTitle("some prompt", "m");

    expect(result.length).toBeLessThanOrEqual(30);
  });

  // ── Fallback to legacy settings ─────────────────────────────────────────

  it("falls back to legacy API settings when resolver returns null", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue({
      apiKey: "sk-legacy",
      baseUrl: "http://legacy/v1",
      model: "legacy-model",
    });
    mockLLMResponse("Web Parsing");

    const result = await generateSessionTitle("parse the website", "unknown-model");

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "legacy-model" }),
      expect.anything()
    );
    expect(result).toBe("Web Parsing");
  });

  it("uses extractFallbackTitle when resolver is null and no legacy settings", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue(null);

    const result = await generateSessionTitle("analyze database logs", "unknown");

    // extractFallbackTitle should return meaningful words from the prompt
    expect(result).not.toBe("New Chat");
    expect(result.length).toBeGreaterThan(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("uses extractFallbackTitle when legacy apiKey is empty", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue({ apiKey: "", baseUrl: "http://api/v1", model: "m" });

    const result = await generateSessionTitle("fix the login button", "m");

    expect(createMock).not.toHaveBeenCalled();
    expect(result).not.toBe("New Chat");
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("falls back to extractFallbackTitle when LLM throws", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMError(new Error("Connection refused"));

    const result = await generateSessionTitle("fix the login button", "m");

    expect(result).not.toBe("New Chat");
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back to extractFallbackTitle when LLM returns empty content", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("");

    const result = await generateSessionTitle("fix authentication bug", "m");

    // Should return fallback, not "New Chat" since prompt has meaningful words
    expect(result).not.toBe("New Chat");
  });

  it("returns 'New Chat' when fallback extract finds no meaningful words", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue(null);

    // Only stop words — no meaningful words to extract
    const result = await generateSessionTitle("the a an is", "m");

    expect(result).toBe("New Chat");
  });

  // ── extractFallbackTitle behaviour ────────────────────────────────────────

  it("extractFallbackTitle capitalizes words", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue(null);

    const result = await generateSessionTitle("database migration script", "m");

    // "database" and "migration" are not stop words
    expect(result).toBe("Database Migration");
  });

  it("extractFallbackTitle skips stop words", async () => {
    mockResolveModelCredentials.mockReturnValue(null);
    mockLoadApiSettings.mockReturnValue(null);

    const result = await generateSessionTitle("how to fix authentication", "m");

    // "how", "to" are stop words; "fix" is a stop word too; "authentication" should remain
    expect(result.toLowerCase()).toContain("authentication");
  });

  // ── modelSpec not provided ────────────────────────────────────────────────

  it("calls resolver with undefined when no modelSpec given", async () => {
    mockResolveModelCredentials.mockReturnValue(RESOLVED_CREDS);
    mockLLMResponse("Quick Fix");

    await generateSessionTitle("fix the bug");

    expect(mockResolveModelCredentials).toHaveBeenCalledWith(undefined);
  });
});
