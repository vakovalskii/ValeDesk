import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import {
  Skill,
  SkillMetadata,
  SkillRepository,
  loadSkillsSettings,
  updateSkillsList,
  getEnabledRepositories
} from "./skills-store.js";

const WORKSPACE_DIR = ".valedesk";
const SKILLS_SUBDIR = "skills";
const GLOBAL_APP_DIR = path.join("Library", "Application Support", "ValeDesk");

/**
 * Get skills directory path.
 * If cwd is provided, use {cwd}/skills/  (project-local)
 * Otherwise, use global ~/Library/Application Support/ValeDesk/skills/
 */
function getSkillsDir(cwd?: string): string {
  if (cwd && cwd.trim()) {
    // Project-local: {cwd}/skills/
    return path.join(cwd, SKILLS_SUBDIR);
  }
  // Global fallback: ~/Library/Application Support/ValeDesk/skills/
  return path.join(homedir(), GLOBAL_APP_DIR, SKILLS_SUBDIR);
}

/**
 * Get global skills directory (fallback when no cwd)
 */
function getGlobalSkillsDir(): string {
  return path.join(homedir(), GLOBAL_APP_DIR, SKILLS_SUBDIR);
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

// Cache for parsed URL info (PR #75)
const urlParseCache = new Map<string, { owner: string; repo: string; branch: string; basePath: string } | null>();

/**
 * Parse GitHub API or raw URL to extract owner, repo, branch, and base path.
 * Supports:
 *   - https://api.github.com/repos/owner/repo/contents/path
 *   - https://api.github.com/repos/owner/repo/contents/path?ref=branch
 * Returns null for non-GitHub URLs.
 *
 * PR #75: replaces hardcoded 'main' branch with dynamic parsing
 */
export function parseMarketplaceUrl(url: string): { owner: string; repo: string; branch: string; basePath: string } | null {
  if (urlParseCache.has(url)) {
    return urlParseCache.get(url)!;
  }

  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/?(.*)$/);
    if (!match || !parsed.hostname.includes("github.com")) {
      urlParseCache.set(url, null);
      return null;
    }

    const result = {
      owner: match[1],
      repo: match[2],
      branch: parsed.searchParams.get("ref") || "main",
      basePath: match[3] || ""
    };
    urlParseCache.set(url, result);
    return result;
  } catch {
    urlParseCache.set(url, null);
    return null;
  }
}

/**
 * Fetch skills from a GitHub API repository
 */
async function fetchFromGitHub(repo: SkillRepository): Promise<Skill[]> {
  const urlInfo = parseMarketplaceUrl(repo.url);
  if (!urlInfo) {
    throw new Error(`Invalid GitHub marketplace URL: ${repo.url}`);
  }

  const response = await fetch(repo.url, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "ValeDesk"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const contents: GitHubContent[] = await response.json();
  const skills: Skill[] = [];

  // Filter only directories (each skill is a directory)
  const skillDirs = contents.filter(item => item.type === "dir");

  for (const dir of skillDirs) {
    try {
      const skillMdUrl = `https://raw.githubusercontent.com/${urlInfo.owner}/${urlInfo.repo}/${urlInfo.branch}/${dir.path}/SKILL.md`;
      const skillMdResponse = await fetch(skillMdUrl);

      if (skillMdResponse.ok) {
        const skillMdContent = await skillMdResponse.text();
        const metadata = parseSkillMd(skillMdContent);

        if (metadata) {
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
            repositoryId: repo.id,
            enabled: false
          });
        }
      }
    } catch (error) {
      console.warn(`[SkillsLoader] Failed to fetch skill ${dir.name} from ${repo.name}:`, error);
    }
  }

  return skills;
}

/**
 * Fetch skills from a local filesystem directory.
 * Expects: {url}/{skillId}/SKILL.md
 */
