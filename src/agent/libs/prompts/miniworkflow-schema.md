# MiniWorkflow (Mini-app) — Schema Reference

You are editing a MiniWorkflow — a reusable chain-of-prompts automation distilled from a chat session.

## Top-level fields

| Field | Type | Editable | Description |
|-------|------|----------|-------------|
| `id` | string | no | Slug identifier (auto-generated from name) |
| `name` | string | yes | Human-readable name shown in UI |
| `description` | string | yes | Short summary (1-2 sentences) |
| `icon` | string | yes | Single emoji |
| `goal` | string | yes | What the workflow achieves overall |
| `definition_of_done` | string | yes | When the result is considered complete |
| `constraints` | string[] | yes | Rules the agent must follow |
| `inputs` | InputSpec[] | yes | User-provided parameters before launch |
| `chain` | ChainStep[] | yes | Ordered steps executed sequentially |
| `validation` | ValidationConfig | yes | How to verify the final result |
| `artifacts` | ArtifactSpec[] | yes | Expected output files/data |
| `safety` | object | yes | Permission mode, side effects, network policy |
| `source_model` | string | read-only | Model used for distillation (do not change) |
| `source_context` | string | read-only | Chat log from the original session (reference) |
| `source_result` | object | read-only | Session result identified during distillation |

## InputSpec

Each input is a parameter the user fills before running the workflow.

```
{ id, title, description, type, required, default?, enum_values?, redaction? }
```

- `type`: "string" | "text" | "number" | "boolean" | "enum" | "date" | "datetime" | "file_path" | "url" | "secret"
- `redaction: true` — value is masked (for tokens/keys)
- Templates reference inputs as `{{inputs.<id>}}`

## ChainStep

Each step is one focused task executed in order.

```
{ id, title, prompt_template, tools, output_key, execution, script? }
```

- `prompt_template` — prompt text sent to LLM. May contain:
  - `{{inputs.X}}` — user input value
  - `{{steps.<step_id>.result}}` — result from a previous step (use the step's `id`, not `output_key`)
- `tools` — list of tool names available for this step (e.g. `["search_web", "write_file"]`)
- `output_key` — name used by subsequent steps to reference this step's result
- `execution`: `"llm"` (agent runs prompt) or `"script"` (deterministic code)
- `script` (only if execution="script"):
  ```
  { language: "python" | "javascript", code: "..." }
  ```

### Step execution flow

1. Step 1 receives full context (goal, inputs, constraints) + its task
2. Steps 2+ receive only their task + results from previous steps
3. Last step may include validation instructions

## ValidationConfig

```
{ acceptance_criteria, prompt_template, tools, max_fix_attempts }
```

- `acceptance_criteria` — human-readable success definition
- `prompt_template` — prompt for validation agent (checks if result meets criteria)
- `max_fix_attempts` — retry limit if validation fails (default: 3)

## Safety

```
{
  permission_mode_on_replay: "ask" | "auto",
  side_effects: ["local_fs", "git", "network", "external_accounts"],
  network_policy: "offline" | "allow_web_read" | "allow_web_write"
}
```

## Common editing tasks

- **Add input**: append to `inputs[]`, then use `{{inputs.new_id}}` in step prompts
- **Add step**: append to `chain[]` with unique `id` and `output_key`
- **Convert LLM step to script**: set `execution: "script"`, add `script: { language, code }`
- **Reorder steps**: move items in `chain[]`, update `{{steps.X.result}}` references
- **Tighten constraints**: add entries to `constraints[]`
- **Change tools**: modify `tools[]` in the relevant step
