# System Prompt Architecture

## Overview

The system prompt is built dynamically from a template with variable substitution.
**Tools are NOT hardcoded** - they are generated dynamically from active tool definitions.

## Template Location

`src/agent/libs/prompts/system.txt`

## Template Structure

```xml
<MAIN_ROLE_AGENT>
  Core agent instructions
</MAIN_ROLE_AGENT>

<SYSTEM_ENVIRONMENT>
  <operating_system>{osName}</operating_system>
  <platform>{platform}</platform>
  <shell>{shell}</shell>
  <current_working_directory>{cwd}</current_working_directory>
</SYSTEM_ENVIRONMENT>

<TOOL_USAGE_GUIDELINES>
  {tools_summary}  <!-- Generated dynamically from active tools -->
  Usage principles and common patterns
</TOOL_USAGE_GUIDELINES>

<OS_SPECIFIC_COMMANDS os="{osName}">
  Platform-specific command references
</OS_SPECIFIC_COMMANDS>

<LANGUAGE_GUIDELINES>
  Multi-language support rules
</LANGUAGE_GUIDELINES>

<IMPORTANT_RULES>
  Numbered rules for agent behavior
</IMPORTANT_RULES>
```

## Dynamic Tools Summary

The `{tools_summary}` is generated from actual tool definitions:

```typescript
// In tools-definitions.ts
export function generateToolsSummary(tools: ToolDefinition[]): string {
  // Groups tools by category (File, Code, System, Web, Browser, Git, etc.)
  // Returns concise list like:
  // **Available Tools** (use via function calling):
  // - File: `read_file`, `write_file`, `edit_file`
  // - Git: `git_*` (11 tools)
  // - Browser: `browser_*` (11 tools)
}
```

This ensures:
1. ✅ No hardcoded tool lists
2. ✅ Always matches actual available tools
3. ✅ Respects user settings (disabled tools not shown)

## Variable Substitution

Variables are replaced at runtime in `prompt-loader.ts`:

| Variable | Source | Example |
|----------|--------|---------|
| `{osName}` | `os.platform()` | `macOS`, `Windows`, `Linux` |
| `{platform}` | `os.arch()` | `darwin`, `win32`, `linux` |
| `{shell}` | OS-dependent | `bash`, `PowerShell` |
| `{cwd}` | Session workspace | `/Users/john/project` |
| `{tools_summary}` | `generateToolsSummary()` | Dynamic tool list |
| `{skills_section}` | Loaded skills | Skill instructions |

## Building the Prompt

`src/agent/libs/prompt-loader.ts`:

```typescript
export function getSystemPrompt(cwd: string, toolsSummary: string = ''): string {
  // 1. Load template from system.txt
  const template = loadTemplate();
  
  // 2. Detect OS and shell
  const osName = getOSName();
  const cmds = getShellCommands();
  
  // 3. Build skills section
  const skillsSection = generateSkillsPromptSection();
  
  // 4. Replace all variables
  return template
    .replace(/{osName}/g, osName)
    .replace(/{shell}/g, isWindows ? 'PowerShell' : 'bash')
    .replace(/{cwd}/g, cwd)
    .replace(/{tools_summary}/g, toolsSummary)
    .replace(/{skills_section}/g, skillsSection)
    // ... more replacements
}
```

Usage in `runner-openai.ts`:

```typescript
// Get filtered tools based on user settings
const activeTools = getTools(settings);

// Generate summary for system prompt
const toolsSummary = generateToolsSummary(activeTools);

// Build complete system prompt
const systemContent = getSystemPrompt(cwd, toolsSummary);
```

## OS-Specific Commands

The prompt includes platform-specific command hints:

**macOS/Linux:**
```xml
<list_files>ls</list_files>
<view_file>cat filename</view_file>
<find_files>find . -name "pattern"</find_files>
```

**Windows:**
```xml
<list_files>Get-ChildItem</list_files>
<view_file>Get-Content filename</view_file>
<find_files>Get-ChildItem -Recurse -Name</find_files>
```

## Todos Integration

When session has active todos, they're appended to system prompt:

```typescript
const todosSummary = getTodosSummary(session.id);
if (todosSummary) {
  systemContent += todosSummary;
}
```

Format:
```xml
<CURRENT_TODOS>
<todo id="1" status="completed">Research API options</todo>
<todo id="2" status="in_progress">Implement authentication</todo>
<todo id="3" status="pending">Write tests</todo>
</CURRENT_TODOS>
```

## Memory Integration

User's persistent memory is added to the FIRST user message:

```typescript
function getInitialPrompt(prompt: string, memory?: string): string {
  let content = `Current date: ${new Date().toISOString()}\n\n`;
  
  if (memory) {
    content += `<USER_MEMORY>\n${memory}\n</USER_MEMORY>\n\n`;
  }
  
  content += `ORIGINAL USER REQUEST:\n\n${prompt}`;
  return content;
}
```

## Skills Integration

Loaded skills add their instructions to the prompt:

```xml
{skills_section}

<LOADED_SKILLS>
<skill name="code-review">
  Instructions for code review...
</skill>
</LOADED_SKILLS>
```

## Best Practices

1. **Dynamic over static** - Generate tool lists from definitions
2. **Keep template readable** - Use XML-like tags for structure
3. **Minimize tokens** - Remove unnecessary words
4. **Be specific** - Clear instructions reduce hallucinations
5. **Test changes** - Prompt changes affect all conversations
