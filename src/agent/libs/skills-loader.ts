import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { Skill, SkillMetadata, loadSkillsSettings, updateSkillsList } from "./skills-store.js";

const LOCALDESK_DIR = ".localdesk";
const SKILLS_SUBDIR = "skills";

/**
 * Get skills directory path.
 * If cwd is provided, use {cwd}/skills/  (project-local)
 * Otherwise, use global ~/.localdesk/skills/
 */
function getSkillsDir(cwd?: string): string {
  if (cwd && cwd.trim()) {
    // Project-local: {cwd}/skills/
    return path.join(cwd, SKILLS_SUBDIR);
  }
  // Global fallback: ~/.localdesk/skills/
  return path.join(homedir(), LOCALDESK_DIR, SKILLS_SUBDIR);
}

/**
 * Get global skills directory (fallback when no cwd)
 */
function getGlobalSkillsDir(): string {
  return path.join(homedir(), LOCALDESK_DIR, SKILLS_SUBDIR);
}

interface GitHubContent {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url?: string;
  url: string;
}

function ensureSkillsDir(cwd?: string): string {
  const skillsDir = getSkillsDir(cwd);
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

/**
 * Parse SKILL.md frontmatter to extract metadata
 */
function parseSkillMd(content: string): SkillMetadata | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const metadata: SkillMetadata = {
    name: "",
    description: ""
  };

  // Parse YAML-like frontmatter (simple parser)
  const lines = frontmatter.split(/\r?\n/);
  let currentKey = "";
  let inMetadata = false;

  for (const line of lines) {
    if (line.startsWith("metadata:")) {
      inMetadata = true;
      metadata.metadata = {};
      continue;
    }

    if (inMetadata && line.match(/^\s{2}\w+:/)) {
      const match = line.match(/^\s{2}(\w+):\s*"?([^"]*)"?$/);
      if (match && metadata.metadata) {
        metadata.metadata[match[1]] = match[2];
      }
      continue;
    }

    if (!line.startsWith(" ") && line.includes(":")) {
      inMetadata = false;
      const colonIndex = line.indexOf(":");
      currentKey = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, "");

      switch (currentKey) {
        case "name":
          metadata.name = value;
          break;
        case "description":
          metadata.description = value;
          break;
        case "license":
          metadata.license = value;
          break;
        case "compatibility":
          metadata.compatibility = value;
          break;
        case "allowed-tools":
          metadata.allowedTools = value.split(/\s+/);
          break;
      }
    }
  }

  return metadata.name && metadata.description ? metadata : null;
}

/**
 * Fetch skill list from GitHub marketplace
 */
export async function fetchSkillsFromMarketplace(): Promise<Skill[]> {
  const settings = loadSkillsSettings();
  const marketplaceUrl = settings.marketplaceUrl;

  console.log("[SkillsLoader] Fetching skills from:", marketplaceUrl);

  try {
    // Fetch skills directory listing
    const response = await fetch(marketplaceUrl, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "LocalDesk"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const contents: GitHubContent[] = await response.json();
    const skills: Skill[] = [];

    // Filter only directories (each skill is a directory)
    const skillDirs = contents.filter(item => item.type === "dir");

    // Fetch SKILL.md for each skill
    for (const dir of skillDirs) {
      try {
        const skillMdUrl = `https://raw.githubusercontent.com/vakovalskii/LocalDesk-Skills/main/${dir.path}/SKILL.md`;
        const skillMdResponse = await fetch(skillMdUrl);

        if (skillMdResponse.ok) {
          const skillMdContent = await skillMdResponse.text();
          const metadata = parseSkillMd(skillMdContent);

          if (metadata) {
            // Determine category from path (e.g., "skills/creative/art" -> "creative")
            const pathParts = dir.path.split("/");
            const category = pathParts.length > 2 ? pathParts[1] : "general";

            skills.push({
              id: metadata.name,
              name: metadata.name,
              description: metadata.description,
              category,
              author: metadata.metadata?.author,
              version: metadata.metadata?.version,
              license: metadata.license,
              compatibility: metadata.compatibility,
              repoPath: dir.path,
              enabled: false
            });
          }
        }
      } catch (error) {
        console.warn(`[SkillsLoader] Failed to fetch skill ${dir.name}:`, error);
      }
    }

    console.log(`[SkillsLoader] Fetched ${skills.length} skills`);

    // Update store with new skills list
    updateSkillsList(skills);

    return skills;
  } catch (error) {
    console.error("[SkillsLoader] Failed to fetch skills:", error);
    throw error;
  }
}

/**
 * Download and cache a skill's full contents
 * @param skillId - The skill ID to download
 * @param cwd - Optional working directory. If provided, skill is saved to {cwd}/.localdesk/skills/
 */
export async function downloadSkill(skillId: string, cwd?: string): Promise<string> {
  const settings = loadSkillsSettings();
  const skill = settings.skills.find(s => s.id === skillId);

  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  const skillsDir = ensureSkillsDir(cwd);
  const skillCacheDir = path.join(skillsDir, skillId);

  console.log(`[SkillsLoader] Downloading skill: ${skillId} to ${skillCacheDir}`);

  // Create skill cache directory
  if (!fs.existsSync(skillCacheDir)) {
    fs.mkdirSync(skillCacheDir, { recursive: true });
  }

  // Fetch skill directory contents
  const contentsUrl = `https://api.github.com/repos/vakovalskii/LocalDesk-Skills/contents/${skill.repoPath}`;
  const response = await fetch(contentsUrl, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "LocalDesk"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const contents: GitHubContent[] = await response.json();

  // Download all files recursively
  await downloadContents(contents, skillCacheDir, skill.repoPath);

  return skillCacheDir;
}

async function downloadContents(
  contents: GitHubContent[],
  targetDir: string,
  basePath: string
): Promise<void> {
  for (const item of contents) {
    const localPath = path.join(targetDir, item.name);

    if (item.type === "file" && item.download_url) {
      // Download file
      const response = await fetch(item.download_url);
      const content = await response.text();
      fs.writeFileSync(localPath, content, "utf-8");
    } else if (item.type === "dir") {
      // Create directory and fetch its contents
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
      }

      const subContentsUrl = `https://api.github.com/repos/vakovalskii/LocalDesk-Skills/contents/${item.path}`;
      const subResponse = await fetch(subContentsUrl, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "LocalDesk"
        }
      });

      if (subResponse.ok) {
        const subContents: GitHubContent[] = await subResponse.json();
        await downloadContents(subContents, localPath, item.path);
      }
    }
  }
}

