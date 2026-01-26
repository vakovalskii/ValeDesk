import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";

const SKILLS_FILE = "skills-settings.json";

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category?: string;
  author?: string;
  version?: string;
  license?: string;
  compatibility?: string;
  repoPath: string; // Path in GitHub repo (e.g., "skills/pdf-processing")
  enabled: boolean;
  lastUpdated?: number;
}

export interface SkillsSettings {
  marketplaceUrl: string;
  skills: Skill[];
  lastFetched?: number;
}

const DEFAULT_MARKETPLACE_URL = "https://api.github.com/repos/vakovalskii/LocalDesk-Skills/contents/skills";

// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

function getUserDataDir(): string {
  const envDir = process.env.LOCALDESK_USER_DATA_DIR;
  if (envDir && envDir.trim()) return envDir;

  const electronVersion = (process.versions as any)?.electron;
  if (!electronVersion) {
    throw new Error("[SkillsStore] LOCALDESK_USER_DATA_DIR is required outside Electron");
  }

  const electron = require("electron");
  return electron.app.getPath("userData");
}

function getSettingsPath(): string {
  return path.join(getUserDataDir(), SKILLS_FILE);
}

export function loadSkillsSettings(): SkillsSettings {
  const filePath = getSettingsPath();

  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      const settings = JSON.parse(data) as SkillsSettings;
      return {
        marketplaceUrl: settings.marketplaceUrl || DEFAULT_MARKETPLACE_URL,
        skills: settings.skills || [],
        lastFetched: settings.lastFetched
      };
    }
  } catch (error) {
    console.error("[SkillsStore] Failed to load skills settings:", error);
  }

  return {
    marketplaceUrl: DEFAULT_MARKETPLACE_URL,
    skills: []
  };
}

export function saveSkillsSettings(settings: SkillsSettings): void {
  const filePath = getSettingsPath();

  try {
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8");
    console.log("[SkillsStore] Skills settings saved");
  } catch (error) {
    console.error("[SkillsStore] Failed to save skills settings:", error);
  }
}

export function getEnabledSkills(): Skill[] {
  const settings = loadSkillsSettings();
  return settings.skills.filter(s => s.enabled);
}

export function toggleSkill(skillId: string, enabled: boolean): void {
  const settings = loadSkillsSettings();
  const skill = settings.skills.find(s => s.id === skillId);

  if (skill) {
    skill.enabled = enabled;
    saveSkillsSettings(settings);
  }
}

export function updateSkillsList(skills: Skill[]): void {
  const settings = loadSkillsSettings();

  // Preserve enabled state from existing skills
  const existingEnabled = new Map(
    settings.skills.map(s => [s.id, s.enabled])
  );

  settings.skills = skills.map(skill => ({
    ...skill,
    enabled: existingEnabled.get(skill.id) ?? false
  }));

  settings.lastFetched = Date.now();
  saveSkillsSettings(settings);
}

export function setMarketplaceUrl(url: string): void {
  const settings = loadSkillsSettings();
  settings.marketplaceUrl = url;
  saveSkillsSettings(settings);
}
