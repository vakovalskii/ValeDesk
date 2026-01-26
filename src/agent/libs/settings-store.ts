import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { ApiSettings } from "../types.js";
import { createRequire } from "module";
// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

const SETTINGS_FILE = "api-settings.json";

function getUserDataDir(): string {
  const envDir = process.env.LOCALDESK_USER_DATA_DIR;
  if (envDir && envDir.trim()) return envDir;

  const electronVersion = (process.versions as any)?.electron;
  if (!electronVersion) {
    throw new Error("[Settings] LOCALDESK_USER_DATA_DIR is required outside Electron");
  }

  const electron = require("electron");
  return electron.app.getPath("userData");
}

function getSettingsPath(): string {
  return join(getUserDataDir(), SETTINGS_FILE);
}

export function loadApiSettings(): ApiSettings | null {
  try {
    const settingsPath = getSettingsPath();
    if (!existsSync(settingsPath)) {
      return null;
    }

    const raw = readFileSync(settingsPath, "utf8");

    // Check if file is empty or contains only whitespace
    if (!raw || raw.trim() === '') {
      return null;
    }

    const settings = JSON.parse(raw) as ApiSettings;

    // Set default permissionMode to 'ask' if not specified
    if (!settings.permissionMode) {
      settings.permissionMode = 'ask';
    }

    // Return settings even if apiKey is empty (we now use LLM providers)
    return settings;
  } catch (error) {
    console.error("[Settings] Failed to load API settings:", error);
    return null;
  }
}

export function saveApiSettings(settings: ApiSettings): void {
  try {
    const settingsPath = getSettingsPath();
    const dir = dirname(settingsPath);

    // Ensure directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save API settings:", error);
    throw new Error("Failed to save settings");
  }
}
