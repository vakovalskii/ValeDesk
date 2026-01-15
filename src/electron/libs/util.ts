import { claudeCodeEnv, loadClaudeSettingsEnv } from "./claude-settings.js";
import { loadApiSettings } from "./settings-store.js";
import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ApiSettings } from "../types.js";
import { app } from "electron";
import { join } from "path";
import { homedir } from "os";

// Get Claude Code CLI path for packaged app
export function getClaudeCodePath(): string | undefined {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
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
    
    // If no valid settings, use simple title
    if (!guiSettings || !guiSettings.apiKey || guiSettings.apiKey === 'dummy-key') {
      return userIntent.slice(0, 50) + (userIntent.length > 50 ? '...' : '');
    }
    
    const env = getEnhancedEnv(guiSettings);

    const result: SDKResultMessage = await unstable_v2_prompt(
      `please analynis the following user input to generate a short but clearly title to identify this conversation theme:
      ${userIntent}
      directly output the title, do not include any other content`, {
      model: claudeCodeEnv.ANTHROPIC_MODEL,
      env,
      pathToClaudeCodeExecutable: claudeCodePath,
    });

    if (result.subtype === "success") {
      return result.result;
    }
  } catch (error) {
    console.error('Failed to generate session title:', error);
  }

  // Fallback: use first 50 chars of user input
  return userIntent.slice(0, 50) + (userIntent.length > 50 ? '...' : '');
};