async function fetchFromLocal(repo: SkillRepository): Promise<Skill[]> {
  const baseDir = repo.url;

  if (!fs.existsSync(baseDir)) {
    throw new Error(`Local skills directory not found: ${baseDir}`);
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const skillDirs = entries.filter(e => e.isDirectory());
  const skills: Skill[] = [];

  for (const dir of skillDirs) {
    try {
      const skillMdPath = path.join(baseDir, dir.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, "utf-8");
      const metadata = parseSkillMd(content);

      if (metadata) {
        skills.push({
          id: metadata.name,
          name: metadata.name,
          description: metadata.description,
          category: "local",
          author: metadata.metadata?.author,
          version: metadata.metadata?.version,
          license: metadata.license,
          compatibility: metadata.compatibility,
          repoPath: dir.name,
          repositoryId: repo.id,
          enabled: false
        });
      }
    } catch (error) {
      console.warn(`[SkillsLoader] Failed to read local skill ${dir.name}:`, error);
    }
  }

  return skills;
}

/**
 * Fetch skills from a plain HTTP server.
 * Convention:
 *   {baseUrl}/index.json        → string[] of skill directory names
 *   {baseUrl}/{skillId}/SKILL.md → skill metadata
 */
async function fetchFromHttp(repo: SkillRepository): Promise<Skill[]> {
  const baseUrl = repo.url.replace(/\/$/, "");

  const indexResponse = await fetch(`${baseUrl}/index.json`);
  if (!indexResponse.ok) {
    throw new Error(`HTTP repository index not found at ${baseUrl}/index.json (status: ${indexResponse.status})`);
  }

  const skillIds: string[] = await indexResponse.json();
  const skills: Skill[] = [];

  for (const skillId of skillIds) {
    try {
      const skillMdResponse = await fetch(`${baseUrl}/${skillId}/SKILL.md`);
      if (!skillMdResponse.ok) continue;

      const content = await skillMdResponse.text();
      const metadata = parseSkillMd(content);

      if (metadata) {
        skills.push({
          id: metadata.name,
          name: metadata.name,
          description: metadata.description,
          category: "http",
          author: metadata.metadata?.author,
          version: metadata.metadata?.version,
          license: metadata.license,
          compatibility: metadata.compatibility,
          repoPath: skillId,
          repositoryId: repo.id,
          enabled: false
        });
      }
    } catch (error) {
      console.warn(`[SkillsLoader] Failed to fetch HTTP skill ${skillId} from ${repo.name}:`, error);
    }
  }

  return skills;
}

/**
 * Fetch skill list from all enabled repositories
 */
export async function fetchSkillsFromMarketplace(): Promise<Skill[]> {
  const repositories = getEnabledRepositories();

  console.log(`[SkillsLoader] Fetching skills from ${repositories.length} repositories`);

  const allSkills: Skill[] = [];

  for (const repo of repositories) {
    try {
      let repoSkills: Skill[];

      switch (repo.type) {
        case "github":
          repoSkills = await fetchFromGitHub(repo);
          break;
        case "local":
          repoSkills = await fetchFromLocal(repo);
          break;
        case "http":
          repoSkills = await fetchFromHttp(repo);
          break;
        default:
          console.warn(`[SkillsLoader] Unknown repository type: ${(repo as any).type}`);
          continue;
      }

      console.log(`[SkillsLoader] Fetched ${repoSkills.length} skills from ${repo.name} (${repo.type})`);
      allSkills.push(...repoSkills);
    } catch (error) {
      console.error(`[SkillsLoader] Failed to fetch from repository ${repo.name}:`, error);
    }
  }

  console.log(`[SkillsLoader] Total: ${allSkills.length} skills`);

  // Update store with merged skills list
  updateSkillsList(allSkills);

  return allSkills;
}

/**
 * Download and cache a skill's full contents
 * @param skillId - The skill ID to download
 * @param cwd - Optional working directory. If provided, skill is saved to {cwd}/skills/
 */
export async function downloadSkill(skillId: string, cwd?: string): Promise<string> {
  const settings = loadSkillsSettings();
  const skill = settings.skills.find(s => s.id === skillId);

  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // Find the repository this skill belongs to
  const repo = settings.repositories.find(r => r.id === skill.repositoryId);

  const skillsDir = ensureSkillsDir(cwd);
  const skillCacheDir = path.join(skillsDir, skillId);

  console.log(`[SkillsLoader] Downloading skill: ${skillId} to ${skillCacheDir}`);

  if (!fs.existsSync(skillCacheDir)) {
    fs.mkdirSync(skillCacheDir, { recursive: true });
  }

  if (!repo) {
    throw new Error(`Repository not found for skill: ${skillId} (repositoryId: ${skill.repositoryId})`);
  }

  switch (repo.type) {
    case "github":
      await downloadSkillFromGitHub(skill, repo, skillCacheDir);
      break;
    case "local":
      // For local repos, return the source path directly (no download needed)
      return path.join(repo.url, skill.repoPath);
    case "http":
      await downloadSkillFromHttp(skill, repo, skillCacheDir);
      break;
    default:
      throw new Error(`Unsupported repository type: ${(repo as any).type}`);
  }

  return skillCacheDir;
}

async function downloadSkillFromGitHub(
  skill: Skill,
  repo: SkillRepository,
  skillCacheDir: string
): Promise<void> {
  const urlInfo = parseMarketplaceUrl(repo.url);
  if (!urlInfo) {
    throw new Error(`Invalid GitHub marketplace URL: ${repo.url}`);
  }

  const contentsUrl = `https://api.github.com/repos/${urlInfo.owner}/${urlInfo.repo}/contents/${skill.repoPath}`;
  const response = await fetch(contentsUrl, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "ValeDesk"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const contents: GitHubContent[] = await response.json();
  await downloadContents(contents, skillCacheDir, skill.repoPath, urlInfo);
}

async function downloadSkillFromHttp(
  skill: Skill,
  repo: SkillRepository,
  skillCacheDir: string
): Promise<void> {
  const baseUrl = repo.url.replace(/\/$/, "");

  // Download SKILL.md
  const skillMdResponse = await fetch(`${baseUrl}/${skill.repoPath}/SKILL.md`);
  if (!skillMdResponse.ok) {
    throw new Error(`Failed to download SKILL.md for ${skill.id}`);
  }
  fs.writeFileSync(path.join(skillCacheDir, "SKILL.md"), await skillMdResponse.text(), "utf-8");

  // Check for optional files.json listing additional files
  try {
    const filesResponse = await fetch(`${baseUrl}/${skill.repoPath}/files.json`);
    if (filesResponse.ok) {
      const files: string[] = await filesResponse.json();
      for (const file of files) {
        const fileResponse = await fetch(`${baseUrl}/${skill.repoPath}/${file}`);
        if (fileResponse.ok) {
          const filePath = path.join(skillCacheDir, file);
          const fileDir = path.dirname(filePath);
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
          }
          fs.writeFileSync(filePath, await fileResponse.text(), "utf-8");
        }
      }
    }
  } catch {
    // files.json is optional, ignore errors
  }
}

async function downloadContents(
  contents: GitHubContent[],
  targetDir: string,
  basePath: string,
  urlInfo: { owner: string; repo: string; branch: string }
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

      const subContentsUrl = `https://api.github.com/repos/${urlInfo.owner}/${urlInfo.repo}/contents/${item.path}`;
      const subResponse = await fetch(subContentsUrl, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "ValeDesk"
        }
      });

      if (subResponse.ok) {
        const subContents: GitHubContent[] = await subResponse.json();
        await downloadContents(subContents, localPath, item.path, urlInfo);
      }
    }
  }
}

/**
 * Get cached skill directory path (or download if not cached)
 * For local repos, returns the source path directly.
 * Checks both workspace-local and global cache for github/http skills.
 * @param skillId - The skill ID
 * @param cwd - Optional working directory
 */
export async function getSkillPath(skillId: string, cwd?: string): Promise<string> {
  const settings = loadSkillsSettings();
  const skill = settings.skills.find(s => s.id === skillId);

  // For local repos, serve directly from source
  if (skill) {
    const repo = settings.repositories.find(r => r.id === skill.repositoryId);
    if (repo?.type === "local") {
      return path.join(repo.url, skill.repoPath);
    }
  }

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
