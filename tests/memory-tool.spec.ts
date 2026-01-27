import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempHome = "";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => tempHome
  };
});

describe("memory tool", () => {
  beforeAll(async () => {
    tempHome = await mkdtemp(join(tmpdir(), "valera-test-"));
  });

  afterAll(async () => {
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("creates, appends, reads, and deletes memory", async () => {
    const { executeMemoryTool } = await import("../src/agent/libs/tools/memory-tool.ts");
    const ctx = { cwd: "" };

    const create = await executeMemoryTool({
      explanation: "test",
      operation: "create",
      content: "City: Orenburg"
    }, ctx);
    expect(create.success).toBe(true);

    const append = await executeMemoryTool({
      explanation: "test",
      operation: "append",
      content: "Language: Russian"
    }, ctx);
    expect(append.success).toBe(true);

    const read = await executeMemoryTool({
      explanation: "test",
      operation: "read"
    }, ctx);
    expect(read.success).toBe(true);
    expect(read.output).toContain("City: Orenburg");
    expect(read.output).toContain("Language: Russian");

    const del = await executeMemoryTool({
      explanation: "test",
      operation: "delete",
      section: "Language"
    }, ctx);
    expect(del.success).toBe(true);

    const memoryPath = join(tempHome, ".valera", "memory.md");
    const content = await readFile(memoryPath, "utf-8");
    expect(content).toContain("City: Orenburg");
    expect(content).not.toContain("Language: Russian");
  });
});
