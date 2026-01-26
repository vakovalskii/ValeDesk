/**
 * Git Tools - Read and manipulate git repositories
 *
 * Tools:
 * - git_status: Get repository status (staged/unstaged/untracked files)
 * - git_log: Get commit history
 * - git_diff: Show changes between commits or working tree
 * - git_branch: List branches
 * - git_checkout: Switch branches or restore files
 * - git_add: Stage files for commit
 * - git_commit: Commit staged changes
 */

import { spawnSync } from "child_process";
import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";

// ============================================================================
// Tool Definitions
// ============================================================================

export const GitStatusToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_status",
    description: `Get the current status of a LOCAL git repository.

**IMPORTANT:** This tool works on local repositories only (already cloned on your filesystem).
For remote GitHub URLs, use browser/web tools or GitHub API tools instead.

**Output includes:**
- Current branch name
- Staged files (ready to commit)
- Unstaged files (modified but not staged)
- Untracked files (new files)

**Use cases:**
- Check what files have been changed in the local repository
- Verify all changes are accounted for before committing
- See if working directory is clean`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const GitLogToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_log",
    description: `Get the commit history of a LOCAL git repository.

**IMPORTANT:** This tool works on local repositories only.
For remote GitHub URLs, use GitHub API tools (e.g., mcp_github_list_commits).

**Output includes:**
- Commit hash (full)
- Author name and email
- Timestamp
- Commit message

**Options:**
- limit: Number of commits to show (default: 10, max: 100)

**Use cases:**
- Review recent changes in the local repository
- Find when a bug was introduced
- See who made specific changes`,
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum number of commits to return (default: 10, max: 100)",
        },
      },
      required: [],
    },
  },
};

export const GitDiffToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_diff",
    description: `Show uncommitted changes in the LOCAL working directory.

**IMPORTANT:** This tool works on local repositories only.

**What it shows:**
- Files that have been modified
- Line-by-line additions and deletions
- Which changes are staged vs unstaged

**Options:**
- file: Specific file to diff (optional)

**Use cases:**
- Review changes before committing
- See exactly what was modified
- Verify no unintended changes`,
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Specific file to show diff for (optional)",
        },
      },
      required: [],
    },
  },
};

export const GitBranchToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_branch",
    description: `List all branches or show the current branch in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.
For remote GitHub URLs, use GitHub API tools (e.g., mcp_github_list_branches).

**Options:**
- list_all: If true, list all branches (local and remote). If false, show only current branch (default: false)

**Use cases:**
- See what branches exist locally
- Know which branch you're currently on
- Plan branch switching strategy`,
    parameters: {
      type: "object",
      properties: {
        list_all: {
          type: "boolean",
          description: "List all branches (default: false, only shows current)",
        },
      },
      required: [],
    },
  },
};

export const GitCheckoutToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_checkout",
    description: `Switch branches or restore files to a previous state in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.

**Operations:**
1. Switch branches: Provide 'branch' parameter
2. Restore files: Provide 'file' parameter (reverts to HEAD)

**Use cases:**
- Switch to a different feature branch
- Abandon changes to a specific file
- Revert accidentally modified files

**Warning:** Uncommitted changes may be lost when switching branches.`,
    parameters: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch name to switch to",
        },
        file: {
          type: "string",
          description: "File to restore to HEAD (reverts changes)",
        },
      },
      required: [],
    },
  },
};

export const GitAddToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_add",
    description: `Stage files for commit in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.

**Options:**
- all: Stage all changed files (default: true)
- file: Specific file to stage (optional, overrides 'all')

**Use cases:**
- Prepare files for commit
- Stage specific files while leaving others unstaged

**Note:** This only stages files, does not create a commit.`,
    parameters: {
      type: "object",
      properties: {
        all: {
          type: "boolean",
          description: "Stage all changed files (default: true)",
        },
        file: {
          type: "string",
          description: "Specific file to stage (optional)",
        },
      },
      required: [],
    },
  },
};

export const GitCommitToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_commit",
    description: `Create a commit with staged changes in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.

**Required:**
- message: Commit message describing the changes

**Use cases:**
- Save work with a descriptive message
- Create checkpoints in development history

**Note:** Only staged changes will be committed. Use git_add first if needed.`,
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Commit message (required)",
        },
      },
      required: ["message"],
    },
  },
};

