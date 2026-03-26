import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoadLLMProviderSettings = vi.fn();
const mockLoadApiSettings = vi.fn();

vi.mock("../src/agent/libs/llm-providers-store.js", () => ({
  loadLLMProviderSettings: () => mockLoadLLMProviderSettings(),
}));

vi.mock("../src/agent/libs/settings-store.js", () => ({
  loadApiSettings: () => mockLoadApiSettings(),
}));

// Import after mocks
const { resolveModelCredentials } = await import("../src/agent/libs/resolve-model.js");

describe("resolveModelCredentials", () => {
  beforeEach(() => {
    mockLoadLLMProviderSettings.mockReset();
    mockLoadApiSettings.mockReset();
  });

  // ── LLM provider models (providerId::modelId) ──────────────────────────────

  it("resolves openrouter provider model", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "or-1", type: "openrouter", name: "OpenRouter", apiKey: "sk-or", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("or-1::gpt-4o");

    expect(result).toEqual({
      apiKey: "sk-or",
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "gpt-4o",
    });
  });

  it("resolves zai provider model with default prefix", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "zai-1", type: "zai", name: "Z.AI", apiKey: "sk-zai", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("zai-1::claude-opus");

    expect(result).toEqual({
      apiKey: "sk-zai",
      baseURL: "https://api.z.ai/api/paas/v4",
      modelName: "claude-opus",
    });
  });

  it("resolves zai provider model with coding prefix", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "zai-1", type: "zai", name: "Z.AI", apiKey: "sk-zai", zaiApiPrefix: "coding", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("zai-1::claude-opus");

    expect(result?.baseURL).toBe("https://api.z.ai/api/coding/paas/v4");
  });

  it("resolves ollama provider model with custom baseUrl", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "ol-1", type: "ollama", name: "Ollama", apiKey: "", baseUrl: "http://10.0.0.1:11434/v1", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("ol-1::llama3");

    expect(result).toEqual({
      apiKey: "",
      baseURL: "http://10.0.0.1:11434/v1",
      modelName: "llama3",
    });
  });

  it("resolves ollama provider model with default baseUrl when not set", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "ol-1", type: "ollama", name: "Ollama", apiKey: "", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("ol-1::llama3");

    expect(result?.baseURL).toBe("http://localhost:11434/v1");
  });

  it("resolves custom openai-compatible provider model", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "custom-1", type: "openai", name: "Custom", apiKey: "sk-custom", baseUrl: "https://api.example.com/v1", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("custom-1::my-model");

    expect(result).toEqual({
      apiKey: "sk-custom",
      baseURL: "https://api.example.com/v1",
      modelName: "my-model",
    });
  });

  it("returns null for codex provider (OAuth required)", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "cx-1", type: "codex", name: "Codex", apiKey: "", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("cx-1::model");

    expect(result).toBeNull();
  });

  it("returns null for claude-code provider", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "cc-1", type: "claude-code", name: "Claude Code", apiKey: "", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("cc-1::claude-opus");

    expect(result).toBeNull();
  });

  it("returns null when provider id not found", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [],
      models: [],
    });

    const result = resolveModelCredentials("missing-id::model");

    expect(result).toBeNull();
  });

  it("returns null when provider is disabled", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "or-1", type: "openrouter", name: "OpenRouter", apiKey: "sk", enabled: false },
      ],
      models: [],
    });

    const result = resolveModelCredentials("or-1::gpt-4");

    expect(result).toBeNull();
  });

  it("returns null for custom provider with no baseUrl", () => {
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "c-1", type: "openai", name: "Custom", apiKey: "sk", enabled: true },
      ],
      models: [],
    });

    const result = resolveModelCredentials("c-1::model");

    expect(result).toBeNull();
  });

  // ── Legacy API settings ────────────────────────────────────────────────────

  it("falls back to legacy API settings for non-provider model", () => {
    mockLoadApiSettings.mockReturnValue({
      apiKey: "sk-legacy",
      baseUrl: "http://legacy.api/v1",
      model: "legacy-model",
    });

    const result = resolveModelCredentials("some-plain-model");

    expect(result).toEqual({
      apiKey: "sk-legacy",
      baseURL: "http://legacy.api/v1",
      modelName: "some-plain-model",
    });
  });

  it("uses legacy model from settings when no modelSpec given", () => {
    mockLoadApiSettings.mockReturnValue({
      apiKey: "sk-legacy",
      baseUrl: "http://legacy.api/v1",
      model: "default-model",
    });

    const result = resolveModelCredentials(undefined);

    expect(result?.modelName).toBe("default-model");
  });

  it("returns null when legacy settings have no apiKey", () => {
    mockLoadApiSettings.mockReturnValue({ apiKey: "", baseUrl: "http://api/v1", model: "m" });
    mockLoadLLMProviderSettings.mockReturnValue({ providers: [], models: [] });

    const result = resolveModelCredentials("some-model");

    expect(result).toBeNull();
  });

  // ── Auto-resolve by model name ─────────────────────────────────────────────

  it("auto-resolves model name against LLM providers", () => {
    mockLoadApiSettings.mockReturnValue(null);
    mockLoadLLMProviderSettings.mockReturnValue({
      providers: [
        { id: "or-1", type: "openrouter", name: "OpenRouter", apiKey: "sk-or", enabled: true },
      ],
      models: [
        { id: "or-1::gpt-4o-mini", name: "gpt-4o-mini", providerId: "or-1", providerType: "openrouter", enabled: true },
      ],
    });

    const result = resolveModelCredentials("gpt-4o-mini");

    expect(result).toEqual({
      apiKey: "sk-or",
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "gpt-4o-mini",
    });
  });

  it("returns null when no settings at all", () => {
    mockLoadApiSettings.mockReturnValue(null);
    mockLoadLLMProviderSettings.mockReturnValue({ providers: [], models: [] });

    const result = resolveModelCredentials(undefined);

    expect(result).toBeNull();
  });
});
