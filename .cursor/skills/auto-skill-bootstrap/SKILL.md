---
name: auto-skill-bootstrap
description: Deterministic helper to inventory existing project skills, detect missing capability coverage, search skills.sh via Skills CLI, and (optionally) install missing skills under a trust policy. Uses skills-manifest.json + state.json to stay idempotent across changing requirements.
capabilities: skills-management
---

# Auto Skill Bootstrap (project-level)

## What this is

This skill defines a **repeatable** workflow for:

- indexing already-present project skills into `skills-manifest.json`
- mapping the user request to **capabilities**
- finding gaps (capabilities not covered by existing skills)
- searching Skills CLI (`npx skills find ...`) for candidate skills
- filtering candidates by **trust policy**
- producing a short, structured “install plan”
- optionally installing skills (only under strict conditions)

The heavy lifting is done by deterministic scripts shipped with this skill.

## Files (state + inventory)

- Inventory of skills (generated): `.cursor/skills/skills-manifest.json`
- Bootstrap state (generated): `.cursor/skills/auto-skill-bootstrap/state.json`

## Hard rules

- **Never** install skills from unknown sources automatically.
- If multiple plausible candidates exist for a capability, **ask the user** to choose (multi-select).
- After any install/remove/update of skills, regenerate `skills-manifest.json` (do not edit JSON by hand).

## Deterministic commands

### 1) Rebuild skills manifest

Run inside the repo root:

```bash
python3 .cursor/skills/auto-skill-bootstrap/bin/update-manifest.py
```

### 2) Search for missing capability skills (no install)

```bash
python3 .cursor/skills/auto-skill-bootstrap/bin/auto-skill-bootstrap.py \
  --cap docker github devcontainers \
  --no-install
```

Outputs:
- `.cursor/skills/auto-skill-bootstrap/candidates.json` (grouped by capability)
- updates `.cursor/skills/auto-skill-bootstrap/state.json`

### 3) Optional: install (trust-policy only)

Only when **explicitly allowed** by the user or project policy.

```bash
python3 .cursor/skills/auto-skill-bootstrap/bin/auto-skill-bootstrap.py \
  --cap docker github \
  --install-allowlisted \
  --max-per-cap 1
```

## Trust policy

Trust rules live here and are deterministic:

- `.cursor/skills/auto-skill-bootstrap/trust-policy.json`

Default stance: allowlist only.

## When to run

- At the start of a new task (before deep work).
- Again when the user introduces new constraints/tech (“also add CI”, “needs k8s”, etc.).

