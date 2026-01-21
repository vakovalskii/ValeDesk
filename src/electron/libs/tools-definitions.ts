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
const FETCH_TOOLS = ['fetch', 'fetch_json', 'download', 'fetch_html'];

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
