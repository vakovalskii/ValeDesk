// ─── MiniApp v2: chain-of-prompts architecture ───

export type WorkflowStatus = "draft" | "testing" | "published" | "archived";

// ─── Input spec (what to ask user before launch) ───

export type InputSpec = {
  id: string;
  title: string;
  description: string;
  type: "string" | "text" | "number" | "boolean" | "enum" | "date" | "datetime" | "file_path" | "url" | "secret";
  required: boolean;
  default?: unknown;
  enum_values?: string[];
  redaction?: boolean;
};

// ─── Chain step (a single focused prompt for the orchestrator) ───

export type ChainStep = {
  id: string;
  title: string;
  prompt_template: string;              // may contain {{inputs.X}} and {{steps.prev_id.result}}
  tools: string[];                       // which tools are available for this step
  output_key: string;                    // name used to reference this step's result
  execution: "llm" | "script";          // how to execute: LLM agent or deterministic script
  script?: {
    language: "python" | "javascript";
    code: string;                        // inline script source
    file?: string;                       // saved script path (filled after distill)
  };
};

// ─── Validation config ───

export type ValidationConfig = {
  acceptance_criteria: string;           // human-readable criteria for the result
  prompt_template: string;               // prompt for the validation agent
  tools: string[];                       // tools available during validation
  max_fix_attempts: number;              // max retries (typically 3)
};

// ─── Artifact description ───

export type ArtifactSpec = {
  type: "file" | "text" | "link" | "table";
  title: string;
  description: string;
};

// ─── The MiniWorkflow itself ───

export type MiniWorkflow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  created_at: string;
  updated_at: string;
  source_session_id: string;
  source_session_cwd?: string;
  tags: string[];
  status: WorkflowStatus;
  compatibility: {
    valedesk_min_version: string;
    tools_required: string[];
    tools_optional: string[];
  };
  goal: string;
  definition_of_done: string;
  constraints: string[];
  inputs: InputSpec[];
  chain: ChainStep[];
  validation: ValidationConfig;
  artifacts: ArtifactSpec[];
  safety: {
    permission_mode_on_replay: "ask" | "auto";
    side_effects: Array<"local_fs" | "git" | "network" | "external_accounts">;
    network_policy: "offline" | "allow_web_read" | "allow_web_write";
  };
};

// ─── Distill result ───

export type DistillResult =
  | { status: "success"; workflow: MiniWorkflow }
  | { status: "needs_clarification"; questions: string[] }
  | { status: "not_suitable"; reason: string; suggest_prompt_preset: boolean };

// ─── Summary for list view ───

export type MiniWorkflowSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  status: WorkflowStatus;
  tags?: string[];
  inputs_count: number;
  updated_at: string;
};

// ─── Test result (for UI display during distill) ───

export type MiniWorkflowTestResult = {
  id: string;
  title: string;
  passed: boolean;
  message: string;
};

// ─── Permission detection (shared between agent and UI) ───

export type DetectedPermissions = {
  network: boolean;
  local_fs: boolean;
  git: boolean;
  external_accounts: boolean;
  reasons: { permission: string; reason: string }[];
};

const NETWORK_TOOLS = new Set(["search_web", "fetch_html", "fetch_json", "download_file", "browser_navigate", "browser_click", "browser_type", "browser_screenshot"]);
const FS_TOOLS = new Set(["write_file", "edit_file", "read_file", "search_files", "search_text", "read_document"]);
const GIT_TOOLS = new Set(["git_status", "git_log", "git_diff", "git_commit", "git_push", "git_pull", "git_checkout", "git_branch", "git_stash", "git_merge", "git_reset"]);
const NETWORK_CODE_PATTERNS = /\b(requests\.(get|post|put|delete|patch|head)|urllib\.request|http\.client|aiohttp|httpx|fetch\(|axios|curl_cffi|socket\.connect|websocket)\b/;

export function detectPermissions(chain: Array<{ tools?: string[]; execution?: string; script?: { code?: string } }>): DetectedPermissions {
  const result: DetectedPermissions = { network: false, local_fs: false, git: false, external_accounts: false, reasons: [] };

  for (const step of chain) {
    for (const tool of step.tools || []) {
      if (NETWORK_TOOLS.has(tool) && !result.network) {
        result.network = true;
        result.reasons.push({ permission: "network", reason: `tool: ${tool}` });
      }
      if (FS_TOOLS.has(tool) && !result.local_fs) {
        result.local_fs = true;
        result.reasons.push({ permission: "local_fs", reason: `tool: ${tool}` });
      }
      if (GIT_TOOLS.has(tool) && !result.git) {
        result.git = true;
        result.reasons.push({ permission: "git", reason: `tool: ${tool}` });
      }
      if (tool === "run_command" && !result.local_fs) {
        result.local_fs = true;
        result.reasons.push({ permission: "local_fs", reason: "tool: run_command" });
      }
    }

    if (step.execution === "script" && step.script?.code) {
      if (NETWORK_CODE_PATTERNS.test(step.script.code) && !result.network) {
        result.network = true;
        result.reasons.push({ permission: "network", reason: "script uses network library" });
      }
    }
  }

  return result;
}
