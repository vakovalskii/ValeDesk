import { BaseTool, ToolResult, ToolExecutionContext } from "./base-tool.js";
import { getEnabledSkills, loadSkillsSettings, Skill } from "../skills-store.js";
import { 
  readSkillContent, 
  listSkillFiles, 
  readSkillFile,
  getSkillPath
} from "../skills-loader.js";

export const SkillsToolDefinition = {
  type: "function" as const,
  function: {
    name: "load_skill",
    description: `Load a skill to get detailed instructions, scripts, and resources. 
Use this when you need to perform a specialized task and want to follow best practices.
Skills provide step-by-step instructions, example code, and guidelines for specific tasks.

Available operations:
- "get": Get the full SKILL.md content with instructions
- "list_files": List all files in the skill directory  
- "read_file": Read a specific file from the skill (scripts, references, etc.)
- "list_available": List all enabled skills`,
    parameters: {
      type: "object" as const,
      properties: {
        operation: {
          type: "string",
          enum: ["get", "list_files", "read_file", "list_available"],
          description: "The operation to perform"
        },
        skill_id: {
          type: "string",
          description: "The skill identifier (required for get, list_files, read_file)"
        },
        file_path: {
          type: "string",
          description: "Path to file within skill directory (required for read_file operation)"
        }
      },
      required: ["operation"]
    }
  }
};

export class SkillsTool extends BaseTool {
  name = "load_skill";
  
  get definition() {
    return SkillsToolDefinition;
  }
  
