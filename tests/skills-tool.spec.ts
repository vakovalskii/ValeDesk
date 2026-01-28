import { describe, expect, it, vi, beforeEach } from "vitest";

const enabledSkills = [
  {
    id: "skill-1",
    name: "Skill One",
    description: "Does something",
    repoPath: "skills/skill-1",
    enabled: true
  }
];

const allSkills = [
  ...enabledSkills,
  {
    id: "skill-2",
    name: "Skill Two",
    description: "Disabled skill",
    repoPath: "skills/skill-2",
    enabled: false
  }
];

vi.mock("../src/agent/libs/skills-store.js", () => ({
  getEnabledSkills: () => enabledSkills,
  loadSkillsSettings: () => ({ marketplaceUrl: "", skills: allSkills })
}));

vi.mock("../src/agent/libs/skills-loader.js", () => ({
  readSkillContent: async () => "## Skill Content",
  listSkillFiles: async () => ["SKILL.md", "script.js"],
  readSkillFile: async () => "file contents",
  getSkillPath: async () => "/tmp/skills/skill-1"
}));

describe("skills tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists enabled skills", async () => {
    const { SkillsTool } = await import("../src/agent/libs/tools/skills-tool.ts");
    const tool = new SkillsTool();
    const result = await tool.execute({ operation: "list_available" }, { cwd: "" } as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Skill One");
    expect(result.output).not.toContain("Skill Two");
  });

  it("loads an enabled skill", async () => {
    const { SkillsTool } = await import("../src/agent/libs/tools/skills-tool.ts");
    const tool = new SkillsTool();
    const result = await tool.execute({ operation: "get", skill_id: "skill-1" }, { cwd: "" } as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Skill One");
    expect(result.output).toContain("## Skill Content");
  });

  it("errors when skill exists but is disabled", async () => {
    const { SkillsTool } = await import("../src/agent/libs/tools/skills-tool.ts");
    const tool = new SkillsTool();
    const result = await tool.execute({ operation: "get", skill_id: "skill-2" }, { cwd: "" } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not enabled");
  });
});