/**
 * Get cached skill directory path (or download if not cached)
 * Checks both workspace-local and global cache
 * @param skillId - The skill ID
 * @param cwd - Optional working directory
 */
export async function getSkillPath(skillId: string, cwd?: string): Promise<string> {
  // First check workspace-local cache
  if (cwd) {
    const localSkillDir = path.join(getSkillsDir(cwd), skillId);
    if (fs.existsSync(localSkillDir) && fs.existsSync(path.join(localSkillDir, "SKILL.md"))) {
      return localSkillDir;
    }
  }

  // Then check global cache
  const globalSkillDir = path.join(getGlobalSkillsDir(), skillId);
  if (fs.existsSync(globalSkillDir) && fs.existsSync(path.join(globalSkillDir, "SKILL.md"))) {
    return globalSkillDir;
  }

  // Download to workspace-local or global (based on cwd)
  return downloadSkill(skillId, cwd);
}

/**
 * Read skill's SKILL.md content
 * @param skillId - The skill ID
 * @param cwd - Optional working directory
 */
export async function readSkillContent(skillId: string, cwd?: string): Promise<string> {
  const skillPath = await getSkillPath(skillId, cwd);
  const skillMdPath = path.join(skillPath, "SKILL.md");

  if (fs.existsSync(skillMdPath)) {
    return fs.readFileSync(skillMdPath, "utf-8");
  }

  throw new Error(`SKILL.md not found for: ${skillId}`);
}

/**
 * List files in a skill directory
 * @param skillId - The skill ID
 * @param cwd - Optional working directory
 */
export async function listSkillFiles(skillId: string, cwd?: string): Promise<string[]> {
  const skillPath = await getSkillPath(skillId, cwd);
  const files: string[] = [];

  function walkDir(dir: string, prefix: string = ""): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walkDir(path.join(dir, entry.name), relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walkDir(skillPath);
  return files;
}

/**
 * Read a specific file from a skill
 * @param skillId - The skill ID
 * @param filePath - Relative path within the skill
 * @param cwd - Optional working directory
 */
export async function readSkillFile(skillId: string, filePath: string, cwd?: string): Promise<string> {
  const skillPath = await getSkillPath(skillId, cwd);
  const fullPath = path.join(skillPath, filePath);

  // Security check - prevent path traversal
  if (!fullPath.startsWith(skillPath)) {
    throw new Error("Invalid file path");
  }

  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, "utf-8");
  }

  throw new Error(`File not found: ${filePath}`);
}

/**
 * Clear skills cache
 * @param cwd - Optional working directory. If provided, clears workspace-local cache. Otherwise clears global cache.
 */
export function clearSkillsCache(cwd?: string): void {
  const skillsDir = getSkillsDir(cwd);

  if (fs.existsSync(skillsDir)) {
    fs.rmSync(skillsDir, { recursive: true, force: true });
    console.log(`[SkillsLoader] Skills cache cleared: ${skillsDir}`);
  }
}

/**
 * List all downloaded skills (both local and global)
 * @param cwd - Optional working directory
 */
export function listDownloadedSkills(cwd?: string): { local: string[], global: string[] } {
  const result = { local: [] as string[], global: [] as string[] };

  // Check workspace-local
  if (cwd) {
    const localDir = getSkillsDir(cwd);
    if (fs.existsSync(localDir)) {
      result.local = fs.readdirSync(localDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    }
  }

  // Check global
  const globalDir = getGlobalSkillsDir();
  if (fs.existsSync(globalDir)) {
    result.global = fs.readdirSync(globalDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  return result;
}
