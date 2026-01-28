import { describe, expect, it, vi, beforeEach } from "vitest";

describe("duckduckgo search tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses lite results into output", async () => {
    const html = `<a class='result-link' href='https://example.com'>Example Site</a>`;

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => html
    })) as any;

    const { executeSearchTool } = await import("../src/agent/libs/tools/duckduckgo-search-tool.ts");
    const result = await executeSearchTool({ query: "example", max_results: 5 }, { cwd: "", isPathSafe: () => false } as any);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Example Site");
    expect(result.output).toContain("https://example.com");
  });
});
