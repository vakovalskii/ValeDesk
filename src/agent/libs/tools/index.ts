/**
 * Tools index - exports all tool definitions and executors
 */

// Base interfaces
export * from "./base-tool.js";

// File operation tools
export * from "./bash-tool.js";
export * from "./read-tool.js";
export * from "./write-tool.js";
export * from "./edit-tool.js";

// Search tools
export * from "./glob-tool.js";
export * from "./grep-tool.js";

// Web tools
export * from "./web-search.js";
export * from "./extract-page-content.js";
export * from "./zai-reader.js";
export * from "./attach-image-tool.js";
export * from "./fetch-tool.js";
export * from "./browser-tool.js";
export * from "./duckduckgo-search-tool.js";

// Memory tool
export * from "./memory-tool.js";

// Execute JS tool (works out of the box)
export * from "./execute-js-tool.js";

// Execute Python tool (requires Python 3 installed)
export * from "./execute-python-tool.js";

// ReadDocument tool (PDF + DOCX)
export * from "./read-document-tool.js";

// ManageTodos tool (Task planning)
export * from "./manage-todos-tool.js";

// ScheduleTask tool (Task scheduling with notifications)
export * from "./schedule-task-tool.js";

// Git tools (Version control operations)
export * from "./git-tool.js";

// Skills tool (Agent Skills integration)
export * from "./skills-tool.js";

// Tool definitions array
import { BashToolDefinition } from "./bash-tool.js";
import { ReadToolDefinition } from "./read-tool.js";
import { WriteToolDefinition } from "./write-tool.js";
import { EditToolDefinition } from "./edit-tool.js";
import { GlobToolDefinition } from "./glob-tool.js";
import { GrepToolDefinition } from "./grep-tool.js";
import { WebSearchToolDefinition } from "./web-search.js";
import { ExtractPageContentToolDefinition } from "./extract-page-content.js";
import { ZaiReaderToolDefinition } from "./zai-reader.js";
import { AttachImageToolDefinition } from "./attach-image-tool.js";
import { MemoryToolDefinition } from "./memory-tool.js";
import { ExecuteJSToolDefinition } from "./execute-js-tool.js";
import { ExecutePythonToolDefinition } from "./execute-python-tool.js";
import { ReadDocumentToolDefinition } from "./read-document-tool.js";
import { ManageTodosToolDefinition } from "./manage-todos-tool.js";
import { ScheduleTaskToolDefinition } from "./schedule-task-tool.js";
import { ALL_GIT_TOOL_DEFINITIONS } from "./git-tool.js";
import { ALL_FETCH_TOOL_DEFINITIONS } from "./fetch-tool.js";
import { ALL_BROWSER_TOOL_DEFINITIONS } from "./browser-tool.js";
import { ALL_SEARCH_TOOL_DEFINITIONS } from "./duckduckgo-search-tool.js";
import { SkillsToolDefinition } from "./skills-tool.js";

const electronOnlyToolDefinitions: any[] = [];

export const ALL_TOOL_DEFINITIONS = [
  BashToolDefinition,
  ReadToolDefinition,
  WriteToolDefinition,
  EditToolDefinition,
  GlobToolDefinition,
  GrepToolDefinition,
  WebSearchToolDefinition,
  ExtractPageContentToolDefinition,
  ZaiReaderToolDefinition,
  AttachImageToolDefinition,
  MemoryToolDefinition,
  ExecuteJSToolDefinition,
  ExecutePythonToolDefinition,
  ReadDocumentToolDefinition,
  ManageTodosToolDefinition,
  ScheduleTaskToolDefinition,
  ...electronOnlyToolDefinitions,
  ...ALL_GIT_TOOL_DEFINITIONS,
  ...ALL_FETCH_TOOL_DEFINITIONS,
  ...ALL_BROWSER_TOOL_DEFINITIONS,
  ...ALL_SEARCH_TOOL_DEFINITIONS,
  SkillsToolDefinition,
];
