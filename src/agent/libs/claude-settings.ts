import type { ClaudeSettingsEnv, ApiSettings } from "../types.js";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_SETTINGS_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_MODEL",
  "API_TIMEOUT_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
] as const;

export function loadClaudeSettingsEnv(guiSettings?: ApiSettings | null): ClaudeSettingsEnv {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> };
    if (parsed.env) {
      for (const [key, value] of Object.entries(parsed.env)) {
        if (process.env[key] === undefined && value !== undefined && value !== null) {
          process.env[key] = String(value);
        }
      }
    }
  } catch {
    // Ignore missing or invalid settings file.
  }

  // Apply GUI settings with priority
  if (guiSettings) {
    if (guiSettings.apiKey) {
      process.env.ANTHROPIC_AUTH_TOKEN = guiSettings.apiKey;
    }
    if (guiSettings.baseUrl) {
      process.env.ANTHROPIC_BASE_URL = guiSettings.baseUrl;
    }
    if (guiSettings.model) {
      process.env.ANTHROPIC_MODEL = guiSettings.model;
    }
  }

  const env = {} as ClaudeSettingsEnv;
  for (const key of CLAUDE_SETTINGS_ENV_KEYS) {
    env[key] = process.env[key] ?? "";
  }
  return env;
}

export const claudeCodeEnv = loadClaudeSettingsEnv();
