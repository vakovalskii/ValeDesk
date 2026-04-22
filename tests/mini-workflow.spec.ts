import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { MiniWorkflow, ChainStep } from "../src/shared/mini-workflow-types.ts";
import { detectPermissions } from "../src/shared/mini-workflow-types.ts";
import {
  MiniWorkflowStore,
  buildReplayPrompt,
  buildStepPrompt,
  checkDistillability,
  generateSkillMarkdown,
  getLlmSteps,
  redactSecrets,
  renderTemplate,
  saveNewVersion,
  validateWorkflow,
  writeReplayLog
} from "../src/agent/libs/mini-workflow.ts";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "valedesk-mini-workflow-"));
}

function baseWorkflow(id = "report-gen"): MiniWorkflow {
  const now = new Date().toISOString();
  return {
    id,
    name: "Report Gen",
    description: "Workflow",
    icon: "🧪",
    version: "0.1.0",
    created_at: now,
    updated_at: now,
    source_session_id: "sess-1",
    tags: [],
    status: "draft",
    compatibility: {
      valedesk_min_version: "0.0.8",
      tools_required: ["search_web"],
      tools_optional: []
    },
    goal: "Generate report",
    definition_of_done: "File exists",
    constraints: [],
    inputs: [],
    chain: [
      {
        id: "step_1",
        title: "Search the web",
        prompt_template: "Search for {{inputs.topic}} and summarize findings.",
        tools: ["search_web"],
        output_key: "research",
        execution: "llm"
      },
      {
        id: "step_2",
        title: "Write report",
        prompt_template: "Based on research:\n{{steps.step_1.result}}\n\nWrite a report.",
        tools: ["write_file"],
        output_key: "report",
        execution: "llm"
      }
    ],
    validation: {
      acceptance_criteria: "Report file exists and contains all sections",
      prompt_template: "Check the report and fix if needed.",
      tools: ["read_file", "write_file"],
      max_fix_attempts: 3
    },
    artifacts: [{ type: "file", title: "report.md", description: "Generated report" }],
    safety: {
      permission_mode_on_replay: "ask",
      side_effects: [],
      network_policy: "allow_web_read"
    }
  };
}

