import { readFile, writeFile, unlink, access } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { mkdir } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';

export interface MemoryToolParams {
  explanation: string;
  operation: 'create' | 'append' | 'delete' | 'read';
  content?: string;
  section?: string; // Optional: specific section to delete
}

const LOCALDESK_DIR = '.localdesk';
const MEMORY_FILE = 'memory.md';

/**
 * Get memory file path.
 * If cwd is provided, use {cwd}/.localdesk/memory.md (workspace-local)
 * Otherwise, use global ~/.localdesk/memory.md
 */
function getMemoryPath(cwd?: string): string {
  if (cwd && cwd.trim()) {
    return join(cwd, LOCALDESK_DIR, MEMORY_FILE);
  }
  return join(homedir(), LOCALDESK_DIR, MEMORY_FILE);
}

export const MemoryToolDefinition = {
  type: 'function' as const,
  function: {
    name: 'manage_memory',
    description: `Manage long-term memory by storing important information in memory.md file.
    
Memory storage:
- **Workspace mode**: If a working directory is set, memory is stored in {cwd}/.localdesk/memory.md (project-specific)
- **Global mode**: Otherwise, memory is stored in ~/.localdesk/memory.md (persists across all projects)

**BE PROACTIVE**: You should automatically remember important information even if not explicitly asked:

Auto-remember when you notice:
- User's coding preferences (language, style, patterns)
- Repeated corrections or suggestions from user
- Project-specific conventions or requirements
- User's workflow patterns and habits
- Technical preferences (frameworks, libraries, tools)
- Personal context (timezone, work hours, communication style)
- Important project details or constraints
- User's expertise level in different areas

Explicit requests to remember:
- "Remember this..."
- "Save this for later..."
- "Don't forget that..."
- "Add to memory..."
- "Remove from memory..."
- "What do you remember about...?"

Operations:
- create: Create new memory.md file (overwrites existing)
- append: Add new information to existing memory (PREFERRED for gradual learning)
- delete: Remove specific section or clear all memory
- read: Read current memory contents

**BEST PRACTICE**: Use 'append' operation frequently to gradually build comprehensive user profile. Add small observations during conversations, not just when explicitly asked.

The memory persists across all sessions and projects, helping maintain context about user preferences, coding style, and important information.`,
    parameters: {
      type: 'object',
      properties: {
        explanation: {
          type: 'string',
          description: 'Brief explanation of why this memory operation is needed'
        },
        operation: {
          type: 'string',
          enum: ['create', 'append', 'delete', 'read'],
          description: 'Operation to perform: create (new file), append (add to existing), delete (remove section or clear), read (view current memory)'
        },
        content: {
          type: 'string',
          description: 'Content to write or append. Required for create/append operations. For delete, specify section to remove (or omit to clear all)'
        },
        section: {
          type: 'string',
          description: 'Optional: specific section/topic to delete from memory. If omitted with delete operation, clears all memory'
        }
      },
      required: ['explanation', 'operation']
    }
  }
};

export interface ToolContext {
  cwd: string;
}

export async function executeMemoryTool(
  args: MemoryToolParams,
  context: ToolContext
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    const memoryPath = getMemoryPath(context.cwd);
    const isWorkspaceLocal = context.cwd && context.cwd.trim() ? true : false;
    
    switch (args.operation) {
      case 'create': {
        if (!args.content) {
          return {
            success: false,
            error: 'Content is required for create operation'
          };
        }
        
        const dir = dirname(memoryPath);
        await mkdir(dir, { recursive: true });
        
        const timestamp = new Date().toISOString().split('T')[0];
        const memoryType = isWorkspaceLocal ? 'workspace' : 'global';
        const formattedContent = `# Memory (${memoryType})\n\nCreated: ${timestamp}\n\n---\n\n${args.content}\n`;
        
        await writeFile(memoryPath, formattedContent, 'utf-8');
        
        return {
          success: true,
          output: `Memory file created (${memoryType}): ${memoryPath}\n\nContent:\n${formattedContent}`
        };
      }
      
      case 'append': {
        if (!args.content) {
          return {
            success: false,
            error: 'Content is required for append operation'
          };
        }
        
        const dir = dirname(memoryPath);
        await mkdir(dir, { recursive: true });
        
        let existingContent = '';
        try {
          await access(memoryPath, constants.F_OK);
          existingContent = await readFile(memoryPath, 'utf-8');
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            // File doesn't exist, create it first
            const timestamp = new Date().toISOString().split('T')[0];
            const memoryType = isWorkspaceLocal ? 'workspace' : 'global';
            existingContent = `# Memory (${memoryType})\n\nCreated: ${timestamp}\n\n---\n\n`;
          } else {
            throw error;
          }
        }
        
        const timestamp = new Date().toISOString().split('T')[0];
        const newContent = `${existingContent}\n## ${timestamp}\n\n${args.content}\n`;
        
        await writeFile(memoryPath, newContent, 'utf-8');
        
        const memoryType = isWorkspaceLocal ? 'workspace' : 'global';
        return {
          success: true,
          output: `Added to ${memoryType} memory: ${memoryPath}\n\nNew entry:\n${args.content}`
        };
      }
      
      case 'delete': {
        try {
          await access(memoryPath, constants.F_OK);
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              success: false,
              error: 'Memory file does not exist'
            };
          }
          throw error;
        }
        
        if (args.section) {
          // Delete specific section
          const content = await readFile(memoryPath, 'utf-8');
          const lines = content.split('\n');
          const newLines: string[] = [];
          let skipSection = false;
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line contains the section to delete
            if (line.toLowerCase().includes(args.section.toLowerCase())) {
              skipSection = true;
              continue;
            }
            
            // Stop skipping when we hit the next section
            if (skipSection && (line.startsWith('##') || line.startsWith('#'))) {
              skipSection = false;
            }
            
            if (!skipSection) {
              newLines.push(line);
            }
          }
          
          await writeFile(memoryPath, newLines.join('\n'), 'utf-8');
          
          return {
            success: true,
            output: `Removed section "${args.section}" from memory`
          };
        } else {
          // Clear all memory
          await unlink(memoryPath);
          
          return {
            success: true,
            output: 'Memory cleared - file deleted'
          };
        }
      }
      
      case 'read': {
        const memoryType = isWorkspaceLocal ? 'workspace' : 'global';
        try {
          await access(memoryPath, constants.F_OK);
          const content = await readFile(memoryPath, 'utf-8');
          
          return {
            success: true,
            output: `Current ${memoryType} memory (${memoryPath}):\n\n${content}`
          };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            return {
              success: true,
              output: `No ${memoryType} memory file exists yet. Use create or append to start building memory.`
            };
          }
          throw error;
        }
      }
      
      default:
        return {
          success: false,
          error: `Unknown operation: ${args.operation}`
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Memory operation failed: ${error.message}`
    };
  }
}

