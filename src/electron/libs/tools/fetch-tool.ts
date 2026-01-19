/**
 * Fetch Tools - Simple HTTP client for web requests
 *
 * Tools:
 * - fetch: GET/POST HTTP requests
 * - fetch_json: Fetch and parse JSON
 * - fetch_html: Fetch HTML content
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
    name: "fetch",
    description: `Make HTTP requests to URLs (GET or POST).

**Use this for:**
- Simple web pages (static HTML)
- API endpoints
- Known URLs that don't require JavaScript

**Don't use for:**
- Interactive sites (use browser tools instead)
- Sites requiring JavaScript rendering
- Local files (use read tool instead)

**Parameters:**
- url: The URL to fetch (required)
- method: HTTP method (GET or POST, default: GET)
- headers: Custom HTTP headers (optional)
- body: Request body for POST (optional)

**Returns:**
- status: HTTP status code
- headers: Response headers
- body: Response body as text`,
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

export const FetchHtmlToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_html",
    description: `Fetch HTML content and extract text.

**Use this for:**
- Web page content extraction
- Documentation pages
- Blog posts and articles
- Static websites

**Don't use for:**
- Sites requiring JavaScript (use browser tools)
- Interactive content

**Parameters:**
- url: The URL to fetch (required)
- extract_text: Extract text only, no HTML tags (default: true)
- max_length: Maximum response length in characters (default: 50000)

**Returns:**
- title: Page title (if found)
- content: HTML or extracted text content
- url: The fetched URL`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch HTML from",
        },
        extract_text: {
          type: "boolean",
          description: "Extract text only without HTML tags (default: true)",
        },
        max_length: {
          type: "number",
          description: "Maximum content length (default: 50000)",
        },
      },
      required: ["url"],
    },
  },
};

export const DownloadToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "download",
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
    headers?: Record<string, string>;
    body?: string;
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
        ...headers,
      },
      body: body ? body : undefined,
    });

    const responseBody = await response.text();

    return {
      success: true,
      output: JSON.stringify(
        {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody.substring(0, 50000), // Limit response size
        },
        null,
        2,
      ),
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Failed to fetch ${url}: ${error.message}`,
    };
  }
}

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
        output: `HTTP ${response.status}: ${response.statusText}`,
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
      output: `Failed to fetch JSON from ${url}: ${error.message}`,
    };
  }
}

export async function executeFetchHtmlTool(
  args: { url: string; extract_text?: boolean; max_length?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, extract_text = true, max_length = 50000 } = args;

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
        output: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();
    const title = extractTitle(html);
    const content = extract_text ? extractTextFromHtml(html) : html;

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
  } catch (error: any) {
    return {
      success: false,
      output: `Failed to fetch HTML from ${url}: ${error.message}`,
    };
  }
}

export async function executeDownloadTool(
  args: { url: string; destination: string },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { url, destination } = args;

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
        output: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ensure directory exists
    const dir = path.dirname(destination);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(destination, buffer);

    return {
      success: true,
      output: `Downloaded to: ${destination}\nSize: ${buffer.length} bytes`,
    };
  } catch (error: any) {
    return {
      success: false,
      output: `Failed to download ${url}: ${error.message}`,
    };
  }
}

// ============================================================================
// Export All Tool Definitions
// ============================================================================

export const ALL_FETCH_TOOL_DEFINITIONS = [
  FetchToolDefinition,
  FetchJsonToolDefinition,
  FetchHtmlToolDefinition,
  DownloadToolDefinition,
];
