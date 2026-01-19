/**
 * Tool executors - actual implementation of each tool
 */

import { resolve, relative, isAbsolute, normalize, sep } from "path";
import { realpathSync, existsSync } from "fs";
import type { ToolResult, ToolExecutionContext } from "./tools/base-tool.js";
import type { ApiSettings } from "../types.js";

// Import tool executors
import { executeBashTool } from "./tools/bash-tool.js";
import { executeReadTool } from "./tools/read-tool.js";
import { executeWriteTool } from "./tools/write-tool.js";
import { executeEditTool } from "./tools/edit-tool.js";
import { executeGlobTool } from "./tools/glob-tool.js";
import { executeGrepTool } from "./tools/grep-tool.js";
import { WebSearchTool } from "./tools/web-search.js";
import { ExtractPageContentTool } from "./tools/extract-page-content.js";
import { ZaiReaderTool } from "./tools/zai-reader.js";
import { executeMemoryTool } from "./tools/memory-tool.js";
import { executeJSTool } from "./tools/execute-js-tool.js";
import { executeReadDocumentTool } from "./tools/read-document-tool.js";
import { executeRenderPageTool } from "./tools/render-page-tool.js";
import { executeManageTodosTool } from "./tools/manage-todos-tool.js";
import { ScheduleTaskTool } from "./tools/schedule-task-tool.js";
import {
  executeGitStatusTool,
  executeGitLogTool,
  executeGitDiffTool,
  executeGitBranchTool,
  executeGitCheckoutTool,
  executeGitAddTool,
  executeGitCommitTool,
  executeGitPushTool,
  executeGitPullTool,
  executeGitResetTool,
  executeGitShowTool,
} from "./tools/git-tool.js";
import {
  executeFetchTool,
  executeFetchJsonTool,
  executeFetchHtmlTool,
  executeDownloadTool,
} from "./tools/fetch-tool.js";
import {
  executeBrowserNavigateTool,
  executeBrowserClickTool,
  executeBrowserTypeTool,
  executeBrowserSelectTool,
  executeBrowserHoverTool,
  executeBrowserScrollTool,
  executeBrowserPressKeyTool,
  executeBrowserWaitForTool,
  executeBrowserSnapshotTool,
  executeBrowserScreenshotTool,
  executeBrowserExecuteScriptTool,
} from "./tools/browser-tool.js";
import {
  executeSearchTool,
  executeSearchNewsTool,
  executeSearchImagesTool,
} from "./tools/duckduckgo-search-tool.js";
import type { SchedulerStore } from "./scheduler-store.js";

export { ToolResult };

export class ToolExecutor {
  private cwd: string;
  private apiSettings: ApiSettings | null;
  private webSearchTool: WebSearchTool | null = null;
  private extractPageTool: ExtractPageContentTool | null = null;
  private zaiReaderTool: ZaiReaderTool | null = null;
  private scheduleTaskTool: ScheduleTaskTool | null = null;

  constructor(
    cwd: string,
    apiSettings: ApiSettings | null = null,
    schedulerStore?: SchedulerStore,
  ) {
    // Normalize and resolve the working directory to absolute path
    // If cwd is empty or undefined, keep it empty (no workspace mode)
    this.cwd = cwd && cwd.trim() ? normalize(resolve(cwd)) : "";
    this.apiSettings = apiSettings;

    // Initialize web tools based on provider and API key availability
    // Now these tools have fallbacks, so we can always initialize them
    const provider = apiSettings?.webSearchProvider || "tavily";
    const zaiApiUrl = apiSettings?.zaiApiUrl || "default";

    // Web search tool with DuckDuckGo fallback
    if (provider === "tavily" && apiSettings?.tavilyApiKey) {
      this.webSearchTool = new WebSearchTool(
        apiSettings.tavilyApiKey,
        "tavily",
        "default",
      );
    } else if (provider === "zai" && apiSettings?.zaiApiKey) {
      this.webSearchTool = new WebSearchTool(
        apiSettings.zaiApiKey,
        "zai",
        zaiApiUrl,
      );
    } else {
      // Use DuckDuckGo fallback (no API key required)
      this.webSearchTool = new WebSearchTool(null, "tavily", "default");
    }

    // Page extraction with fetch fallback
    if (provider === "tavily" && apiSettings?.tavilyApiKey) {
      this.extractPageTool = new ExtractPageContentTool(
        apiSettings.tavilyApiKey,
        "tavily",
      );
    } else {
      // Use fetch fallback (no API key required)
      this.extractPageTool = new ExtractPageContentTool(null, "tavily");
    }

    // Initialize ZaiReader with fetch fallback
    const zaiReaderApiUrl = apiSettings?.zaiReaderApiUrl || "default";
    if (apiSettings?.enableZaiReader && apiSettings?.zaiApiKey) {
      this.zaiReaderTool = new ZaiReaderTool(
        apiSettings.zaiApiKey,
        zaiReaderApiUrl,
      );
    } else {
      // Use fetch fallback (no API key required)
      this.zaiReaderTool = new ZaiReaderTool(null, "default");
    }

    // Initialize scheduler tool
    if (schedulerStore) {
      this.scheduleTaskTool = new ScheduleTaskTool(schedulerStore);
    }
  }

