import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const tmpDir = join(tmpdir(), "valedesk-skills-store-test-" + Date.now());

// Set VALERA_USER_DATA_DIR before any module loads
process.env.VALERA_USER_DATA_DIR = tmpDir;

describe("skills-store", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    // Clear module cache so each test gets fresh state
    vi.resetModules();
  });

  it("returns default repository when no settings file exists", async () => {
    const { loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");
    const settings = loadSkillsSettings();
    expect(settings.repositories).toHaveLength(1);
    expect(settings.repositories[0].type).toBe("github");
    expect(settings.repositories[0].id).toBe("default");
    expect(settings.skills).toHaveLength(0);
  });

  it("migrates legacy marketplaceUrl to repositories", async () => {
    const legacySettings = {
      marketplaceUrl: "https://api.github.com/repos/custom/repo/contents/skills",
      skills: [
        { id: "s1", name: "Skill 1", description: "desc", repoPath: "skills/s1", enabled: true }
      ],
      lastFetched: 12345
    };
    writeFileSync(join(tmpDir, "skills-settings.json"), JSON.stringify(legacySettings), "utf-8");

    const { loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");
    const settings = loadSkillsSettings();

    expect(settings.repositories).toHaveLength(1);
    expect(settings.repositories[0].url).toBe("https://api.github.com/repos/custom/repo/contents/skills");
    expect(settings.repositories[0].type).toBe("github");
    expect(settings.skills[0].repositoryId).toBe("default");
  });

  it("addRepository creates a new repo with unique id", async () => {
    const { addRepository, loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");
    const added = addRepository({ name: "My Repo", type: "local", url: "/tmp/skills", enabled: true });

    expect(added.id).toBeTruthy();
    expect(added.name).toBe("My Repo");
    expect(added.type).toBe("local");

    const settings = loadSkillsSettings();
    expect(settings.repositories.find(r => r.id === added.id)).toBeDefined();
  });

  it("removeRepository deletes repo and its skills", async () => {
    const { addRepository, removeRepository, updateSkillsList, loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");
    const repo = addRepository({ name: "Temp", type: "http", url: "http://x.x/s", enabled: true });

    // Simulate skills belonging to this repo
    updateSkillsList([
      { id: "s1", name: "S1", description: "d", repoPath: "s1", repositoryId: repo.id, enabled: true },
      { id: "s2", name: "S2", description: "d", repoPath: "s2", repositoryId: "other", enabled: true }
    ]);

    removeRepository(repo.id);

    const settings = loadSkillsSettings();
    expect(settings.repositories.find(r => r.id === repo.id)).toBeUndefined();
    expect(settings.skills.find(s => s.repositoryId === repo.id)).toBeUndefined();
    expect(settings.skills.find(s => s.repositoryId === "other")).toBeDefined();
  });

  it("updateRepository changes repo fields", async () => {
    const { addRepository, updateRepository, loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");
    const repo = addRepository({ name: "Old Name", type: "github", url: "https://x.com", enabled: true });

    updateRepository(repo.id, { name: "New Name", url: "https://y.com" });

    const settings = loadSkillsSettings();
    const updated = settings.repositories.find(r => r.id === repo.id);
    expect(updated?.name).toBe("New Name");
    expect(updated?.url).toBe("https://y.com");
    expect(updated?.type).toBe("github"); // unchanged
  });

  it("updateSkillsList preserves enabled state across reload", async () => {
    const { updateSkillsList, toggleSkill, loadSkillsSettings } = await import("../src/agent/libs/skills-store.ts");

    updateSkillsList([
      { id: "s1", name: "S1", description: "d", repoPath: "s1", repositoryId: "default", enabled: false }
    ]);
    toggleSkill("s1", true);

    // Simulate re-fetch (same skill, new metadata)
    updateSkillsList([
      { id: "s1", name: "S1 Updated", description: "d2", repoPath: "s1", repositoryId: "default", enabled: false }
    ]);

    const settings = loadSkillsSettings();
    const skill = settings.skills.find(s => s.id === "s1");
    expect(skill?.enabled).toBe(true); // preserved
    expect(skill?.name).toBe("S1 Updated"); // updated
  });
});
