import { loadLLMProviderSettings } from "./llm-providers-store.js";
import { loadApiSettings } from "./settings-store.js";
import type { LLMProvider } from "../types.js";

export interface ModelCredentials {
  apiKey: string;
  baseURL: string;
  modelName: string;
}

function resolveBaseURL(provider: LLMProvider): string {
  switch (provider.type) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'zai': {
      const prefix = provider.zaiApiPrefix === 'coding' ? 'api/coding/paas' : 'api/paas';
      return `https://api.z.ai/${prefix}/v4`;
    }
    case 'ollama':
      return provider.baseUrl || 'http://localhost:11434/v1';
    default:
      return provider.baseUrl || '';
  }
}

function fromProvider(provider: LLMProvider, modelName: string): ModelCredentials | null {
  // Skip codex — requires OAuth, too complex for title generation
  if (provider.type === 'codex') return null;
  // Skip claude-code — uses different SDK
  if (provider.type === 'claude-code') return null;

  const baseURL = resolveBaseURL(provider);
  if (!baseURL) return null;

  return {
    apiKey: provider.apiKey,
    baseURL,
    modelName,
  };
}

/**
 * Resolve API credentials for a given model specification.
 * Supports LLM provider models (providerId::modelId), legacy API settings, and auto-resolve.
 * Returns null if credentials cannot be resolved (e.g., codex provider, no settings).
 */
export function resolveModelCredentials(modelSpec: string | undefined): ModelCredentials | null {
  // Case 1: LLM provider model (providerId::modelId)
  if (modelSpec?.includes('::')) {
    const [providerId, modelId] = modelSpec.split('::');
    const llmSettings = loadLLMProviderSettings();
    if (!llmSettings) return null;

    const provider = llmSettings.providers.find(p => p.id === providerId && p.enabled !== false);
    if (!provider) return null;

    return fromProvider(provider, modelId);
  }

  // Case 2: Legacy API settings
  const guiSettings = loadApiSettings();
  if (guiSettings?.apiKey && guiSettings?.baseUrl) {
    return {
      apiKey: guiSettings.apiKey,
      baseURL: guiSettings.baseUrl,
      modelName: modelSpec || guiSettings.model || '',
    };
  }

  // Case 3: Auto-resolve model name against LLM providers
  if (modelSpec) {
    const llmSettings = loadLLMProviderSettings();
    if (llmSettings) {
      const matchingModel = llmSettings.models.find(
        m => m.id === modelSpec || m.name === modelSpec
      );
      if (matchingModel) {
        const provider = llmSettings.providers.find(
          p => p.id === matchingModel.providerId && p.enabled !== false
        );
        if (provider) {
          const resolvedModelId = matchingModel.id.includes('::')
            ? matchingModel.id.split('::')[1]
            : matchingModel.name;
          return fromProvider(provider, resolvedModelId);
        }
      }
    }
  }

  return null;
}
