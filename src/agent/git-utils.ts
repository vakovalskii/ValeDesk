/**
 * Git utilities for tracking and rolling back file changes
 */

import { execSync } from "child_process";

/**
 * Check if current directory is a git repository
 */
export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get git diff statistics for a file
 * Returns { additions: number, deletions: number }
 *
 * Handles:
 * - Modified files: diff against HEAD
 * - Staged new files: diff against cached (git diff --cached)
 * - Unstaged new files: check git status and count lines
 */
export function getFileDiffStats(filePath: string, cwd: string): { additions: number; deletions: number } {
  try {
    // Try diff against HEAD first (for modified files)
    let output = execSync(`git diff --numstat HEAD -- "${filePath}"`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    // If no diff, check staged changes (for new files that were git add'd)
    if (!output) {
      output = execSync(`git diff --numstat --cached -- "${filePath}"`, {
        cwd,
        encoding: "utf-8",
      }).trim();
    }

    // If still no diff, check git status for new unstaged files
    if (!output) {
      try {
        const statusOutput = execSync(`git status --short -- "${filePath}"`, {
          cwd,
          encoding: "utf-8",
        }).trim();

        // git status --short format: "?? filename" for untracked new files
        if (statusOutput && statusOutput.startsWith('??')) {
          // New file, count lines
          const { readFile } = require('fs');
          const { resolve } = require('path');
          const fullFilePath = resolve(cwd, filePath);
          const content = readFile(fullFilePath, 'utf-8');
          const lineCount = content.split('\n').length;
          return { additions: lineCount, deletions: 0 };
        }
      } catch {
        // File not tracked by git at all
        return { additions: 0, deletions: 0 };
      }
    }

    if (!output) {
      return { additions: 0, deletions: 0 };
    }

    const [additions, deletions] = output.split(/\s+/).slice(0, 2);
    return {
      additions: parseInt(additions, 10) || 0,
      deletions: parseInt(deletions, 10) || 0,
    };
  } catch (error) {
    console.error(`Error getting diff stats for ${filePath}:`, error);
    return { additions: 0, deletions: 0 };
  }
}

/**
 * Get relative path from project root
 */
export function getRelativePath(filePath: string, cwd: string): string {
  try {
    const relativePath = execSync(`git ls-files --full-name "${filePath}"`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    return relativePath || filePath;
  } catch {
    // File might be untracked, return as is
    return filePath;
  }
}

/**
 * Get all changed files in working directory (excluding deleted)
 * Returns array of file paths
 */
export function getChangedFiles(cwd: string): string[] {
  try {
    const output = execSync("git diff --name-only HEAD", {
      cwd,
      encoding: "utf-8",
    }).trim();

    return output ? output.split("\n").filter(Boolean) : [];
  } catch (error) {
    console.error("Error getting changed files:", error);
    return [];
  }
}

/**
 * Checkout file from HEAD to revert changes
 */
export function checkoutFile(filePath: string, cwd: string): boolean {
  try {
    execSync(`git checkout HEAD -- "${filePath}"`, {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch (error) {
    console.error(`Error checking out ${filePath}:`, error);
    return false;
  }
}

/**
 * Checkout multiple files from HEAD to revert changes
 * Returns object with { succeeded: string[], failed: string[] }
 */
export function checkoutFiles(filePaths: string[], cwd: string): { succeeded: string[]; failed: string[] } {
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const filePath of filePaths) {
    if (checkoutFile(filePath, cwd)) {
      succeeded.push(filePath);
    } else {
      failed.push(filePath);
    }
  }

  return { succeeded, failed };
}

/**
 * Get diff statistics for all changed files
 * Returns array of { path, additions, deletions }
 */
export function getAllDiffStats(cwd: string): Array<{
  path: string;
  additions: number;
  deletions: number;
}> {
  const changedFiles = getChangedFiles(cwd);

  return changedFiles.map((filePath) => ({
    path: filePath,
    ...getFileDiffStats(filePath, cwd),
  }));
}

/**
 * Get file change information for a specific file
 * Returns { path, additions, deletions } or null if no changes
 */
export function getFileChanges(cwd: string, filePath: string): { path: string; additions: number; deletions: number } | null {
  const relativePath = getRelativePath(filePath, cwd);
  const stats = getFileDiffStats(filePath, cwd);

  if (stats.additions === 0 && stats.deletions === 0) {
    return null;
  }

  return {
    path: relativePath,
    additions: stats.additions,
    deletions: stats.deletions
  };
}
