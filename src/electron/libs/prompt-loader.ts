/**
 * Prompt loader - loads and formats prompts from template files
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateSkillsPromptSection } from './tools/skills-tool.js';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect OS at module load time
const platform = process.platform;
const isWindows = platform === 'win32';
const isMacOS = platform === 'darwin';
const isLinux = platform === 'linux';

const getOSName = () => {
  if (isWindows) return 'Windows';
  if (isMacOS) return 'macOS';
  if (isLinux) return 'Linux';
  return 'Unix';
};

const getShellCommands = () => {
  if (isWindows) {
    // PowerShell commands (NOT cmd.exe)
    return {
      listFiles: 'Get-ChildItem',              // or: ls, dir (aliases)
      viewFile: 'Get-Content',                 // or: cat, type (aliases)
      changeDir: 'Set-Location',               // or: cd (alias)
      currentDir: 'Get-Location',              // or: pwd (alias)
      findFiles: 'Get-ChildItem -Recurse -Name', // find files recursively
      searchText: 'Select-String -Pattern'     // grep equivalent
    };
  }
  // Unix-like (macOS, Linux)
  return {
    listFiles: 'ls',
    viewFile: 'cat',
    changeDir: 'cd',
    currentDir: 'pwd',
    findFiles: 'find . -name',
    searchText: 'grep -r'
  };
};

/**
 * Load system prompt from template file and replace placeholders
 * @param cwd - Current working directory
 * @param toolsSummary - Dynamic summary of available tools (generated from active tool definitions)
 */
export function getSystemPrompt(cwd: string, toolsSummary: string = ''): string {
  const promptPath = join(__dirname, 'prompts', 'system.txt');
  let template = readFileSync(promptPath, 'utf-8');

  const osName = getOSName();
  const cmds = getShellCommands();
  
  // Build skills section (dynamically generated based on enabled skills)
  const skillsSection = generateSkillsPromptSection();

  // Replace placeholders
  template = template
    .replace(/{osName}/g, osName)
    .replace(/{platform}/g, platform)
    .replace(/{shell}/g, isWindows ? 'PowerShell' : 'bash')
    .replace(/{cwd}/g, cwd)
    .replace(/{listFilesCmd}/g, cmds.listFiles)
    .replace(/{viewFileCmd}/g, cmds.viewFile)
    .replace(/{changeDirCmd}/g, cmds.changeDir)
    .replace(/{currentDirCmd}/g, cmds.currentDir)
    .replace(/{findFilesCmd}/g, cmds.findFiles)
    .replace(/{searchTextCmd}/g, cmds.searchText)
    .replace(/{skills_section}/g, skillsSection)
    .replace(/{tools_summary}/g, toolsSummary);

  return template;
}

/**
 * Load initial prompt template and replace placeholders
 */
export function getInitialPrompt(task: string, memoryContent?: string): string {
  const promptPath = join(__dirname, 'prompts', 'initial_prompt.txt');
  let template = readFileSync(promptPath, 'utf-8');

  const now = new Date();
  const currentDate = now.toISOString().replace('T', ' ').substring(0, 19);

  // Build memory section if available
  let memorySection = '';
  if (memoryContent) {
    memorySection = `MEMORY ABOUT USER:\n\n${memoryContent}\n\n---\n`;
  }

  // Replace placeholders
  template = template
    .replace(/{current_date}/g, currentDate)
    .replace(/{memory_section}/g, memorySection)
    .replace(/{task}/g, task);

  return template;
}

// Export constant version with default cwd for backward compatibility
export const SYSTEM_PROMPT = getSystemPrompt(process.cwd());