export const GitPushToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_push",
    description: `Push commits from LOCAL repository to a remote repository.

**IMPORTANT:** This tool works on local repositories only.

**Options:**
- remote: Remote name (default: origin)
- branch: Branch to push (default: current branch)
- force: Force push (default: false, use with caution)

**Use cases:**
- Share commits with team
- Backup work to remote repository
- Deploy changes

**Warning:** Force push can overwrite remote history. Use with extreme caution.`,
    parameters: {
      type: "object",
      properties: {
        remote: {
          type: "string",
          description: "Remote name (default: origin)",
        },
        branch: {
          type: "string",
          description: "Branch to push (default: current branch)",
        },
        force: {
          type: "boolean",
          description: "Force push (default: false)",
        },
      },
      required: [],
    },
  },
};

export const GitPullToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_pull",
    description: `Pull changes from a remote repository to LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.

**Options:**
- remote: Remote name (default: origin)
- branch: Branch to pull (default: current branch)
- rebase: Use rebase instead of merge (default: false)

**Use cases:**
- Sync with team changes
- Get latest updates from remote
- Update local branch before pushing

**Note:** May require resolving conflicts if there are divergent changes.`,
    parameters: {
      type: "object",
      properties: {
        remote: {
          type: "string",
          description: "Remote name (default: origin)",
        },
        branch: {
          type: "string",
          description: "Branch to pull (default: current branch)",
        },
        rebase: {
          type: "boolean",
          description: "Use rebase instead of merge (default: false)",
        },
      },
      required: [],
    },
  },
};

export const GitResetToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_reset",
    description: `Reset current HEAD to a specified state in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.

**Modes:**
- soft: Keep changes staged (default)
- mixed: Keep changes unstaged
- hard: Discard all changes (DANGEROUS)

**Options:**
- mode: Reset mode (soft/mixed/hard)
- target: Target to reset to (default: HEAD~1 for one commit back)
- file: Specific file to unstage (only works with mixed mode)

**Use cases:**
- Undo last commit but keep changes
- Unstage files
- Completely discard changes (careful!)

**Warning:** Hard reset permanently deletes uncommitted changes.`,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Reset mode: soft, mixed, or hard (default: soft)",
          enum: ["soft", "mixed", "hard"],
        },
        target: {
          type: "string",
          description: "Target to reset to (default: HEAD~1)",
        },
        file: {
          type: "string",
          description: "Specific file to unstage (mixed mode only)",
        },
      },
      required: [],
    },
  },
};

export const GitShowToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "git_show",
    description: `Show detailed information about a specific commit in a LOCAL repository.

**IMPORTANT:** This tool works on local repositories only.
For remote GitHub URLs, use GitHub API tools (e.g., mcp_github_get_commit).

**Output includes:**
- Commit hash, author, date
- Full commit message
- Files changed with diff

**Options:**
- commit: Commit hash or reference (default: HEAD)
- stat_only: Show only stats without full diff (default: false)

**Use cases:**
- Review what was changed in a commit
- Understand the context of changes
- Verify commit contents before pushing`,
    parameters: {
      type: "object",
      properties: {
        commit: {
          type: "string",
          description: "Commit hash or reference (default: HEAD)",
        },
        stat_only: {
          type: "boolean",
          description:
            "Show only file stats without full diff (default: false)",
        },
      },
      required: [],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Run a git command and return the output
 */
function runGit(
  args: string[],
  cwd: string,
): { output: string; error: string; exitCode: number } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  return {
    output: (result.stdout || "").trim(),
    error: (result.stderr || "").trim(),
    exitCode: typeof result.status === "number" ? result.status : 1,
  };
}

/**
 * Escape special characters for JSON
 */
function escapeForJson(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Format git status output as structured JSON
 */
function formatGitStatus(cwd: string): string {
  const result = runGit(["status", "--porcelain", "-b"], cwd);

  if (result.exitCode !== 0) {
    return JSON.stringify({ error: escapeForJson(result.error) });
  }

  const lines = result.output.split("\n").filter(Boolean);
  let branch = "";
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Parse branch info
      const branchPart = line.substring(3);
      const dotsIndex = branchPart.indexOf("...");
      branch =
        dotsIndex > -1
          ? branchPart.substring(0, dotsIndex)
          : branchPart.split(" ")[0];
    } else if (line.length >= 3) {
      const indexStatus = line[0];
      const worktreeStatus = line[1];
      const file = line.substring(3);

      if (indexStatus === "?") {
        untracked.push(file);
      } else {
        if (indexStatus !== " ") staged.push(file);
        if (worktreeStatus !== " " && worktreeStatus !== "?")
          unstaged.push(file);
      }
    }
  }

  return JSON.stringify({
    branch,
    staged,
    unstaged,
    untracked,
    clean:
      staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
  });
}

