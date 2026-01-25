/**
 * Fetch Tools - Simple HTTP client for web requests
 *
 * Tools:
 * - fetch: Versatile HTTP requests (raw, text extraction, HTML)
 * - fetch_json: Fetch and parse JSON
 * - download: Download files
 *
 * No API keys required - uses native fetch/axios
 */

import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Tool Definitions
// ============================================================================

export const FetchToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_html",
    description: `Fetch content from any URL. Default tool for reading web pages, APIs, or any HTTP resource.

**CRITICAL: Have a URL? → Use THIS tool (not browser_navigate, not search)**

**USE THIS FOR:**
- ✓ GitHub pages, documentation, articles
- ✓ API endpoints
- ✓ Any URL you already have
- ✓ Static web pages

**DON'T use for:**
- Finding URLs (use 'search' first, then fetch results)
- Sites requiring JavaScript/login (use browser_navigate)
- Local files (use read_file)

**Parameters:**
- url: The URL to fetch (required)
- method: HTTP method (GET or POST, default: GET)
- extract_text: Extract readable text from HTML (default: true for HTML content)
- max_length: Maximum content length (default: 50000)
- headers: Custom HTTP headers (optional)
- body: Request body for POST (optional)

**Returns:**
With extract_text=true (default for HTML):
- title: Page title (for HTML)
- content: Clean text without HTML tags
- url: The fetched URL
- truncated: Whether content was truncated

With extract_text=false:
- status: HTTP status code
- headers: Response headers
- body: Raw response body`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method (default: GET)",
        },
        extract_text: {
          type: "boolean",
          description:
            "Extract text from HTML, removing tags (default: true for HTML)",
        },
        max_length: {
          type: "number",
          description: "Maximum content length in characters (default: 50000)",
        },
        headers: {
          type: "object",
          description: "Custom HTTP headers (optional)",
        },
        body: {
          type: "string",
          description: "Request body for POST requests (optional)",
        },
      },
      required: ["url"],
    },
  },
};

export const FetchJsonToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_json",
    description: `Fetch and parse JSON from a URL.

**Use this for:**
- REST APIs
- JSON endpoints
- Structured data retrieval

**Parameters:**
- url: The URL to fetch (required)
- method: HTTP method (GET or POST, default: GET)
- headers: Custom HTTP headers (optional)
- body: Request body for POST (optional, will be JSON stringified)

**Returns:**
- Parsed JSON data`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch JSON from",
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          description: "HTTP method (default: GET)",
        },
        headers: {
          type: "object",
          description: "Custom HTTP headers (optional)",
        },
        body: {
          type: "object",
          description: "Request body for POST (will be JSON stringified)",
        },
      },
      required: ["url"],
    },
  },
};

export const DownloadToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "download_file",
    description: `Download files from URLs to the local filesystem.

**Use this for:**
- Downloading PDFs, images, archives
- Saving remote files locally
- Downloading data files

**Parameters:**
- url: The URL to download from (required)
- destination: Local file path to save to (required)

**Returns:**
- path: Saved file path
- size: File size in bytes
- success: Whether download succeeded`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to download from",
        },
        destination: {
          type: "string",
          description: "Local file path to save to",
        },
      },
      required: ["url", "destination"],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract text content from HTML
 */
function extractTextFromHtml(html: string): string {
  // Remove script and style tags
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    "",
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }
  return null;
}

// ============================================================================
// Tool Executors
// ============================================================================

export async function executeFetchTool(
  args: {
    url: string;
    method?: string;
    extract_text?: boolean;
    max_length?: number;
    headers?: Record<string, string>;
    body?: string;
  },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, method = "GET", headers = {}, body, max_length = 50000 } = args;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        ...headers,
      },
      body: body ? body : undefined,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const responseBody = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");

    // Auto-detect: extract text by default for HTML, return raw for everything else
    const shouldExtractText =
      args.extract_text !== undefined ? args.extract_text : isHtml;

    if (shouldExtractText && isHtml) {
      // HTML text extraction mode
      const title = extractTitle(responseBody);
      const content = extractTextFromHtml(responseBody);

      const result = {
        url,
        title,
        content: content.substring(0, max_length),
        length: content.length,
        truncated: content.length > max_length,
      };

      return {
        success: true,
        output: JSON.stringify(result, null, 2),
      };
    } else {
      // Raw mode: return full HTTP details
      return {
        success: true,
        output: JSON.stringify(
          {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody.substring(0, max_length),
            length: responseBody.length,
            truncated: responseBody.length > max_length,
          },
          null,
          2,
        ),
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to fetch ${url}: ${error.message}`,
    };
  }
}

// Backwards-compatible alias for older imports.
export const executeFetchHtmlTool = executeFetchTool;

export async function executeFetchJsonTool(
  args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, method = "GET", headers = {}, body } = args;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      output: JSON.stringify(data, null, 2),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to fetch JSON from ${url}: ${error.message}`,
    };
  }
}

export async function executeDownloadTool(
  args: { url: string; destination: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, destination } = args;

  if (!context.isPathSafe(destination)) {
    return {
      success: false,
      error: `Access denied: Path is outside the working directory (${context.cwd})`,
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ensure directory exists
    const fullPath = path.resolve(context.cwd, destination);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, buffer);

    return {
      success: true,
      output: `Downloaded to: ${destination}\nSize: ${buffer.length} bytes`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to download ${url}: ${error.message}`,
    };
  }
}

// ============================================================================
// Export All Tool Definitions
// ============================================================================

export const ALL_FETCH_TOOL_DEFINITIONS = [
  FetchToolDefinition,
  FetchJsonToolDefinition,
  DownloadToolDefinition,
];