  // Security: Check if path is within allowed directory (enhanced protection)
  private isPathSafe(filePath: string): boolean {
    try {
      // Normalize input path to prevent path traversal tricks
      const normalizedInput = normalize(filePath);

      // Resolve to absolute path relative to cwd
      const absolutePath = resolve(this.cwd, normalizedInput);

      // If path exists, get real path (resolves symlinks)
      // This prevents symlink attacks
      let realPath = absolutePath;
      if (existsSync(absolutePath)) {
        try {
          realPath = realpathSync(absolutePath);
        } catch {
          // If realpath fails, use absolute path
          realPath = absolutePath;
        }
      }

      // Normalize the real path
      const normalizedRealPath = normalize(realPath);
      const normalizedCwd = normalize(this.cwd);

      // Check if the path is within cwd using string comparison
      // Add separator to prevent partial matches (e.g., /app vs /app-data)
      const cwdWithSep = normalizedCwd.endsWith(sep)
        ? normalizedCwd
        : normalizedCwd + sep;
      const isInside =
        normalizedRealPath === normalizedCwd ||
        normalizedRealPath.startsWith(cwdWithSep);

      if (!isInside) {
        console.warn(
          `[Security] Blocked access to path outside working directory:`,
        );
        console.warn(`  Requested: ${filePath}`);
        console.warn(`  Resolved: ${normalizedRealPath}`);
        console.warn(`  Working dir: ${normalizedCwd}`);
      }

      return isInside;
    } catch (error) {
      console.error(`[Security] Error checking path safety: ${error}`);
      return false;
    }
  }

  private getContext(
    extra?: Partial<ToolExecutionContext>,
  ): ToolExecutionContext {
    return {
      cwd: this.cwd,
      isPathSafe: this.isPathSafe.bind(this),
      ...extra,
    };
  }

