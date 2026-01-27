import { describe, expect, it, vi, beforeEach } from "vitest";

const updateSkillsList = vi.fn();

vi.mock("../src/agent/libs/skills-store.js", () => ({
  loadSkillsSettings: () => ({
    marketplaceUrl: "https://api.github.com/repos/example/contents/skills",
    skills: []
  }),
  updateSkillsList
}));

describe("skills loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches marketplace skills and updates store", async () => {
    const skillsListing = [
      { name: "skill-a", path: "skills/creative/skill-a", type: "dir", url: "url-a" },
      { name: "skill-b", path: "skills/dev/skill-b", type: "dir", url: "url-b" }
    ];

    const skillMd = `---
name: Skill A
description: Test skill
---
`;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => skillsListing
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => skillMd
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => skillMd
      });

    global.fetch = fetchMock as any;

    const { fetchSkillsFromMarketplace } = await import("../src/agent/libs/skills-loader.ts");
    const skills = await fetchSkillsFromMarketplace();

    expect(skills.length).toBe(2);
    expect(skills[0].name).toBe("Skill A");
    expect(updateSkillsList).toHaveBeenCalledTimes(1);
    const updated = updateSkillsList.mock.calls[0][0];
    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({ id: "Skill A", enabled: false });
  });
});
