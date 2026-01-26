/**
 * OpenAI-compatible tool definitions for Qwen and other models
 */

import { ALL_TOOL_DEFINITIONS } from './tools/index.js';
import type { ApiSettings } from '../types.js';

// Git tool names
const GIT_TOOLS = ['git_status', 'git_log', 'git_diff', 'git_branch', 'git_checkout', 'git_add', 'git_commit', 'git_push', 'git_pull', 'git_reset', 'git_show'];

// Browser tool names
const BROWSER_TOOLS = ['browser_navigate', 'browser_click', 'browser_type', 'browser_select', 'browser_hover', 'browser_scroll', 'browser_press_key', 'browser_wait_for', 'browser_snapshot', 'browser_screenshot', 'browser_execute_script'];

// DuckDuckGo search tool names (no API key needed)
const DUCKDUCKGO_TOOLS = ['search', 'search_news', 'search_images'];

// Fetch/HTTP tool names
const FETCH_TOOLS = ['fetch', 'fetch_json', 'download_file', 'fetch_html'];

// Image attachment tool names
const IMAGE_TOOLS = ['attach_image'];

// Tavily/Z.AI web search tools
const WEB_SEARCH_TOOLS = ['search_web', 'extract_page'];

// Get tools based on settings
export function getTools(settings: ApiSettings | null) {
  let tools = [...ALL_TOOL_DEFINITIONS];
  
  // Filter out Memory tool only when explicitly disabled
  if (settings?.enableMemory === false) {
    tools = tools.filter(tool => tool.function.name !== 'manage_memory');
  }
  
  // Filter out ZaiReader if not enabled
  if (!settings?.enableZaiReader) {
    tools = tools.filter(tool => tool.function.name !== 'read_page');
  }
  
  // Filter out Git tools if not enabled
  if (!settings?.enableGitTools) {
    tools = tools.filter(tool => !GIT_TOOLS.includes(tool.function.name));
  }
  
  // Filter out Browser tools if not enabled
  if (!settings?.enableBrowserTools) {
    tools = tools.filter(tool => !BROWSER_TOOLS.includes(tool.function.name));
  }
  
  // Filter out DuckDuckGo tools if not enabled
  if (!settings?.enableDuckDuckGo) {
    tools = tools.filter(tool => !DUCKDUCKGO_TOOLS.includes(tool.function.name));
  }
  
  // Filter out Fetch tools if not enabled
  if (!settings?.enableFetchTools) {
    tools = tools.filter(tool => !FETCH_TOOLS.includes(tool.function.name));
  }

  // Filter out Image tools if not enabled
  if (!settings?.enableImageTools) {
    tools = tools.filter(tool => !IMAGE_TOOLS.includes(tool.function.name));
  }
  
  // Filter out web search tools only if explicitly disabled
  // WebSearchTool supports DuckDuckGo fallback without API keys.
  const tavilyEnabled = settings?.enableTavilySearch || false;
  const zaiEnabled = !!settings?.zaiApiKey;
  const hasWebSearch = tavilyEnabled || zaiEnabled;
  
  if (!hasWebSearch) {
    tools = tools.filter(tool => !WEB_SEARCH_TOOLS.includes(tool.function.name));
  }
  
  return tools;
}

// Export all tools (for backward compatibility)
export const TOOLS = ALL_TOOL_DEFINITIONS;

/**
 * Generate a summary of available tools for system prompt
 * Groups tools by category and returns concise list
 */
export function generateToolsSummary(tools: typeof ALL_TOOL_DEFINITIONS): string {
  if (tools.length === 0) return '';
  
  // Group tools by prefix/category
  const categories: Record<string, string[]> = {
    'File': [],
    'Code': [],
    'System': [],
    'Web': [],
    'Browser': [],
    'Git': [],
    'Memory': [],
    'Tasks': [],
    'Scheduler': [],
    'Other': []
  };
  
  for (const tool of tools) {
    const name = tool.function.name;
    
    if (name.startsWith('git_')) {
      categories['Git'].push(name);
    } else if (name.startsWith('browser_')) {
      categories['Browser'].push(name);
    } else if (['read_file', 'write_file', 'edit_file', 'search_files', 'search_text', 'read_document', 'attach_image'].includes(name)) {
      categories['File'].push(name);
    } else if (name === 'execute_js' || name === 'execute_python') {
      categories['Code'].push(name);
    } else if (name === 'run_command') {
      categories['System'].push(name);
    } else if (['search_web', 'extract_page', 'read_page', 'fetch_html', 'fetch_json', 'download_file', 'search', 'search_news', 'search_images'].includes(name)) {
      categories['Web'].push(name);
    } else if (name === 'manage_memory') {
      categories['Memory'].push(name);
    } else if (name === 'manage_todos') {
      categories['Tasks'].push(name);
    } else if (name === 'schedule_task') {
      categories['Scheduler'].push(name);
    } else {
      categories['Other'].push(name);
    }
  }
  
  // Build summary string
  const lines: string[] = ['**Available Tools** (use via function calling):'];
  
  for (const [category, toolNames] of Object.entries(categories)) {
    if (toolNames.length === 0) continue;
    
    // Check if all tools share the same prefix (like git_*, browser_*)
    const prefixes = new Set(toolNames.map(t => t.split('_')[0]));
    const hasUniformPrefix = prefixes.size === 1 && toolNames.length > 3;
    
    if (hasUniformPrefix) {
      // Compact form for uniform prefix groups (git_*, browser_*)
      const prefix = toolNames[0].split('_')[0];
      lines.push(`- ${category}: \`${prefix}_*\` (${toolNames.length} tools)`);
    } else if (toolNames.length <= 5) {
      // Show all tools if 5 or fewer
      lines.push(`- ${category}: ${toolNames.map(t => '`' + t + '`').join(', ')}`);
    } else {
      // Show first few + count for large mixed groups
      const shown = toolNames.slice(0, 3).map(t => '`' + t + '`').join(', ');
      lines.push(`- ${category}: ${shown} (+${toolNames.length - 3} more)`);
    }
  }
  
  return lines.join('\n');
}