  async executeTool(
    toolName: string,
    args: Record<string, any>,
    extraContext?: Partial<ToolExecutionContext>,
  ): Promise<ToolResult> {
    console.log(`[Tool Executor] Executing ${toolName}`, args);

    const context = this.getContext(extraContext);

    // Check if cwd is valid for file operations
    const fileOperationTools = [
      "write_file",
      "edit_file",
      "run_command",
      "read_file",
      "execute_js",
      "read_document",
    ];
    if (fileOperationTools.includes(toolName)) {
      if (!this.cwd || this.cwd === "." || this.cwd === "") {
        return {
          success: false,
          error:
            `❌ Cannot perform file operations without a workspace folder.\n\n` +
            `📁 To enable file access:\n` +
            `1. Click "+ New Task" in the sidebar\n` +
            `2. Choose a workspace folder using the "Browse..." button\n` +
            `3. Start a new task session\n\n` +
            `💬 You can continue talking and using tools without file access, but I won't be able to read, write, or edit files.`,
        };
      }
    }

    try {
      switch (toolName) {
        case "run_command":
          return await executeBashTool(args as any, context);

        case "read_file":
          return await executeReadTool(args as any, context);

        case "write_file":
          return await executeWriteTool(args as any, context);

        case "edit_file":
          return await executeEditTool(args as any, context);

        case "search_files":
          return await executeGlobTool(args as any, context);

        case "search_text":
          return await executeGrepTool(args as any, context);

        case "search_web":
          return await this.executeWebSearch(args);

        case "extract_page":
          return await this.executeExtractPage(args);

        case "read_page":
          return await this.executeZaiReader(args);

        case "manage_memory":
          return await executeMemoryTool(args as any, context);

        case "execute_js":
          return await executeJSTool(args as any, context);

        case "read_document":
          return await executeReadDocumentTool(args as any, context);

        case "render_page":
          return await executeRenderPageTool(args as any, context);

        case "manage_todos":
          return await executeManageTodosTool(args as any, context);

        case "git_status":
          return await executeGitStatusTool(args as any, context);

        case "git_log":
          return await executeGitLogTool(args as any, context);

        case "git_diff":
          return await executeGitDiffTool(args as any, context);

        case "git_branch":
          return await executeGitBranchTool(args as any, context);

        case "git_checkout":
          return await executeGitCheckoutTool(args as any, context);

        case "git_add":
          return await executeGitAddTool(args as any, context);

        case "git_commit":
          return await executeGitCommitTool(args as any, context);

        case "git_push":
          return await executeGitPushTool(args as any, context);

        case "git_pull":
          return await executeGitPullTool(args as any, context);

        case "git_reset":
          return await executeGitResetTool(args as any, context);

        case "git_show":
          return await executeGitShowTool(args as any, context);

        // Fetch tools
        case "fetch":
          return await executeFetchTool(args as any, context);

        case "fetch_json":
          return await executeFetchJsonTool(args as any, context);

        case "fetch_html":
          return await executeFetchHtmlTool(args as any, context);

        case "download":
          return await executeDownloadTool(args as any, context);

        // Browser automation tools
        case "browser_navigate":
          return await executeBrowserNavigateTool(args as any, context);

        case "browser_click":
          return await executeBrowserClickTool(args as any, context);

        case "browser_type":
          return await executeBrowserTypeTool(args as any, context);

        case "browser_select":
          return await executeBrowserSelectTool(args as any, context);

        case "browser_hover":
          return await executeBrowserHoverTool(args as any, context);

        case "browser_scroll":
          return await executeBrowserScrollTool(args as any, context);

        case "browser_press_key":
          return await executeBrowserPressKeyTool(args as any, context);

        case "browser_wait_for":
          return await executeBrowserWaitForTool(args as any, context);

        case "browser_snapshot":
          return await executeBrowserSnapshotTool(args as any, context);

        case "browser_screenshot":
          return await executeBrowserScreenshotTool(args as any, context);

        case "browser_execute_script":
          return await executeBrowserExecuteScriptTool(args as any, context);

        // DuckDuckGo search tools
        case "search":
          return await executeSearchTool(args as any, context);

        case "search_news":
          return await executeSearchNewsTool(args as any, context);

        case "search_images":
          return await executeSearchImagesTool(args as any, context);

        case "Scheduler":
          return await this.executeScheduleTask(args, context);

        default:
          return {
            success: false,
            error: `Unknown tool: ${toolName}`,
          };
      }
    } catch (error) {
      console.error(`[Tool Executor] Error in ${toolName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeWebSearch(args: any): Promise<ToolResult> {
    if (!this.webSearchTool) {
      const provider = this.apiSettings?.webSearchProvider || "tavily";
      const apiKeyField = provider === "tavily" ? "Tavily" : "Z.AI";
      return {
        success: false,
        error: `Web search is not available. Please configure ${apiKeyField} API key in Settings.`,
      };
    }

    try {
      const results = await this.webSearchTool.search({
        query: args.query,
        explanation: args.explanation,
        max_results: args.max_results || 5,
      });

      const formatted = this.webSearchTool.formatResults(results);

      return {
        success: true,
        output: formatted,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Web search failed: ${error.message}`,
      };
    }
  }

  private async executeExtractPage(args: any): Promise<ToolResult> {
    if (!this.extractPageTool) {
      const provider = this.apiSettings?.webSearchProvider || "tavily";
      if (provider !== "tavily") {
        return {
          success: false,
          error:
            "Page extraction is only available when using Tavily as the web search provider. Please switch to Tavily in Settings to use this feature.",
        };
      }
      return {
        success: false,
        error:
          "Page extraction is not available. Please configure Tavily API key in Settings.",
      };
    }

    try {
      const results = await this.extractPageTool.extract({
        urls: args.urls,
        explanation: args.explanation,
      });

      const formatted = this.extractPageTool.formatResults(results);

      return {
        success: true,
        output: formatted,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Page extraction failed: ${error.message}`,
      };
    }
  }

  private async executeZaiReader(args: any): Promise<ToolResult> {
    if (!this.zaiReaderTool) {
      return {
        success: false,
        error:
          "Z.AI Reader is not available. Please configure Z.AI as the web search provider and provide a valid API key in Settings.",
      };
    }

    try {
      const result = await this.zaiReaderTool.execute(args, this.getContext());
      return result;
    } catch (error: any) {
      return {
        success: false,
        error: `Z.AI Reader failed: ${error.message}`,
      };
    }
  }

  private async executeScheduleTask(
    args: any,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!this.scheduleTaskTool) {
      return {
        success: false,
        error: "Scheduler is not available. Database not initialized.",
      };
    }

    return await this.scheduleTaskTool.execute(args, context);
  }
}
