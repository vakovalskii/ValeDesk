/**
 * ReadDocument Tool - Extract text from PDF and DOCX files
 * Bundled - works out of the box, no installation needed
 */

import { readFileSync, statSync } from 'fs';
import { resolve, extname } from 'path';
import type { ToolDefinition, ToolResult, ToolExecutionContext } from './base-tool.js';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Dynamic imports for document parsers
let pdfParse: any = null;
let mammoth: any = null;

async function getPdfParse() {
  if (!pdfParse) {
    pdfParse = (await import('pdf-parse')).default;
  }
  return pdfParse;
}

async function getMammoth() {
  if (!mammoth) {
    mammoth = await import('mammoth');
  }
  return mammoth;
}

export const ReadDocumentToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "read_document",
    description: `Extract text content from document files (PDF, DOCX).
Returns extracted text, page count (for PDF), and metadata.
Max file size: 10MB. Scanned PDFs require external OCR tools.
Use start_line/end_line to read specific portions of extracted text.`,
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why you need to read this document"
        },
        file_path: {
          type: "string",
          description: "Path to the document file (PDF or DOCX)"
        },
        start_line: {
          type: "integer",
          description: "Start reading from this line number (1-based, inclusive). Optional."
        },
        end_line: {
          type: "integer",
          description: "Stop reading at this line number (1-based, inclusive). Optional."
        }
      },
      required: ["explanation", "file_path"]
    }
  }
};

export async function executeReadDocumentTool(
  args: { 
    file_path: string; 
    explanation: string;
    start_line?: number;
    end_line?: number;
  },
  context: ToolExecutionContext
): Promise<ToolResult> {
  // Security check
  if (!context.isPathSafe(args.file_path)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`
    };
  }
  
  try {
    const fullPath = resolve(context.cwd, args.file_path);
    const ext = extname(fullPath).toLowerCase();
    
    // Check supported formats
    if (ext !== '.pdf' && ext !== '.docx') {
      return {
        success: false,
        error: `❌ Unsupported format: ${ext}\n\nSupported formats: .pdf, .docx\n\nFor other text files, use the Read tool.`
      };
    }
    
    // Check file size
    const stats = statSync(fullPath);
    if (stats.size > MAX_FILE_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      return {
        success: false,
        error: `❌ File too large: ${sizeMB}MB (max: 10MB)\n\n💡 Suggestions:\n- Split the document into smaller parts\n- Extract only the pages you need\n- Use external tools for large documents`
      };
    }
    
    console.log(`[ReadDocument] Reading ${ext} file: ${fullPath} (${(stats.size / 1024).toFixed(1)}KB)`);
    
    if (ext === '.pdf') {
      return await readPDF(fullPath, args.file_path, stats.size, args.start_line, args.end_line);
    } else {
      return await readDOCX(fullPath, args.file_path, stats.size, args.start_line, args.end_line);
    }
    
  } catch (error: any) {
    console.error('[ReadDocument] Error:', error);
    
    let errorMsg = `❌ Failed to read document: ${error.message}\n\n`;
    
    if (error.code === 'ENOENT') {
      errorMsg += `💡 File not found. Check if the path is correct.\n`;
      errorMsg += `Use Glob tool to search for files: *.pdf or *.docx`;
    } else if (error.message.includes('Invalid PDF')) {
      errorMsg += `💡 File is corrupted or not a valid PDF.`;
    } else if (error.message.includes('encrypted') || error.message.includes('password')) {
      errorMsg += `💡 Document is password-protected. Remove protection first.`;
    }
    
    return {
      success: false,
      error: errorMsg
    };
  }
}

async function readPDF(
  fullPath: string, 
  displayPath: string, 
  fileSize: number,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  const dataBuffer = readFileSync(fullPath);
  const pdf = await getPdfParse();
  const data = await pdf(dataBuffer);
  
  console.log(`[ReadDocument] PDF: ${data.numpages} pages, ${data.text.length} chars`);
  
  // Check for scanned PDF
  if (data.text.trim().length < 50 && data.numpages > 0) {
    return {
      success: true,
      output: `⚠️ **Warning**: This PDF appears to be scanned (only ${data.text.trim().length} characters from ${data.numpages} pages).

**This means:**
- PDF contains images instead of text
- OCR (Optical Character Recognition) is needed

**Solutions:**
- Use OCR tools: Adobe Acrobat, Google Drive, Tesseract
- Ask user if they have a text version

**Any extracted text:**
\`\`\`
${data.text.trim() || '(none)'}
\`\`\``
    };
  }
  
  // Split text into lines for partial reading
  const lines = data.text.split('\n');
  const totalLines = lines.length;
  
  // Apply line filters
  let start = startLine ?? 1;
  let end = endLine ?? totalLines;
  
  // Validate and adjust line numbers
  start = Math.max(1, Math.min(start, totalLines));
  end = Math.max(start, Math.min(end, totalLines));
  
  // Extract lines (convert to 0-based index)
  const selectedLines = lines.slice(start - 1, end);
  const isPartial = start > 1 || end < totalLines;
  
  // Build output
  let output = `✅ **PDF extracted successfully**\n\n`;
  output += `📄 **File**: ${displayPath}\n`;
  output += `📊 **Pages**: ${data.numpages}\n`;
  output += `📝 **Total lines**: ${totalLines}\n`;
  if (isPartial) {
    output += `📑 **Showing**: lines ${start}-${end} of ${totalLines}\n`;
  }
  output += `💾 **Size**: ${(fileSize / 1024).toFixed(1)}KB\n`;
  
  if (data.info) {
    const meta: string[] = [];
    if (data.info.Title) meta.push(`Title: ${data.info.Title}`);
    if (data.info.Author) meta.push(`Author: ${data.info.Author}`);
    if (data.info.Creator) meta.push(`Creator: ${data.info.Creator}`);
    if (meta.length > 0) {
      output += `\n**Metadata:**\n${meta.map(m => `- ${m}`).join('\n')}\n`;
    }
  }
  
  // Add content with line numbers
  const contentWithLineNumbers = selectedLines.map((line: string, idx: number) => {
    const lineNum = String(start + idx).padStart(6, ' ');
    return `${lineNum}|${line}`;
  }).join('\n');
  
  output += `\n---\n**Content:**\n\`\`\`\n${contentWithLineNumbers}\n\`\`\``;
  
  // Add continuation hint if partial
  if (end < totalLines) {
    output += `\n\n[... ${totalLines - end} more lines. Use start_line=${end + 1} to continue reading.]`;
  }
  
  return { success: true, output };
}