  async execute(
    args: { 
      operation: "get" | "list_files" | "read_file" | "list_available";
      skill_id?: string;
      file_path?: string;
    },
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const cwd = context.cwd; // Pass cwd to download skills to workspace
    
    try {
      switch (args.operation) {
        case "list_available":
          return this.listAvailableSkills();
          
        case "get":
          if (!args.skill_id) {
            return { success: false, error: "skill_id is required for 'get' operation" };
          }
          return this.getSkill(args.skill_id, cwd);
          
        case "list_files":
          if (!args.skill_id) {
            return { success: false, error: "skill_id is required for 'list_files' operation" };
          }
          return this.listSkillFiles(args.skill_id, cwd);
          
        case "read_file":
          if (!args.skill_id) {
            return { success: false, error: "skill_id is required for 'read_file' operation" };
          }
          if (!args.file_path) {
            return { success: false, error: "file_path is required for 'read_file' operation" };
          }
          return this.readSkillFile(args.skill_id, args.file_path, cwd);
          
        default:
          return { success: false, error: `Unknown operation: ${args.operation}` };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Skill operation failed: ${error.message}`
      };
    }
  }
  
  private listAvailableSkills(): ToolResult {
    const enabledSkills = getEnabledSkills();
    
    if (enabledSkills.length === 0) {
      return {
        success: true,
        output: "No skills are currently enabled. Ask the user to enable skills in Settings > Skills."
      };
    }
    
    const skillsList = enabledSkills.map((skill: Skill) => 
      `- **${skill.name}**: ${skill.description}${skill.category ? ` [${skill.category}]` : ""}`
    ).join("\n");
    
    return {
      success: true,
      output: `## Enabled Skills (${enabledSkills.length})\n\n${skillsList}\n\nUse \`load_skill\` with operation "get" and the skill_id to load detailed instructions.`
    };
  }
  
  private async getSkill(skillId: string, cwd?: string): Promise<ToolResult> {
    // Check if skill is enabled
    const enabledSkills = getEnabledSkills();
    const skill = enabledSkills.find((s: Skill) => s.id === skillId);
    
    if (!skill) {
      const settings = loadSkillsSettings();
      const allSkill = settings.skills.find((s: Skill) => s.id === skillId);
      
      if (allSkill) {
        return {
          success: false,
          error: `Skill "${skillId}" exists but is not enabled. Ask the user to enable it in Settings > Skills.`
        };
      }
      
      return {
        success: false,
        error: `Skill "${skillId}" not found. Use operation "list_available" to see enabled skills.`
      };
    }
    
    try {
      // Pass cwd to download skill to workspace/skills/
      const content = await readSkillContent(skillId, cwd);
      const skillDir = await getSkillPath(skillId, cwd);
      
      return {
        success: true,
        output: `## Skill: ${skill.name}\n\n**Skill directory:** \`${skillDir}\`\n\n> **Important:** All relative paths in this skill (scripts/, references/, config/, .env, etc.) must be resolved relative to the skill directory above, NOT relative to the user's working directory.\n\n${content}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to load skill content: ${error.message}`
      };
    }
  }
  
  private async listSkillFiles(skillId: string, cwd?: string): Promise<ToolResult> {
    const enabledSkills = getEnabledSkills();
    const skill = enabledSkills.find((s: Skill) => s.id === skillId);
    
    if (!skill) {
      return {
        success: false,
        error: `Skill "${skillId}" is not enabled or not found.`
      };
    }
    
    try {
      const files = await listSkillFiles(skillId, cwd);
      const skillDir = await getSkillPath(skillId, cwd);
      
      const filesList = files.map((f: string) => `- ${f}`).join("\n");
      
      return {
        success: true,
        output: `## Files in skill "${skillId}":\n\n**Skill directory:** \`${skillDir}\`\n\n${filesList}\n\n**To read these files, use this tool again with:**\n\`\`\`json\n{ "operation": "read_file", "skill_id": "${skillId}", "file_path": "<filename>" }\n\`\`\`\n\n⚠️ Do NOT use the regular \`read_file\` tool - these files are inside the skill directory.\n⚠️ All relative paths in scripts/config must be resolved relative to \`${skillDir}\`, NOT the user's working directory.`
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list skill files: ${error.message}`
      };
    }
  }
  
  private async readSkillFile(skillId: string, filePath: string, cwd?: string): Promise<ToolResult> {
    const enabledSkills = getEnabledSkills();
    const skill = enabledSkills.find((s: Skill) => s.id === skillId);
    
    if (!skill) {
      return {
        success: false,
        error: `Skill "${skillId}" is not enabled or not found.`
      };
    }
    
    try {
      const content = await readSkillFile(skillId, filePath, cwd);
      const skillDir = await getSkillPath(skillId, cwd);
      
      return {
        success: true,
        output: `## File: ${filePath}\n\n**Full path:** \`${skillDir}/${filePath}\`\n\n\`\`\`\n${content}\n\`\`\``
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`
      };
    }
  }
}

/**
 * Generate skills context for system prompt.
 * Includes skill directory paths so the agent knows where files are located.
 * @param cwd - Optional working directory for resolving skill paths
 */
export function generateSkillsPromptSection(cwd?: string): string {
  const enabledSkills = getEnabledSkills();
  
  if (enabledSkills.length === 0) {
    return "";
  }
  
  // Build skills list with paths (resolved asynchronously at startup, cached)
  const skillsList = enabledSkills.map((skill: Skill) => {
    return `- **${skill.name}**: ${skill.description}`;
  }).join("\n");
  
  return `
## Available Skills

You have access to specialized skills that provide detailed instructions for specific tasks.
When a task matches one of these skills, use the \`load_skill\` tool to get step-by-step guidance.

### Enabled Skills:
${skillsList}

### How to use skills:
1. When you recognize a task that matches a skill, call \`load_skill\` with operation "get" and the skill_id
2. Follow the instructions in the skill's SKILL.md
3. Use operation "list_files" to see available scripts and references
4. Use operation "read_file" to read specific scripts or reference files
5. When SKILL.md references relative paths (e.g., \`scripts/foo.py\`), resolve them relative to the **skill directory** shown in the output, NOT relative to the user's working directory
6. If \`scripts/\` exist in the skill, prefer running or patching them instead of retyping large code blocks
7. NEVER read .env files directly — if a skill needs API keys or secrets, ask the user to set them as environment variables

Skills help you follow best practices and produce consistent, high-quality results.
`;
}