describe("MiniWorkflow v2 UT", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    for (const d of tempDirs) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("UT-01: checkDistillability identifies conversation-centric session", () => {
    const result = checkDistillability([
      { type: "user_prompt", prompt: "hello" },
      { type: "text", text: "world" }
    ] as any);
    expect(result).toEqual({
      suitable: false,
      reason: "no_tool_calls",
      suggest_prompt_preset: true
    });
  });

  it("UT-02: checkDistillability accepts session with tool calls", () => {
    const result = checkDistillability([
      { type: "user_prompt", prompt: "do something" },
      { type: "tool_use", id: "u1", name: "search_web", input: {} }
    ] as any);
    expect(result.suitable).toBe(true);
  });

  it("UT-03: validateWorkflow fails without goal", () => {
    const wf = baseWorkflow();
    const invalid = { ...wf } as any;
    delete invalid.goal;
    const result = validateWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: goal");
  });

  it("UT-04: validateWorkflow fails without chain", () => {
    const wf = baseWorkflow();
    const invalid = { ...wf } as any;
    delete invalid.chain;
    const result = validateWorkflow(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: chain");
  });

  it("UT-05: validateWorkflow passes for valid workflow", () => {
    const wf = baseWorkflow();
    const result = validateWorkflow(wf as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
  });

  it("UT-06: redactSecrets replaces secret fields", () => {
    const result = redactSecrets(
      { api_key: "sk-12345", query: "test" },
      new Set(["api_key"])
    );
    expect(result).toEqual({ api_key: "[REDACTED]", query: "test" });
  });

  it("UT-07: renderTemplate resolves inputs placeholders", () => {
    const result = renderTemplate(
      "Search for {{inputs.topic}} in {{inputs.year}}",
      { inputs: { topic: "AI", year: "2025" }, steps: {} }
    );
    expect(result).toBe("Search for AI in 2025");
  });

  it("UT-08: renderTemplate resolves step result placeholders", () => {
    const result = renderTemplate(
      "Based on:\n{{steps.search.result}}",
      { inputs: {}, steps: { search: { result: "found 5 items" } } }
    );
    expect(result).toBe("Based on:\nfound 5 items");
  });

  it("UT-09: saveNewVersion keeps only last 5 versions", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    let wf = baseWorkflow("report-gen");
    for (let i = 1; i <= 6; i++) {
      wf = { ...wf, version: `0.1.${i}` };
      await saveNewVersion(wf, { baseDir });
    }
    const versionsDir = join(baseDir, ".valera", "workflows", "report-gen", "versions");
    const entries = (await fs.readdir(versionsDir)).sort();
    expect(entries).toEqual(["v2", "v3", "v4", "v5", "v6"]);

    const store = new MiniWorkflowStore();
    const active = await store.load("report-gen", { baseDir });
    expect(active?.version).toBe("0.1.6");
  });

  it("UT-10: buildReplayPrompt generates correct prompt", () => {
    const wf = baseWorkflow();
    wf.inputs = [
      { id: "topic", title: "Topic", description: "Research topic", type: "string", required: true }
    ];
    const { prompt } = buildReplayPrompt(wf, { topic: "AI" });
    expect(prompt).toContain("Report Gen");
    expect(prompt).toContain("AI");
    expect(prompt).toContain("Критерии готовности");
    expect(prompt).toContain("Report file exists and contains all sections");
  });

  it("UT-11: buildReplayPrompt redacts secret inputs", () => {
    const wf = {
      ...baseWorkflow("secret-wf"),
      inputs: [
        { id: "topic", title: "Topic", description: "", type: "string" as const, required: true },
        { id: "api_key", title: "Api key", description: "", type: "secret" as const, required: true, redaction: true }
      ]
    };
    const { prompt, redactedInputs } = buildReplayPrompt(wf, { topic: "AI", api_key: "sk-real" });
    expect(prompt).toContain("{{secret::api_key}}");
    expect(redactedInputs).toEqual({ topic: "AI", api_key: "[REDACTED]" });
  });

  it("UT-12: store list merges project and global with project priority", async () => {
    const globalDir = await makeTempDir();
    const projectDir = await makeTempDir();
    tempDirs.push(globalDir, projectDir);
    const store = new MiniWorkflowStore();
    const g = { ...baseWorkflow("same-id"), name: "Global Wf", updated_at: "2026-01-01T00:00:00.000Z" };
    const p = { ...baseWorkflow("same-id"), name: "Project Wf", updated_at: "2026-01-02T00:00:00.000Z" };
    await store.save(g, { baseDir: globalDir });
    await store.save(p, { projectCwd: projectDir, scope: "project" });
    const list = await store.list({ baseDir: globalDir, projectCwd: projectDir, includeProject: true });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Project Wf");
  });

  it("UT-13: store.delete removes both global and project scopes", async () => {
    const globalDir = await makeTempDir();
    const projectDir = await makeTempDir();
    tempDirs.push(globalDir, projectDir);
    const store = new MiniWorkflowStore();
    await store.save(baseWorkflow("del-wf"), { baseDir: globalDir });
    await store.save(baseWorkflow("del-wf"), { projectCwd: projectDir, scope: "project" });
    await store.delete("del-wf", { baseDir: globalDir, projectCwd: projectDir, scope: "both" });
    const globalLoaded = await store.load("del-wf", { baseDir: globalDir });
    const projectLoaded = await store.load("del-wf", { baseDir: projectDir });
    expect(globalLoaded).toBeNull();
    expect(projectLoaded).toBeNull();
  });

  it("UT-14: generateSkillMarkdown includes chain steps", async () => {
    const wf = {
      ...baseWorkflow("md-wf"),
      constraints: ["no network"],
      inputs: [{ id: "topic", title: "Topic", description: "Theme", type: "string" as const, required: true }]
    };
    const md = await generateSkillMarkdown(wf);
    expect(md).toContain("## Входные данные");
    expect(md).toContain("## Цепочка шагов");
    expect(md).toContain("Search the web");
    expect(md).toContain("## Ограничения");
  });

  it("UT-15: writeReplayLog writes run file", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const wf = baseWorkflow("replay-wf");
    await writeReplayLog(
      wf,
      {
        inputs: { topic: "AI" },
        final_status: "success",
        step_results: [{ step_id: "s1", status: "success", duration_ms: 12 }]
      },
      { baseDir }
    );
    const runsDir = join(baseDir, ".valera", "workflows", "replay-wf", "runs");
    const entries = await fs.readdir(runsDir);
    expect(entries.length).toBe(1);
    const raw = await fs.readFile(join(runsDir, entries[0]), "utf8");
    expect(raw).toContain('"step_results"');
  });

  // ─── detectPermissions ───

  it("UT-16b: detectPermissions detects network tools", () => {
    const result = detectPermissions([{ tools: ["search_web", "read_file"] }]);
    expect(result.network).toBe(true);
    expect(result.local_fs).toBe(true);
    expect(result.git).toBe(false);
    expect(result.reasons.length).toBe(2);
  });

  it("UT-16c: detectPermissions detects git tools", () => {
    const result = detectPermissions([{ tools: ["git_status", "git_commit"] }]);
    expect(result.git).toBe(true);
    expect(result.network).toBe(false);
  });

  it("UT-16d: detectPermissions detects network in script code", () => {
    const result = detectPermissions([{
      tools: [],
      execution: "script",
      script: { code: "import requests\ndata = requests.get('http://example.com')" }
    }]);
    expect(result.network).toBe(true);
    expect(result.reasons.some(r => r.reason.includes("script"))).toBe(true);
  });

  it("UT-16e: detectPermissions returns empty for no tools", () => {
    const result = detectPermissions([{ tools: [] }]);
    expect(result.network).toBe(false);
    expect(result.local_fs).toBe(false);
    expect(result.git).toBe(false);
    expect(result.reasons.length).toBe(0);
  });

  it("UT-16f: detectPermissions detects run_command as local_fs", () => {
    const result = detectPermissions([{ tools: ["run_command"] }]);
    expect(result.local_fs).toBe(true);
  });

  // ─── getLlmSteps ───

  it("UT-17: getLlmSteps filters out script steps", () => {
    const wf = baseWorkflow();
    wf.chain.push({
      id: "step_script",
      title: "Script step",
      prompt_template: "",
      tools: [],
      output_key: "computed",
      execution: "script",
      script: { language: "python", code: "print('hello')" }
    });
    const llmSteps = getLlmSteps(wf);
    expect(llmSteps).toHaveLength(2); // step_1 and step_2 only
    expect(llmSteps.every(s => s.execution === "llm")).toBe(true);
  });

  it("UT-18: getLlmSteps returns all steps when none are scripts", () => {
    const wf = baseWorkflow();
    expect(getLlmSteps(wf)).toHaveLength(2);
  });

  // ─── buildStepPrompt ───

  it("UT-19: buildStepPrompt includes step title and index", () => {
    const wf = baseWorkflow();
    wf.inputs = [{ id: "topic", title: "Topic", description: "", type: "string", required: true }];
    const prompt = buildStepPrompt(wf, wf.chain[0], 0, 2, { topic: "AI" }, {});
    expect(prompt).toContain("Шаг 1/2");
    expect(prompt).toContain("Search the web");
    expect(prompt).toContain("AI");
    expect(prompt).not.toContain("Критерии готовности"); // not last step
  });

  it("UT-20: buildStepPrompt includes validation on last step", () => {
    const wf = baseWorkflow();
    const prompt = buildStepPrompt(wf, wf.chain[1], 1, 2, {}, { step_1: "research data" });
    expect(prompt).toContain("Шаг 2/2");
    expect(prompt).toContain("Критерии готовности");
    expect(prompt).toContain("research data"); // previous step result
  });

  it("UT-21: buildStepPrompt redacts secret inputs", () => {
    const wf = baseWorkflow();
    wf.inputs = [
      { id: "topic", title: "Topic", description: "", type: "string", required: true },
      { id: "token", title: "Token", description: "", type: "secret", required: true, redaction: true }
    ];
    const prompt = buildStepPrompt(wf, wf.chain[0], 0, 2, { topic: "AI", token: "sk-secret" }, {});
    expect(prompt).toContain("AI");
    expect(prompt).toContain("{{secret::token}}");
    expect(prompt).not.toContain("sk-secret");
  });

  it("UT-22: buildStepPrompt subsequent step is compact (no full context)", () => {
    const wf = baseWorkflow();
    wf.inputs = [{ id: "topic", title: "Topic", description: "", type: "string", required: true }];
    wf.constraints = ["no network"];
    const prompt = buildStepPrompt(wf, wf.chain[1], 1, 2, { topic: "AI" }, { step_1: "Found 5 results about AI" });
    expect(prompt).toContain("Результаты предыдущих шагов");
    expect(prompt).toContain("Found 5 results about AI");
    // Subsequent steps should NOT repeat full inputs/constraints
    expect(prompt).not.toContain("Входные данные:");
    expect(prompt).not.toContain("no network");
  });

  // ─── Enhanced validateWorkflow ───

  it("UT-23: validateWorkflow catches duplicate input ids", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    (wf as any).inputs = [
      { id: "dup", title: "A", type: "string", required: true },
      { id: "dup", title: "B", type: "string", required: true }
    ];
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("duplicate id"))).toBe(true);
  });

  it("UT-24: validateWorkflow catches invalid input type", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    (wf as any).inputs = [{ id: "x", title: "X", type: "invalid_type", required: true }];
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("type must be one of"))).toBe(true);
  });

  it("UT-25: validateWorkflow catches enum without values", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    (wf as any).inputs = [{ id: "x", title: "X", type: "enum", required: true }];
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("enum_values"))).toBe(true);
  });

  it("UT-26: validateWorkflow catches missing execution type", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    ((wf as any).chain[0] as any).execution = undefined;
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("execution must be one of"))).toBe(true);
  });

  it("UT-27: validateWorkflow catches script step without code", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    (wf as any).chain = [{
      id: "s1", title: "Script", prompt_template: "", tools: [],
      output_key: "out", execution: "script", script: { language: "python", code: "" }
    }];
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("script.code"))).toBe(true);
  });

  it("UT-28: validateWorkflow catches invalid safety config", () => {
    const wf = baseWorkflow() as unknown as Record<string, unknown>;
    (wf as any).safety = { permission_mode_on_replay: "invalid", network_policy: "invalid", side_effects: [] };
    const result = validateWorkflow(wf);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("permission_mode_on_replay"))).toBe(true);
    expect(result.errors.some(e => e.includes("network_policy"))).toBe(true);
  });

  it("UT-16: writeReplayLog redacts secrets", async () => {
    const baseDir = await makeTempDir();
    tempDirs.push(baseDir);
    const wf = baseWorkflow("secret-wf");
    (wf as any).inputs = [
      { id: "topic", title: "Topic", description: "", type: "string", required: true },
      { id: "api_key", title: "Api key", description: "", type: "secret", required: true, redaction: true }
    ];
    await writeReplayLog(
      wf,
      { inputs: { topic: "AI", api_key: "sk-real-key-12345" }, final_status: "success" },
      { baseDir }
    );
    const runsDir = join(baseDir, ".valera", "workflows", "secret-wf", "runs");
    const entries = await fs.readdir(runsDir);
    const raw = await fs.readFile(join(runsDir, entries[0]), "utf8");
    expect(raw).not.toContain("sk-real-key-12345");
    expect(raw).toContain("[REDACTED]");
  });
});
