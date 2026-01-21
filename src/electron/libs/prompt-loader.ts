/**
 * Prompt loader - loads and formats prompts from template files
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
 * Scan installed packages in sandbox
 */
function getSandboxPackages(cwd: string): string[] {
  try {
    const sandboxDir = join(cwd, '.localdesk-sandbox', 'node_modules');
    if (!existsSync(sandboxDir)) {
      return [];
    }
    
    const packages: string[] = [];
    const entries = readdirSync(sandboxDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      
      if (entry.name.startsWith('@')) {
        // Scoped package
        const scopedDir = join(sandboxDir, entry.name);
        const scopedPackages = readdirSync(scopedDir);
        scopedPackages.forEach(pkg => packages.push(`${entry.name}/${pkg}`));
      } else if (entry.isDirectory()) {
        packages.push(entry.name);
      }
    }
    
    return packages.sort();
  } catch (error) {
    console.log('[Prompt Loader] Error scanning sandbox packages:', error);
    return [];
  }
}

type PromptSettings = {
  enableZaiReader?: boolean;
  enableMemory?: boolean;
};

/**
 * Load system prompt from template file and replace placeholders
 */
export function getSystemPrompt(cwd: string, settings?: PromptSettings | null): string {
  const promptPath = join(__dirname, 'prompts', 'system.txt');
  let template = readFileSync(promptPath, 'utf-8');

  const osName = getOSName();
  const cmds = getShellCommands();
  const installedPackages = getSandboxPackages(cwd);
  
  // Build sandbox packages section
  let sandboxPackagesInfo = '';
  if (installedPackages.length > 0) {
    sandboxPackagesInfo = `\n\n**Installed Sandbox Packages:**\nThe following npm packages are already installed and available via require():\n${installedPackages.map(pkg => `- ${pkg}`).join('\n')}`;
  }

  // Build optional tools lines
  const readPageLine = settings?.enableZaiReader 
    ? '- `read_page` - Read web page (Z.AI Reader)' 
    : '';
  const memoryLine = settings?.enableMemory || false
    ? '- `manage_memory` - Store/read long-term memory'
    : '';

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
    .replace(/{sandboxPackages}/g, sandboxPackagesInfo)
    .replace(/{read_page_line}/g, readPageLine)
    .replace(/{memory_line}/g, memoryLine);

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