async function readDOCX(
  fullPath: string, 
  displayPath: string, 
  fileSize: number,
  startLine?: number,
  endLine?: number
): Promise<ToolResult> {
  const dataBuffer = readFileSync(fullPath);
  const mammothLib = await getMammoth();
  
  const result = await mammothLib.extractRawText({ buffer: dataBuffer });
  const text = result.value;
  
  console.log(`[ReadDocument] DOCX: ${text.length} chars`);
  
  if (text.trim().length === 0) {
    return {
      success: true,
      output: `⚠️ **Warning**: DOCX file is empty or contains only images/tables.

**Possible reasons:**
- Document contains only images
- Document uses embedded objects
- Document is corrupted

Please check the file manually.`
    };
  }
  
  // Split text into lines for partial reading
  const lines = text.split('\n');
  const totalLines = lines.length;
  
  // Apply line filters
  let start = startLine ?? 1;
  let end = endLine ?? totalLines;
  
  // Validate and adjust line numbers
  start = Math.max(1, Math.min(start, totalLines));
  end = Math.max(start, Math.min(end, totalLines));
  
  // Extract lines (convert to 0-based index)
  const selectedLines = lines.slice(start - 1, end);
  const isPartial = start > 1 || end < totalLines;
  
  let output = `✅ **DOCX extracted successfully**\n\n`;
  output += `📄 **File**: ${displayPath}\n`;
  output += `📝 **Total lines**: ${totalLines}\n`;
  if (isPartial) {
    output += `📑 **Showing**: lines ${start}-${end} of ${totalLines}\n`;
  }
  output += `💾 **Size**: ${(fileSize / 1024).toFixed(1)}KB\n`;
  
  // Show warnings if any
  if (result.messages && result.messages.length > 0) {
    const warnings = result.messages
      .filter((m: any) => m.type === 'warning')
      .map((m: any) => m.message);
    if (warnings.length > 0) {
      output += `\n⚠️ **Warnings**: ${warnings.slice(0, 3).join(', ')}\n`;
    }
  }
  
  // Add content with line numbers
  const contentWithLineNumbers = selectedLines.map((line: string, idx: number) => {
    const lineNum = String(start + idx).padStart(6, ' ');
    return `${lineNum}|${line}`;
  }).join('\n');
  
  output += `\n---\n**Content:**\n\`\`\`\n${contentWithLineNumbers}\n\`\`\``;
  
  // Add continuation hint if partial
  if (end < totalLines) {
    output += `\n\n[... ${totalLines - end} more lines. Use start_line=${end + 1} to continue reading.]`;
  }
  
  return { success: true, output };
}
