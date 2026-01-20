import { app } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { ApiSettings } from "../types.js";
import { loadLLMProviderSettings, saveLLMProviderSettings } from "./llm-providers-store.js";

const SETTINGS_FILE = "api-settings.json";

function getSettingsPath(): string {
  const userDataPath = app.getPath("userData");
  return join(userDataPath, SETTINGS_FILE);
}

export function loadApiSettings(): ApiSettings | null {
  try {
    const settingsPath = getSettingsPath();
    if (!existsSync(settingsPath)) {
      console.log('[Settings] Settings file does not exist');
      return null;
    }
    
    const raw = readFileSync(settingsPath, "utf8");
    
    // Check if file is empty or contains only whitespace
    if (!raw || raw.trim() === '') {
      console.log('[Settings] Settings file is empty');
      return null;
    }
    
    const settings = JSON.parse(raw) as ApiSettings;
    
    // Check if apiKey is missing or invalid (but still return settings)
    if (!settings.apiKey || 
        settings.apiKey.trim() === '' || 
        settings.apiKey === 'null' || 
        settings.apiKey === 'undefined') {
      console.log('[Settings] API key is missing or invalid (but loading other settings)');
    }
    
    // Set default permissionMode to 'ask' if not specified
    if (!settings.permissionMode) {
      settings.permissionMode = 'ask';
    }
    
    // Load LLM providers from separate file and merge them
    // Priority: separate file > main file
    try {
      const providerSettings = loadLLMProviderSettings();
      if (providerSettings && (providerSettings.providers.length > 0 || providerSettings.models.length > 0)) {
        // Use provider settings from separate file if they exist (they are more up-to-date)
        settings.llmProviders = providerSettings;
      } else if (!settings.llmProviders) {
        // If no providers in separate file and no providers in main file, initialize empty
        settings.llmProviders = { providers: [], models: [] };
      }
    } catch (error) {
      // Ignore errors loading provider settings
      console.log('[Settings] Could not load provider settings from separate file:', error);
      // If we couldn't load from separate file and main file doesn't have providers, initialize empty
      if (!settings.llmProviders) {
        settings.llmProviders = { providers: [], models: [] };
      }
    }
    
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
    
    // Save LLM providers separately if they exist
    if (settings.llmProviders) {
      try {
        saveLLMProviderSettings(settings.llmProviders);
      } catch (error) {
        console.error("[Settings] Failed to save LLM provider settings separately:", error);
        // Continue with saving main settings even if provider save fails
      }
    }
    
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save API settings:", error);
    throw new Error("Failed to save settings");
  }
}
