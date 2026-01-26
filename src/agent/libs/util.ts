import { claudeCodeEnv, loadClaudeSettingsEnv } from "./claude-settings.js";
import { loadApiSettings } from "./settings-store.js";
import type { ApiSettings } from "../types.js";
import { join } from "path";
import { homedir } from "os";
import OpenAI from "openai";

import { createRequire } from "module";
// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

function getElectronApp(): any | null {
  const electronVersion = (process.versions as any)?.electron;
  if (!electronVersion) return null;
  const electron = require("electron");
  return electron.app;
}

// Get Claude Code CLI path for packaged app
export function getClaudeCodePath(): string | undefined {
  const app = getElectronApp();
  if (app?.isPackaged) {
    return join(
      (process as any).resourcesPath,
      'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    );
  }
  return undefined;
}

// Build enhanced PATH for packaged environment
export function getEnhancedEnv(guiSettings?: ApiSettings | null): Record<string, string | undefined> {
  const home = homedir();
  const additionalPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${home}/.bun/bin`,
    `${home}/.nvm/versions/node/v20.0.0/bin`,
    `${home}/.nvm/versions/node/v22.0.0/bin`,
    `${home}/.nvm/versions/node/v18.0.0/bin`,
    `${home}/.volta/bin`,
    `${home}/.fnm/aliases/default/bin`,
    '/usr/bin',
    '/bin',
  ];

  const currentPath = process.env.PATH || '';
  const newPath = [...additionalPaths, currentPath].join(':');

  // Load settings with GUI priority
  const settings = loadClaudeSettingsEnv(guiSettings);

  // Get temperature from GUI settings, default to 0.3 for vLLM
  const temperature = guiSettings?.temperature !== undefined
    ? String(guiSettings.temperature)
    : '0.3';

  return {
    ...process.env,
    PATH: newPath,
    // Apply Claude settings
    ANTHROPIC_AUTH_TOKEN: settings.ANTHROPIC_AUTH_TOKEN,
    ANTHROPIC_BASE_URL: settings.ANTHROPIC_BASE_URL,
    ANTHROPIC_MODEL: settings.ANTHROPIC_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: settings.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: settings.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: settings.ANTHROPIC_DEFAULT_SONNET_MODEL,
    API_TIMEOUT_MS: settings.API_TIMEOUT_MS,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: settings.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    // Try to set temperature for vLLM/OpenAI-compatible APIs
    ANTHROPIC_TEMPERATURE: temperature,
    TEMPERATURE: temperature,
    // Enable debug logging for Claude SDK
    DEBUG: 'anthropic:*',
    ANTHROPIC_LOG_LEVEL: 'debug',
    NODE_DEBUG: 'http,https',
  };
}

export const claudeCodePath = getClaudeCodePath();
export const enhancedEnv = getEnhancedEnv();

export const generateSessionTitle = async (userIntent: string | null) => {
  if (!userIntent) return "New Chat";

  try {
    // Load GUI settings with priority
    const guiSettings = loadApiSettings();

    // If no valid settings, use simple fallback
    if (!guiSettings || !guiSettings.apiKey) {
      return extractFallbackTitle(userIntent);
    }

    // Create OpenAI client with user settings
    const client = new OpenAI({
      apiKey: guiSettings.apiKey,
      baseURL: guiSettings.baseUrl ? `${guiSettings.baseUrl}` : undefined,
    });

    const response = await client.chat.completions.create({
      model: guiSettings.model || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are a chat title generator. Generate a SHORT title (1-2 words MAX) that captures the essence of the user's request. 

Rules:
- Output ONLY the title, nothing else
- Maximum 2 words
- No quotes, no punctuation
- Use nouns or noun+verb format
- Examples: "File Analysis", "Code Review", "Python Help", "Web Parsing"`
        },
        {
          role: 'user',
          content: userIntent
        }
      ],
      max_tokens: 10,
      temperature: 0.3,
    });

    const title = response.choices[0]?.message?.content?.trim();
    if (title) {
      // Clean up: remove quotes, limit to 2 words, max 30 chars
      const cleaned = title
        .replace(/^["']|["']$/g, '')
        .replace(/[.,!?:;]/g, '')
        .split(/\s+/)
        .slice(0, 2)
        .join(' ')
        .slice(0, 30);

      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  } catch (error) {
    console.error('Failed to generate session title:', error);
  }

  // Fallback: extract key words from user input
  return extractFallbackTitle(userIntent);
};

/**
 * Extract a simple title from user input when LLM is not available
 */
function extractFallbackTitle(text: string): string {
  // Remove common words and extract first meaningful words
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'what', 'which',
    'this', 'that', 'these', 'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
    'please', 'can', 'need', 'want', 'help', 'make', 'get', 'show', 'tell']);

  const words = text
    .toLowerCase()
    .replace(/[^\w\sа-яё]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 2);

  if (words.length === 0) {
    return "New Chat";
  }

  // Capitalize first letter of each word
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
