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

export type SkillRepositoryType = "github" | "local" | "http";

export interface SkillRepository {
  id: string;
  name: string;
  type: SkillRepositoryType;
  url: string; // GitHub API URL | local filesystem path | http base URL
  enabled: boolean;
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
  repoPath: string; // Path within the repository (e.g., "skills/pdf-processing")
  repositoryId: string; // Which repository this skill belongs to
  enabled: boolean;
  lastUpdated?: number;
}

export interface SkillsSettings {
  repositories: SkillRepository[];
  skills: Skill[];
  lastFetched?: number;
}

// Legacy settings format for migration
interface LegacySkillsSettings {
  marketplaceUrl?: string;
  skills?: Array<Omit<Skill, "repositoryId"> & { repositoryId?: string }>;
  lastFetched?: number;
}

const DEFAULT_REPOSITORY: SkillRepository = {
  id: "default",
  name: "Default",
  type: "github",
  url: "https://api.github.com/repos/vakovalskii/LocalDesk-Skills/contents/skills",
  enabled: true
};

// In pkg binary, import.meta.url is undefined. Use eval to get require in CJS context.
const require = (process as any).pkg
  ? eval('require')
  : (typeof globalThis.require === "function" ? globalThis.require : createRequire(import.meta.url));

function getUserDataDir(): string {
  const envDir = process.env.VALERA_USER_DATA_DIR;
  if (envDir && envDir.trim()) return envDir;

  const electronVersion = (process.versions as any)?.electron;
  if (!electronVersion) {
    throw new Error("[SkillsStore] VALERA_USER_DATA_DIR is required outside Electron");
  }

  const electron = require("electron");
  return electron.app.getPath("userData");
}

function getSettingsPath(): string {
  return path.join(getUserDataDir(), SKILLS_FILE);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function loadSkillsSettings(): SkillsSettings {
  try {
    const filePath = getSettingsPath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      const raw = JSON.parse(data) as LegacySkillsSettings & SkillsSettings;

      // Migration: old format had marketplaceUrl instead of repositories
      if (!raw.repositories && raw.marketplaceUrl) {
        const migratedRepo: SkillRepository = {
          id: "default",
          name: "Default",
          type: "github",
          url: raw.marketplaceUrl,
          enabled: true
        };
        const migratedSkills: Skill[] = (raw.skills || []).map(s => ({
          ...s,
          repositoryId: s.repositoryId ?? "default"
        }));
        return {
          repositories: [migratedRepo],
          skills: migratedSkills,
          lastFetched: raw.lastFetched
        };
      }

      const repos = raw.repositories && raw.repositories.length > 0
        ? raw.repositories
        : [{ ...DEFAULT_REPOSITORY }];
      return {
        repositories: repos,
        skills: (raw.skills || []).map(s => ({
          ...s,
          repositoryId: s.repositoryId ?? "default"
        })),
        lastFetched: raw.lastFetched
      };
    }
  } catch (error) {
    console.error("[SkillsStore] Failed to load skills settings:", error);
  }

  return {
    repositories: [{ ...DEFAULT_REPOSITORY }],
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

export function getEnabledRepositories(): SkillRepository[] {
  const settings = loadSkillsSettings();
  return settings.repositories.filter(r => r.enabled);
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

  // Preserve enabled state from existing skills (match by repositoryId + id)
  const existingEnabled = new Map(
    settings.skills.map(s => [`${s.repositoryId}:${s.id}`, s.enabled])
  );

  settings.skills = skills.map(skill => ({
    ...skill,
    enabled: existingEnabled.get(`${skill.repositoryId}:${skill.id}`) ?? false
  }));

  settings.lastFetched = Date.now();
  saveSkillsSettings(settings);
}

export function addRepository(repo: Omit<SkillRepository, "id">): SkillRepository {
  const settings = loadSkillsSettings();
  const newRepo: SkillRepository = { ...repo, id: generateId() };
  settings.repositories.push(newRepo);
  saveSkillsSettings(settings);
  return newRepo;
}

export function removeRepository(id: string): void {
  const settings = loadSkillsSettings();
  settings.repositories = settings.repositories.filter(r => r.id !== id);
  // Remove skills from that repository
  settings.skills = settings.skills.filter(s => s.repositoryId !== id);
  saveSkillsSettings(settings);
}

export function updateRepository(id: string, updates: Partial<Omit<SkillRepository, "id">>): void {
  const settings = loadSkillsSettings();
  const repo = settings.repositories.find(r => r.id === id);
  if (repo) {
    Object.assign(repo, updates);
    saveSkillsSettings(settings);
  }
}

export function toggleRepository(id: string, enabled: boolean): void {
  updateRepository(id, { enabled });
}

/** @deprecated Use repositories instead. Kept for backwards compatibility. */
export function setMarketplaceUrl(url: string): void {
  const settings = loadSkillsSettings();
  const defaultRepo = settings.repositories.find(r => r.id === "default");
  if (defaultRepo) {
    defaultRepo.url = url;
  } else {
    settings.repositories.unshift({ id: "default", name: "Default", type: "github", url, enabled: true });
  }
  saveSkillsSettings(settings);
}