/**
 * Format git log output as structured JSON
 */
function formatGitLog(cwd: string, limit: number = 10): string {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const result = runGit(
    ["log", `--format=%H|%an|%ae|%at|%s`, "-n", String(safeLimit)],
    cwd,
  );

  if (result.exitCode !== 0) {
    return JSON.stringify({ error: escapeForJson(result.error) });
  }

  const lines = result.output.split("\n").filter(Boolean);
  const commits = lines.map((line) => {
    const parts = line.split("|", 5);
    return {
      hash: parts[0],
      author: parts[1],
      email: parts[2],
      timestamp: parseInt(parts[3]) || 0,
      message: parts[4] || "",
    };
  });

  return JSON.stringify({ commits, count: commits.length });
}

/**
 * Format git diff output with stats
 */
function formatGitDiff(cwd: string, file?: string): string {
  // Get the diff
  const diffArgs = ["diff", "--stat"];
  if (file) diffArgs.push("--", file);
  const statsResult = runGit(diffArgs, cwd);

  // Get staged diff stats
  const stagedArgs = ["diff", "--cached", "--stat"];
  if (file) stagedArgs.push("--", file);
  const stagedResult = runGit(stagedArgs, cwd);

  // Get detailed diff (limit to first 100 lines for safety)
  const detailedArgs = ["diff", "--no-color"];
  if (file) detailedArgs.push("--", file);
  const diffResult = runGit(detailedArgs, cwd);

  return JSON.stringify({
    working_tree: statsResult.output,
    staged: stagedResult.output,
    diff: diffResult.output.substring(0, 10000), // Limit output size
    has_changes:
      statsResult.output.length > 0 || stagedResult.output.length > 0,
  });
}

/**
 * Format git branch output
 */
function formatGitBranch(cwd: string, listAll: boolean = false): string {
  // Get current branch
  const currentResult = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (currentResult.exitCode !== 0) {
    return JSON.stringify({ error: escapeForJson(currentResult.error) });
  }
  const currentBranch = currentResult.output;

  if (!listAll) {
    return JSON.stringify({ current: currentBranch });
  }

  // List all branches
  const branchResult = runGit(
    ["branch", "-a", "--format=%(refname:short)"],
    cwd,
  );
  if (branchResult.exitCode !== 0) {
    return JSON.stringify({ error: escapeForJson(branchResult.error) });
  }

  const branches = branchResult.output
    .split("\n")
    .filter(Boolean)
    .map((b) => b.trim());

  return JSON.stringify({
    current: currentBranch,
    branches,
    count: branches.length,
  });
}

// ============================================================================
// Tool Execution Functions
// ============================================================================

/**
 * Execute git_status tool
 */
export async function executeGitStatusTool(
  _args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const result = formatGitStatus(context.cwd);
    const parsed = JSON.parse(result);

    if (parsed.error) {
      return { success: false, error: `Git error: ${parsed.error}` };
    }

    // Format for output
    let output = `Branch: ${parsed.branch}\n`;

    if (parsed.clean) {
      output += "Working tree clean";
    } else {
      if (parsed.staged.length > 0) {
        output += `\nStaged (${parsed.staged.length}):\n`;
        parsed.staged.forEach((f: string) => (output += `  ${f}\n`));
      }
      if (parsed.unstaged.length > 0) {
        output += `\nModified (${parsed.unstaged.length}):\n`;
        parsed.unstaged.forEach((f: string) => (output += `  ${f}\n`));
      }
      if (parsed.untracked.length > 0) {
        output += `\nUntracked (${parsed.untracked.length}):\n`;
        parsed.untracked.forEach((f: string) => (output += `  ${f}\n`));
      }
    }

    return { success: true, output };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get git status: ${error.message}`,
    };
  }
}

/**
 * Execute git_log tool
 */
export async function executeGitLogTool(
  args: { limit?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const result = formatGitLog(context.cwd, args.limit || 10);
    const parsed = JSON.parse(result);

    if (parsed.error) {
      return { success: false, error: `Git error: ${parsed.error}` };
    }

    let output = `Commit History (${parsed.count}):\n`;

    parsed.commits.forEach((c: any) => {
      const date = new Date(c.timestamp * 1000).toLocaleDateString();
      output += `${c.hash.substring(0, 7)} ${c.author} ${date}\n${c.message}\n\n`;
    });

    return { success: true, output };
  } catch (error: any) {
    return { success: false, error: `Failed to get git log: ${error.message}` };
  }
}

/**
 * Execute git_diff tool
 */
export async function executeGitDiffTool(
  args: { file?: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const result = formatGitDiff(context.cwd, args.file);
    const parsed = JSON.parse(result);

    if (parsed.error) {
      return { success: false, error: `Git error: ${parsed.error}` };
    }

    if (!parsed.has_changes) {
      return { success: true, output: "No changes" };
    }

    let output = "";

    if (parsed.staged) {
      output += `Staged:\n${parsed.staged}\n`;
    }
    if (parsed.working_tree) {
      output += `Working Tree:\n${parsed.working_tree}\n`;
    }

    if (parsed.diff) {
      output += "\n" + parsed.diff;
    }

    return { success: true, output };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get git diff: ${error.message}`,
    };
  }
}

