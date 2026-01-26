import type { LLMProvider, LLMModel, LLMProviderType } from "../types.js";

// Partial model type returned by fetch functions (before provider info is added)
type PartialModel = { id: string; name: string; description?: string; contextLength?: number };

// Helper to generate provider ID
function generateProviderId(type: LLMProviderType, name: string): string {
  return `${type}-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
}

// Helper to generate model ID
function generateModelId(providerId: string, modelName: string): string {
  return `${providerId}::${modelName}`;
}

// Fetch models from OpenAI-compatible API
async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<PartialModel[]> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = (data.data || []).map((model: any) => ({
      id: model.id,
      name: model.id,
      description: model.description || '',
      contextLength: model.context_length || undefined,
    }));

    return models;
  } catch (error) {
    console.error('[LLM Providers] Failed to fetch OpenAI models:', error);
    throw error;
  }
}

// Fetch models from OpenRouter
async function fetchOpenRouterModels(apiKey: string): Promise<PartialModel[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = (data.data || []).map((model: any) => ({
      id: model.id,
      name: `${model.name} (${model.id})`,
      description: model.description || `${model.pricing.prompt}/1M tokens`,
      contextLength: model.context_length || undefined,
    }));

    return models;
  } catch (error) {
    console.error('[LLM Providers] Failed to fetch OpenRouter models:', error);
    throw error;
  }
}

// Fetch models for Claude Code (subscription-based, no API key needed)
async function fetchClaudeCodeModels(): Promise<PartialModel[]> {
  // Claude Code subscription provides access to Claude models via the SDK
  // These models are fixed and don't require an API call to fetch
  return [
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      description: 'Latest Claude Sonnet 4 model (via Claude Code subscription)',
      contextLength: 200000,
    },
    {
      id: 'claude-3-7-sonnet-20250219',
      name: 'Claude 3.7 Sonnet',
      description: 'Claude 3.7 Sonnet (via Claude Code subscription)',
      contextLength: 200000,
    },
    {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      description: 'Claude 3.5 Sonnet (via Claude Code subscription)',
      contextLength: 200000,
    },
    {
      id: 'claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      description: 'Claude 3.5 Haiku - fast and efficient (via Claude Code subscription)',
      contextLength: 200000,
    },
  ];
}

// Fetch models from Z.AI
async function fetchZaiModels(apiKey: string, apiPrefix: 'default' | 'coding' = 'default'): Promise<PartialModel[]> {
  try {
    // Z.AI API endpoint for models list (similar to OpenAI)
    // Two possible prefixes: /api/paas/v4 or /api/coding/paas/v4
    const prefix = apiPrefix === 'coding' ? 'api/coding/paas' : 'api/paas';
    const response = await fetch(`https://api.z.ai/${prefix}/v4/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = (data.data || []).map((model: any) => ({
      id: model.id,
      name: model.id,
      description: model.description || '',
      contextLength: model.context_length || undefined,
    }));

    return models;
  } catch (error) {
    console.error('[LLM Providers] Failed to fetch Z.AI models:', error);
    throw error;
  }
}

// Main function to fetch models from a provider
export async function fetchModelsFromProvider(provider: LLMProvider): Promise<LLMModel[]> {
  console.error(`[LLM Providers] Fetching models from provider: ${provider.name} (${provider.type})`);

  let fetchedModels: PartialModel[] = [];

  switch (provider.type) {
    case 'openai':
      fetchedModels = await fetchOpenAIModels(provider.baseUrl || 'https://api.openai.com/v1', provider.apiKey);
      break;

    case 'openrouter':
      fetchedModels = await fetchOpenRouterModels(provider.apiKey);
      break;

    case 'zai':
      fetchedModels = await fetchZaiModels(provider.apiKey, provider.zaiApiPrefix || 'default');
      break;

    case 'claude-code':
      fetchedModels = await fetchClaudeCodeModels();
      break;

    default:
      throw new Error(`Unsupported provider type: ${provider.type}`);
  }

  // Transform fetched models into LLMModel format with provider info
  const models: LLMModel[] = fetchedModels.map((model) => ({
    id: generateModelId(provider.id, model.id),
    name: model.name,
    providerId: provider.id,
    providerType: provider.type,
    description: model.description,
    enabled: true, // Default to enabled, user can disable if needed
    contextLength: model.contextLength,
  }));

  console.error(`[LLM Providers] Fetched ${models.length} models from ${provider.name}`);
  return models;
}

// Check if models are available by making a simple API call
export async function checkModelsAvailability(provider: LLMProvider, models: LLMModel[]): Promise<string[]> {
  const unavailable: string[] = [];

  // For OpenAI-compatible APIs, we can check by making a minimal completion request
  if (provider.type === 'openai' || provider.type === 'zai') {
    let baseUrl = provider.baseUrl || (provider.type === 'openai' ? 'https://api.openai.com/v1' : 'https://api.z.ai/api/paas/v4');

    // For Z.AI, use the correct prefix
    if (provider.type === 'zai' && provider.zaiApiPrefix === 'coding') {
      baseUrl = 'https://api.z.ai/api/coding/paas/v4';
    }

    for (const model of models) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model.id.split('-').slice(0, -1).join('-'), // Extract original model ID
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1,
          }),
        });

        if (!response.ok) {
          unavailable.push(model.id);
        }
      } catch (error) {
        console.error(`[LLM Providers] Model ${model.name} is unavailable:`, error);
        unavailable.push(model.id);
      }
    }
  } else if (provider.type === 'openrouter') {
    // OpenRouter doesn't have a simple availability check
    // We assume all fetched models are available
    console.error('[LLM Providers] Skipping availability check for OpenRouter (assumes all models are available)');
  }

  return unavailable;
}

// Validate provider configuration
export function validateProvider(provider: Partial<LLMProvider>): { valid: boolean; error?: string } {
  if (!provider.type) {
    return { valid: false, error: 'Provider type is required' };
  }

  if (!provider.name || provider.name.trim() === '') {
    return { valid: false, error: 'Provider name is required' };
  }

  // Claude Code doesn't need API key (uses subscription via CLI)
  if (provider.type !== 'claude-code') {
    if (!provider.apiKey || provider.apiKey.trim() === '') {
      return { valid: false, error: 'API key is required' };
    }
  }

  if ((provider.type === 'openai' || provider.type === 'zai') && !provider.baseUrl) {
    return { valid: false, error: 'Base URL is required for this provider type' };
  }

  return { valid: true };
}

// Create a new provider
export function createProvider(type: LLMProviderType, name: string, apiKey: string, baseUrl?: string): LLMProvider {
  return {
    id: generateProviderId(type, name),
    type,
    name,
    apiKey,
    baseUrl,
    enabled: true,
  };
}
