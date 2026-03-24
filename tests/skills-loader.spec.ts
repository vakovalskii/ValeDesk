import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const updateSkillsList = vi.fn();
const getEnabledRepositories = vi.fn();

vi.mock("../src/agent/libs/skills-store.js", () => ({
  loadSkillsSettings: () => ({
    repositories: [
      {
        id: "default",
        name: "Default",
        type: "github",
        url: "https://api.github.com/repos/example/repo/contents/skills",
        enabled: true
      }
    ],
    skills: []
  }),
  updateSkillsList,
  getEnabledRepositories
}));

const SKILL_MD = `---
name: Skill A
description: Test skill
---
`;

describe("parseMarketplaceUrl", () => {
  it("parses standard GitHub API URL with default branch", async () => {
    const { parseMarketplaceUrl } = await import("../src/agent/libs/skills-loader.ts");
    const result = parseMarketplaceUrl("https://api.github.com/repos/owner/repo/contents/skills");
    expect(result).toMatchObject({ owner: "owner", repo: "repo", branch: "main", basePath: "skills" });
  });

  it("parses GitHub API URL with ?ref= branch parameter", async () => {
    const { parseMarketplaceUrl } = await import("../src/agent/libs/skills-loader.ts");
    const result = parseMarketplaceUrl("https://api.github.com/repos/owner/repo/contents/skills?ref=dev");
    expect(result).toMatchObject({ owner: "owner", repo: "repo", branch: "dev" });
  });

  it("returns null for non-GitHub URLs", async () => {
    const { parseMarketplaceUrl } = await import("../src/agent/libs/skills-loader.ts");
    expect(parseMarketplaceUrl("http://localhost:8080/skills")).toBeNull();
    expect(parseMarketplaceUrl("/local/path")).toBeNull();
  });

  it("falls back to main when no ref parameter", async () => {
    const { parseMarketplaceUrl } = await import("../src/agent/libs/skills-loader.ts");
    const result = parseMarketplaceUrl("https://api.github.com/repos/foo/bar/contents/");
    expect(result?.branch).toBe("main");
  });
});

describe("fetchFromLocal (via fetchSkillsFromMarketplace)", () => {
  const tmpBase = join(tmpdir(), "valedesk-test-skills-" + Date.now());

  beforeEach(() => {
    vi.clearAllMocks();
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
  });

  it("reads skills from a local directory", async () => {
    const skillDir = join(tmpBase, "my-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), SKILL_MD, "utf-8");

    getEnabledRepositories.mockReturnValue([
      { id: "local1", name: "Local", type: "local", url: tmpBase, enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("Skill A");
    expect(skills[0].repositoryId).toBe("local1");
    expect(updateSkillsList).toHaveBeenCalledTimes(1);
  });

  it("returns empty array for empty local directory", async () => {
    getEnabledRepositories.mockReturnValue([
      { id: "local1", name: "Local", type: "local", url: tmpBase, enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills).toHaveLength(0);
  });

  it("throws for non-existent local directory", async () => {
    getEnabledRepositories.mockReturnValue([
      { id: "local1", name: "Local", type: "local", url: join(tmpBase, "nonexistent"), enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    // Should not throw (error is caught per repo) but return empty
    const skills = await fetchSkillsFromMarketplace();
    expect(skills).toHaveLength(0);
  });
});

describe("fetchFromHttp (via fetchSkillsFromMarketplace)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches skills from HTTP server with index.json", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ["skill-a"] })   // index.json
      .mockResolvedValueOnce({ ok: true, text: async () => SKILL_MD });     // skill-a/SKILL.md

    global.fetch = fetchMock as any;

    getEnabledRepositories.mockReturnValue([
      { id: "http1", name: "HTTP", type: "http", url: "http://localhost:8080/skills", enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("Skill A");
    expect(skills[0].repositoryId).toBe("http1");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/skills/index.json");
  });

  it("returns empty when index.json is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 });
    global.fetch = fetchMock as any;

    getEnabledRepositories.mockReturnValue([
      { id: "http1", name: "HTTP", type: "http", url: "http://localhost:8080/skills", enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();
    expect(skills).toHaveLength(0);
  });
});

describe("fetchSkillsFromMarketplace (multi-repo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges skills from multiple repositories with correct repositoryId", async () => {
    const skillsListing = [
      { name: "skill-a", path: "skills/skill-a", type: "dir", url: "url-a" }
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => skillsListing })      // github listing
      .mockResolvedValueOnce({ ok: true, text: async () => SKILL_MD })           // github SKILL.md
      .mockResolvedValueOnce({ ok: true, json: async () => ["skill-b"] })        // http index.json
      .mockResolvedValueOnce({ ok: true, text: async () => `---\nname: Skill B\ndescription: Another skill\n---\n` });

    global.fetch = fetchMock as any;

    getEnabledRepositories.mockReturnValue([
      { id: "gh1", name: "GitHub", type: "github", url: "https://api.github.com/repos/owner/repo/contents/skills", enabled: true },
      { id: "http1", name: "HTTP", type: "http", url: "http://localhost/skills", enabled: true }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills.length).toBe(2);
    expect(skills.find(s => s.repositoryId === "gh1")).toBeDefined();
    expect(skills.find(s => s.repositoryId === "http1")).toBeDefined();
    expect(updateSkillsList).toHaveBeenCalledWith(skills);
  });

  it("skips disabled repositories", async () => {
    getEnabledRepositories.mockReturnValue([]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills).toHaveLength(0);
    expect(updateSkillsList).toHaveBeenCalledWith([]);
  });
});

describe("legacy skills loader test (github with branch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches marketplace skills using dynamic branch from URL", async () => {
    const skillsListing = [
      { name: "skill-a", path: "skills/creative/skill-a", type: "dir", url: "url-a" },
      { name: "skill-b", path: "skills/dev/skill-b", type: "dir", url: "url-b" }
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => skillsListing })
      .mockResolvedValueOnce({ ok: true, text: async () => SKILL_MD })
      .mockResolvedValueOnce({ ok: true, text: async () => SKILL_MD });

    global.fetch = fetchMock as any;

    getEnabledRepositories.mockReturnValue([
      {
        id: "default",
        name: "Default",
        type: "github",
        url: "https://api.github.com/repos/example/repo/contents/skills?ref=feature",
        enabled: true
      }
    ]);

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills.length).toBe(2);
    expect(updateSkillsList).toHaveBeenCalledTimes(1);

    // Verify raw URL uses the custom branch
    const rawUrls = fetchMock.mock.calls.slice(1).map((c: any[]) => c[0] as string);
    expect(rawUrls[0]).toContain("/feature/");
  });
});
