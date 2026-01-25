# System Prompt Architecture

## Overview

The system prompt is built dynamically from a template with variable substitution.

## Template Location

`src/electron/libs/prompts/system.txt`

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

<AVAILABLE_TOOLS>
  Tool descriptions with conditional lines
</AVAILABLE_TOOLS>

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

## Variable Substitution

Variables are replaced at runtime in `prompt-loader.ts`:

| Variable | Source | Example |
|----------|--------|---------|
| `{osName}` | `os.platform()` | `darwin`, `win32`, `linux` |
| `{platform}` | `os.arch()` | `x64`, `arm64` |
| `{shell}` | OS-dependent | `zsh`, `PowerShell`, `bash` |
| `{cwd}` | Session workspace | `/Users/john/project` |

### Conditional Lines

Some lines are conditionally included based on settings:

```
{attach_image_line}
- `attach_image` - Load a local image file...

{read_page_line}
- `read_page` - Read web page content (Z.AI Reader)

{memory_line}
- `manage_memory` - Store/read persistent preferences
```

## Building the Prompt

`src/electron/libs/prompt-loader.ts`:

```typescript
export function getSystemPrompt(cwd: string, settings: ApiSettings | null): string {
  // 1. Load template from system.txt
  const template = loadTemplate();
  
  // 2. Detect OS and shell
  const osName = os.platform();
  const shell = getShell(osName);
  
  // 3. Build conditional lines based on settings
  const memoryLine = settings?.enableMemory !== false 
    ? '- `manage_memory` - ...' 
    : '';
  
  // 4. Replace all variables
  return template
    .replace(/{osName}/g, osName)
    .replace(/{shell}/g, shell)
    .replace(/{cwd}/g, cwd)
    .replace(/{memory_line}/g, memoryLine)
    // ... more replacements
}
```

## OS-Specific Commands

The prompt includes platform-specific command hints:

**macOS/Linux:**
```
<list_files>ls -la</list_files>
<view_file>cat filename</view_file>
<find_files>find . -name "pattern"</find_files>
```

**Windows:**
```
<list_files>Get-ChildItem -Force</list_files>
<view_file>Get-Content filename</view_file>
<find_files>Get-ChildItem -Recurse -Filter "pattern"</find_files>
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

1. **Keep template readable** - Use XML-like tags for structure
2. **Minimize tokens** - Remove unnecessary words
3. **Be specific** - Clear instructions reduce hallucinations
4. **Test changes** - Prompt changes affect all conversations
5. **Version control** - Track prompt changes in git