/**
 * Execute git_branch tool
 */
export async function executeGitBranchTool(
  args: { list_all?: boolean },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const result = formatGitBranch(context.cwd, args.list_all || false);
    const parsed = JSON.parse(result);

    if (parsed.error) {
      return { success: false, error: `Git error: ${parsed.error}` };
    }

    let output = `Current: ${parsed.current}`;

    if (parsed.branches) {
      output += `\n\nAll Branches (${parsed.count}):\n`;
      parsed.branches.forEach((b: string) => {
        const prefix = b === parsed.current ? "*" : "  ";
        output += `${prefix}${b}\n`;
      });
    }

    return { success: true, output };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get git branch: ${error.message}`,
    };
  }
}

/**
 * Execute git_checkout tool
 */
export async function executeGitCheckoutTool(
  args: { branch?: string; file?: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  if (!args.branch && !args.file) {
    return {
      success: false,
      error: "Either 'branch' or 'file' parameter required",
    };
  }

  try {
    let result;
    if (args.branch) {
      // Switch branch
      result = runGit(["checkout", args.branch], context.cwd);
      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to switch branch: ${result.error}`,
        };
      }
      return {
        success: true,
        output: `Switched to branch '${args.branch}'`,
      };
    } else {
      // Restore file
      result = runGit(
        ["checkout", "HEAD", "--", args.file as string],
        context.cwd,
      );
      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to restore file: ${result.error}`,
        };
      }
      return { success: true, output: `Restored '${args.file}' to HEAD` };
    }
  } catch (error: any) {
    return { success: false, error: `Git checkout failed: ${error.message}` };
  }
}

/**
 * Execute git_add tool
 */
export async function executeGitAddTool(
  args: { all?: boolean; file?: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    let result;
    if (args.file) {
      // Stage specific file
      result = runGit(["add", args.file], context.cwd);
    } else {
      // Stage all (default behavior)
      result = runGit(["add", "-A"], context.cwd);
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to stage changes: ${result.error}`,
      };
    }

    const target = args.file ? args.file : "all changes";
    return { success: true, output: `Staged ${target}` };
  } catch (error: any) {
    return { success: false, error: `Git add failed: ${error.message}` };
  }
}

/**
 * Execute git_commit tool
 */
export async function executeGitCommitTool(
  args: { message: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  if (!args.message) {
    return { success: false, error: "Commit message is required" };
  }

  try {
    const result = runGit(["commit", "-m", args.message], context.cwd);

    if (result.exitCode !== 0) {
      // Check if nothing to commit
      if (result.error.includes("nothing to commit")) {
        return {
          success: false,
          error: "Nothing to commit. Stage changes first with git_add.",
        };
      }
      return { success: false, error: `Failed to commit: ${result.error}` };
    }

    return { success: true, output: `Committed: ${args.message}` };
  } catch (error: any) {
    return { success: false, error: `Git commit failed: ${error.message}` };
  }
}

/**
 * Execute git_push tool
 */
export async function executeGitPushTool(
  args: { remote?: string; branch?: string; force?: boolean },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const remote = args.remote || "origin";
    let branch = args.branch;

    // If no branch specified, get current branch
    if (!branch) {
      const branchResult = runGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        context.cwd,
      );
      if (branchResult.exitCode !== 0) {
        return { success: false, error: "Failed to get current branch" };
      }
      branch = branchResult.output;
    }

    const pushArgs = ["push", remote, branch];
    if (args.force) {
      pushArgs.push("--force");
    }

    const result = runGit(pushArgs, context.cwd);

    if (result.exitCode !== 0) {
      return { success: false, error: `Failed to push: ${result.error}` };
    }

    const forceMsg = args.force ? " (force)" : "";
    return {
      success: true,
      output: `Pushed to ${remote}/${branch}${forceMsg}`,
    };
  } catch (error: any) {
    return { success: false, error: `Git push failed: ${error.message}` };
  }
}

