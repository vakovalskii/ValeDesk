---
name: agent-git-workflow
description: Standardizes git workflow for the AI agent in the sandbox devcontainer: work in agent/<task>-<yyyymmdd>, integrate via agent, never push to main/master, open PRs via GitHub CLI. Use when the user asks to create branches, push changes, open PRs, or follow this sandbox repo setup.
capabilities: git,github
---

# Agent Git Workflow (Sandbox)

## Context

- Workspace lives in Docker volume at `/workspaces/work` (no host bind mounts).
- Container/volume names may vary per project (see `.devcontainer/docker-compose*.yml`).
- A local safety pre-push hook blocks pushes to `main`/`master` (anti-footgun, not a server guarantee). It is installed in the image and is locked down (system `core.hooksPath`).
- By default the sandbox has **sudo + Docker host access** (docker.sock). This is convenient but dangerous: Docker operations are potentially destructive.

## Quick start

1) Go to the target repo directory (usually under `/workspaces/work/<repo>`).
2) Create a task branch off `agent`:

```bash
agent-task-branch <task-slug>
```

3) Make changes, commit.
4) Optional: push current task branch for remote backup (recommended for long tasks / “in progress” safety):

```bash
git push -u origin HEAD
```

5) Merge your task branch back into `agent` and push `agent`:

```bash
agent-merge-to-agent
```

6) Open PR `agent` → `main` only when the user explicitly asks (see rules below):

```bash
agent-open-pr
```

## Rules

### Hard rules (do not violate)

- Never push directly to `main`/`master`. Changes land in `main` only via PR.
- Never **intentionally bypass** safety mechanisms (pre-push hook / blocks). Examples of forbidden bypasses:
  - `git push --no-verify ...`
  - `git -c core.hooksPath=/dev/null push ...`
  - changing `core.hooksPath`, deleting hooks, or rewriting the hook script.
- Never embed secrets/tokens in:
  - repo files (commits),
  - remote URLs,
  - logs/outputs.
- If a task *requires* bypassing protections, stop and ask the user for explicit confirmation and a concrete reason.
- If Docker access is enabled, never run destructive commands (`rm`, `prune`, `system prune`, volume/network removals) unless the user explicitly requests them.

### Conventions

- **Branch strategy (default)**:
  - `agent` is the long-lived integration branch for the agent.
  - task branches `agent/<task>-<yyyymmdd>` are created **from `agent`** and merged back into `agent` after testing.
  - dates are UTC (scripts use `date -u`).
- **Push strategy**:
  - pushing `agent/<task>-...` is optional and used for remote backup during work (in case the sandbox/volume breaks).
  - `agent-merge-to-agent` pushes `agent` (this is the normal “publish progress” step).
- PR flow: `agent` → `main` **only on explicit user instruction** (and `agent-open-pr` enforces: PR into `main/master` only from `agent`).
- Prefer PRs for all changes, even if branch protection is not enforced server-side.

## Pre-flight (common failure points)

- Ensure GitHub auth exists inside the container:
  - `gh auth status`
  - docs: `docs/auth-inside-container.md`
- Ensure bot identity is set (inside container):
  - `git config --global user.name ...`
  - `git config --global user.email ...`

## Available scripts / commands

- `agent-task-branch <task-slug>`: ensure local `agent` exists, then create/switch to `agent/<task>-<yyyymmdd>` from `agent`.
- `agent-merge-to-agent`: merge current task branch into `agent` and push `agent`.
- `agent-open-pr [base]`: open PR from current branch to base. PR `agent` → `main` is allowed **only on explicit user instruction** (policy rule).
- `agent-new-branch <task-slug>`: legacy helper (does not ensure base `agent`); prefer `agent-task-branch`.

## Operational workflow

1) Clone repos under `/workspaces/work/<repo>`.
2) Create a task branch from `agent`: `agent-task-branch <task>`.
3) Commit small, coherent chunks.
4) Optional remote backup push (during work): `git push -u origin HEAD`.
5) Merge into `agent` and push `agent`: `agent-merge-to-agent`.
6) Only if the user explicitly asked: open PR `agent` → `main`:
   - ensure you're on `agent`
   - run `agent-open-pr`

PR bodies should include:
   - what changed,
   - how to test.

