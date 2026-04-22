import type { PlatformAdapter } from "./types";
import type { LLMProvider, LLMModel } from "../types";

const FETCH_MODELS_TIMEOUT_MS = 30000;

async function fetchModelsForProvider(provider: LLMProvider): Promise<LLMModel[]> {
    const baseUrl = (provider.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS);
    try {
        const response = await fetch(`${baseUrl}/models`, {
            signal: controller.signal,
            headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();
        const items = (data.data || []).map((m: { id: string; description?: string; context_length?: number }) => ({
            id: `${provider.id}::${m.id}`,
            name: m.id,
            providerId: provider.id,
            providerType: provider.type,
            description: m.description || "",
            enabled: true,
            contextLength: m.context_length,
        }));
        return items;
    } catch (err) {
        clearTimeout(timeoutId);
        const msg = err instanceof Error && err.name === "AbortError"
            ? "Connection timeout - server did not respond in time"
            : (err instanceof Error ? err.message : String(err));
        throw new Error(msg);
    }
}

export function createWebPlatform(): PlatformAdapter {
    return {
        sendClientEvent: (event) => {
            if (event.type === "llm.models.test") {
                const { provider } = event.payload;
                if (provider.type !== "openai") {
                    const emit = (window as any).__web_emitServerEvent;
                    if (emit) emit({ type: "llm.models.error", payload: { providerId: provider.id, message: "Web dev mode supports only OpenAI-compatible providers" } });
                    return;
                }
                fetchModelsForProvider(provider)
                    .then((models) => {
                        const emit = (window as any).__web_emitServerEvent;
                        if (emit) emit({ type: "llm.models.fetched", payload: { providerId: provider.id, models } });
                    })
                    .catch((err) => {
                        const emit = (window as any).__web_emitServerEvent;
                        if (emit) emit({ type: "llm.models.error", payload: { providerId: provider.id, message: String(err) } });
                    });
                return;
            }
            console.log("[web-platform] sendClientEvent", event);
        },

        onServerEvent: (callback, onReady) => {
            console.log("[web-platform] onServerEvent listener registered");
            // For testing, we could manually invoke this callback from console
            (window as any).__web_emitServerEvent = callback;
            // Web platform is synchronous
            onReady?.();
            return () => {
                console.log("[web-platform] onServerEvent disabled");
            };
        },

        generateSessionTitle: async (_userInput) => {
            return "Web Session";
        },

        getRecentCwds: async (_limit) => {
            return [];
        },

        selectDirectory: async () => {
            const mockPath = "/mock/web/path";
            console.log("[web-platform] selectDirectory - returning mock path:", mockPath);
            return mockPath;
        },

        selectFile: async () => {
            const mockPath = "/mock/web/path/file.txt";
            console.log("[web-platform] selectFile - returning mock path:", mockPath);
            return mockPath;
        },

        invoke: async <TResult = unknown>(channel: string, ...args: unknown[]): Promise<TResult> => {
            console.log(`[web-platform] invoke "${channel}"`, args);

            // Mock specific responses if needed
            if (channel === "get-build-info") {
                return {
                    version: "0.0.0-web",
                    commit: "web-dev",
                    date: new Date().toISOString(),
                    platform: "web"
                } as TResult;
            }

            if (channel === "list-directory") {
                return [
                    { name: "mock-file.txt", isDir: false, sizeBytes: "123" },
                    { name: "mock-folder", isDir: true }
                ] as TResult;
            }

            return null as TResult;
        },

        send: (channel, ...args) => {
            console.log(`[web-platform] send "${channel}"`, args);
        },
    };
}