/**
 * Execute git_pull tool
 */
export async function executeGitPullTool(
  args: { remote?: string; branch?: string; rebase?: boolean },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const remote = args.remote || "origin";
    let branch = args.branch;

    // If no branch specified, get current branch
    if (!branch) {
      const branchResult = runGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        context.cwd,
      );
      if (branchResult.exitCode !== 0) {
        return { success: false, error: "Failed to get current branch" };
      }
      branch = branchResult.output;
    }

    const pullArgs = ["pull", remote, branch];
    if (args.rebase) {
      pullArgs.push("--rebase");
    }

    const result = runGit(pullArgs, context.cwd);

    if (result.exitCode !== 0) {
      return { success: false, error: `Failed to pull: ${result.error}` };
    }

    const rebaseMsg = args.rebase ? " (rebase)" : "";
    return {
      success: true,
      output: `Pulled from ${remote}/${branch}${rebaseMsg}\n${result.output}`,
    };
  } catch (error: any) {
    return { success: false, error: `Git pull failed: ${error.message}` };
  }
}

/**
 * Execute git_reset tool
 */
export async function executeGitResetTool(
  args: { mode?: string; target?: string; file?: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const mode = args.mode || "soft";
    const target = args.target || "HEAD~1";

    // Validate mode
    if (!["soft", "mixed", "hard"].includes(mode)) {
      return {
        success: false,
        error: "Mode must be 'soft', 'mixed', or 'hard'",
      };
    }

    // Special case: unstage specific file (mixed mode only)
    if (args.file) {
      const result = runGit(["reset", "HEAD", "--", args.file], context.cwd);
      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to unstage file: ${result.error}`,
        };
      }
      return { success: true, output: `Unstaged '${args.file}'` };
    }

    // Warn about hard reset
    if (mode === "hard") {
      const result = runGit(["reset", "--hard", target], context.cwd);
      if (result.exitCode !== 0) {
        return { success: false, error: `Failed to reset: ${result.error}` };
      }
      return {
        success: true,
        output: `Hard reset to ${target}\n${result.output}`,
      };
    }

    // Soft or mixed reset
    const resetArgs = ["reset", `--${mode}`, target];
    const result = runGit(resetArgs, context.cwd);

    if (result.exitCode !== 0) {
      return { success: false, error: `Failed to reset: ${result.error}` };
    }

    return {
      success: true,
      output: `Reset (${mode}) to ${target}\n${result.output}`,
    };
  } catch (error: any) {
    return { success: false, error: `Git reset failed: ${error.message}` };
  }
}

/**
 * Execute git_show tool
 */
export async function executeGitShowTool(
  args: { commit?: string; stat_only?: boolean },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!context.cwd) {
    return {
      success: false,
      error:
        "No working directory set. Start a session with a workspace folder.",
    };
  }

  try {
    const commit = args.commit || "HEAD";
    const showArgs = ["show", commit];

    if (args.stat_only) {
      showArgs.push("--stat");
    } else {
      showArgs.push("--stat", "--no-color");
    }

    const result = runGit(showArgs, context.cwd);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to show commit: ${result.error}`,
      };
    }

    // Limit output to prevent overwhelming the context
    const output = result.output.substring(0, 15000);
    const truncated =
      result.output.length > 15000 ? "\n\n... (output truncated)" : "";

    return {
      success: true,
      output: `Commit: ${commit}\n\n${output}${truncated}`,
    };
  } catch (error: any) {
    return { success: false, error: `Git show failed: ${error.message}` };
  }
}

// ============================================================================
// Export all tool definitions
// ============================================================================

export const ALL_GIT_TOOL_DEFINITIONS = [
  GitStatusToolDefinition,
  GitLogToolDefinition,
  GitDiffToolDefinition,
  GitBranchToolDefinition,
  GitCheckoutToolDefinition,
  GitAddToolDefinition,
  GitCommitToolDefinition,
  GitPushToolDefinition,
  GitPullToolDefinition,
  GitResetToolDefinition,
  GitShowToolDefinition,
];
