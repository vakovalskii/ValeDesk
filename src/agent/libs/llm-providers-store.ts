import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { LLMProviderSettings } from "../types.js";
import { createRequire } from "module";

const SETTINGS_FILE = "llm-providers-settings.json";

// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

function getUserDataDir(): string {
  const envDir = process.env.LOCALDESK_USER_DATA_DIR;
  if (envDir && envDir.trim()) return envDir;

  const electronVersion = (process.versions as any)?.electron;
  if (!electronVersion) {
    throw new Error("[LLM Providers] LOCALDESK_USER_DATA_DIR is required outside Electron");
  }

  const electron = require("electron");
  return electron.app.getPath("userData");
}

function getSettingsPath(): string {
  return join(getUserDataDir(), SETTINGS_FILE);
}

export function loadLLMProviderSettings(): LLMProviderSettings | null {
  try {
    const settingsPath = getSettingsPath();
    if (!existsSync(settingsPath)) {
      return { providers: [], models: [] };
    }

    const raw = readFileSync(settingsPath, "utf8");

    // Check if file is empty or contains only whitespace
    if (!raw || raw.trim() === '') {
      return { providers: [], models: [] };
    }

    const settings = JSON.parse(raw) as LLMProviderSettings;

    // Validate structure
    if (!settings.providers || !Array.isArray(settings.providers)) {
      return { providers: [], models: [] };
    }

    if (!settings.models || !Array.isArray(settings.models)) {
      return { providers: settings.providers || [], models: [] };
    }

    return settings;
  } catch (error) {
    console.error("[LLM Providers] Failed to load settings:", error);
    return { providers: [], models: [] };
  }
}

export function saveLLMProviderSettings(settings: LLMProviderSettings): void {
  try {
    const settingsPath = getSettingsPath();
    const dir = dirname(settingsPath);

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("[LLM Providers] Failed to save settings:", error);
    throw new Error("Failed to save LLM provider settings");
  }
}
