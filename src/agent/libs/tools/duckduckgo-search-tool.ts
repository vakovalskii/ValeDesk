/**
 * DuckDuckGo Search Tools - API-free web search via HTML scraping
 *
 * Tools:
 * - search: General web search
 * - search_news: News search
 * - search_images: Image search
 *
 * No API keys required - scrapes DuckDuckGo HTML
 * Includes user-agent rotation and rate limit handling
 */

import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";

// ============================================================================
// Tool Definitions
// ============================================================================

export const SearchToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search",
    description: `Search DuckDuckGo to FIND URLs. ONLY use when you DON'T have a URL yet.

**CRITICAL: Do you see a URL (http://, https://, github.com, etc.)? → STOP! Use 'fetch_html' instead**

**This tool is ONLY for:**
- ✗ NO URL yet → Search to FIND URLs
- ✗ Questions like "what is X?" → Search first
- ✗ Research topics → Search to discover URLs

**Do NOT use for:**
- ✓ User gives a URL → Use 'fetch_html' (NOT search)
- ✓ github.com/... → Use 'fetch_html'
- ✓ Any full URL → Use 'fetch_html'

**What this returns:**
- Only search results (titles + URLs + snippets)
- To read full content → Use 'fetch_html' with returned URLs

**Parameters:**
- query: Search query (required)
- max_results: Max results (default: 10, max: 50)

**Returns:**
- List of results with title, url, snippet, position`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
};

export const SearchNewsToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_news",
    description: `Search for news articles using DuckDuckGo (no API key required).

**Use this for:**
- Current events
- News articles
- Recent developments

**Parameters:**
- query: Search query (required)
- max_results: Maximum number of results (default: 10, max: 50)

**Returns:**
- List of news results with:
  - title: Article title
  - url: Article URL
  - snippet: Article snippet
  - source: News source
  - date: Publication date (if available)`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
};

export const SearchImagesToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "search_images",
    description: `Search for images using DuckDuckGo (no API key required).

**Use this for:**
- Finding images
- Visual research
- Image URLs for download

**Parameters:**
- query: Search query (required)
- max_results: Maximum number of results (default: 10, max: 50)

**Returns:**
- List of image results with:
  - title: Image title
  - url: Page URL where image appears
  - image: Direct image URL
  - thumbnail: Thumbnail URL
  - width: Image width (if available)
  - height: Image height (if available)`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

interface NewsResult extends SearchResult {
  source?: string;
  date?: string;
}

interface ImageResult {
  title: string;
  url: string;
  image: string;
  thumbnail: string;
  width?: number;
  height?: number;
}

/**
 * Extract text content between two patterns
 */
function extractBetween(html: string, start: string, end: string): string {
  const startIndex = html.indexOf(start);
  if (startIndex === -1) return "";

  const endIndex = html.indexOf(end, startIndex + start.length);
  if (endIndex === -1) return "";

  return html.substring(startIndex + start.length, endIndex);
}

/**
 * Clean HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DuckDuckGo "lite" has a simpler HTML structure, often more stable for scraping.
 * Example link: <a rel="nofollow" class="result-link" href="...">Title</a>
 */
function parseLiteSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo lite uses both single and double quotes and may place href before class.
  const patterns = [
    /<a[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g,
    /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g,
  ];

  let position = 1;

  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null && results.length < maxResults) {
      let url = match[1] || "";
      const titleHtml = match[2] || "";

      // DuckDuckGo sometimes returns redirect URLs; keep them as-is.
      // Ensure protocol for schemeless URLs.
      if (url.startsWith("//")) url = "https:" + url;
      if (url && !url.startsWith("http")) url = "https://" + url;

      const title = stripHtml(titleHtml);
      if (!url || !title) continue;

      results.push({
        title,
        url,
        snippet: "",
        position: position++,
      });
    }

    if (results.length > 0) break;
  }

  return results;
}

function detectDuckDuckGoBlock(html: string): string | null {
  const text = stripHtml(html).toLowerCase();
  if (text.includes("captcha") || text.includes("not a robot")) {
    return "DuckDuckGo returned a CAPTCHA/anti-bot page";
  }
  if (text.includes("access denied") || text.includes("forbidden")) {
    return "DuckDuckGo returned an access denied/forbidden page";
  }
  if (text.includes("enable javascript") && text.includes("continue")) {
    return "DuckDuckGo returned a JS/consent interstitial page";
  }
  return null;
}

/**
 * Parse DuckDuckGo search results from HTML
 */
function parseSearchResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Try multiple patterns as DuckDuckGo's HTML structure varies
  const patterns = [
    // Pattern 1: Standard result with class="result"
    /class="result[^"]*"[\s\S]*?<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g,

    // Pattern 2: Links module format
    /class="links_main[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g,

    // Pattern 3: Simple link + text format
    /<a[^>]+href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
  ];

  let position = 1;

  for (const pattern of patterns) {
    let match;
    while (
      (match = pattern.exec(html)) !== null &&
      results.length < maxResults
    ) {
      let url = match[1];
      const titleHtml = match[2];
      const snippetHtml = match[3];

      // Decode URL if it's encoded
      try {
        url = decodeURIComponent(url);
      } catch (e) {
        // If decode fails, use as is
      }

      // Skip ads and DuckDuckGo internal links
      if (!url || url.startsWith("/") || url.includes("duckduckgo.com/y.js")) {
        continue;
      }

      // Ensure URL has protocol
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      results.push({
        title: stripHtml(titleHtml),
        url: url,
        snippet: stripHtml(snippetHtml),
        position: position++,
      });
    }

    // If we got results with this pattern, don't try others
    if (results.length > 0) break;
  }

  return results;
}

/**
 * Parse DuckDuckGo news results from HTML
 */
function parseNewsResults(html: string, maxResults: number): NewsResult[] {
  const results: SearchResult[] = [];

  // Try the same patterns as regular search since news uses similar HTML
  const patterns = [
    // Pattern 1: Standard result with class="result"
    /class="result[^"]*"[\s\S]*?<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g,

    // Pattern 2: Links module format
    /class="links_main[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/g,

    // Pattern 3: Simple link + text format
    /<a[^>]+href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
  ];

  let position = 1;

  for (const pattern of patterns) {
    let match;
    while (
      (match = pattern.exec(html)) !== null &&
      results.length < maxResults
    ) {
      let url = match[1];
      const titleHtml = match[2];
      const snippetHtml = match[3];

      // Decode URL if it's encoded
      try {
        url = decodeURIComponent(url);
      } catch (e) {
        // If decode fails, use as is
      }

      // Skip ads and DuckDuckGo internal links
      if (!url || url.startsWith("/") || url.includes("duckduckgo.com/y.js")) {
        continue;
      }

      // Ensure URL has protocol
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      const result: NewsResult = {
        title: stripHtml(titleHtml),
        url: url,
        snippet: stripHtml(snippetHtml),
        position: position++,
      };

      // Try to extract source and date from snippet
      const sourceMatch = snippetHtml.match(/<span[^>]*>([^<]+)<\/span>/);
      if (sourceMatch) {
        result.source = stripHtml(sourceMatch[1]);
      }

      results.push(result);
    }

    // If we got results with this pattern, don't try others
    if (results.length > 0) break;
  }

  return results;
}

/**
 * Parse DuckDuckGo image results from HTML
 */
function parseImageResults(html: string, maxResults: number): ImageResult[] {
  const results: ImageResult[] = [];

  // Image results are typically in JSON format embedded in the page
  const jsonMatch = html.match(/vqd='([^']+)'/);
  if (!jsonMatch) {
    return results;
  }

  // For simplicity, we'll parse basic image structure from HTML
  // A more robust implementation would make a second request to the image API
  const imagePattern =
    /<a[^>]+class="tile--img[^"]*"[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/g;

  let match;

  while (
    (match = imagePattern.exec(html)) !== null &&
    results.length < maxResults
  ) {
    const url = match[1];
    const thumbnail = match[2];

    results.push({
      title: "",
      url: url,
      image: thumbnail,
      thumbnail: thumbnail,
    });
  }

  return results;
}

// ============================================================================
// Tool Executors
// ============================================================================

export async function executeSearchTool(
  args: { query: string; max_results?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { query, max_results = 10 } = args;
  const limit = Math.min(max_results, 50);

  try {
    // DuckDuckGo HTML endpoints can be blocked or change structure; try multiple.
    const endpoints = [
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    ];

    let lastError: string | null = null;

    for (const searchUrl of endpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": getRandomUserAgent(),
            Accept: "text/html",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            Referer: "https://duckduckgo.com/",
          },
        });

        if (!response.ok) {
          lastError = `Search failed: HTTP ${response.status} (${searchUrl})`;
          continue;
        }

        const html = await response.text();
        const blocked = detectDuckDuckGoBlock(html);
        if (blocked) {
          lastError = `${blocked} (${searchUrl}). If this keeps happening, set a Tavily/Z.AI API key in Settings for reliable web search.`;
          continue;
        }

        // Prefer lite parser for lite endpoint; otherwise use standard parser and fallback to lite parser.
        const results =
          searchUrl.includes("lite.duckduckgo.com")
            ? parseLiteSearchResults(html, limit)
            : (parseSearchResults(html, limit).length > 0
                ? parseSearchResults(html, limit)
                : parseLiteSearchResults(html, limit));

        if (results.length === 0) {
          // Log HTML snippet for debugging (first 500 chars)
          console.log(
            "[DuckDuckGo Search] No results parsed. HTML preview:",
            html.substring(0, 500),
          );
          lastError =
            `No results parsed for: ${query}. DuckDuckGo may be rate-limited or the HTML structure changed. (${searchUrl})`;
          continue;
        }

        const output = `Search results for "${query}":\n\n${results
          .map(
            (r) => `${r.position}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}\n`,
          )
          .join("\n")}`;

        return {
          success: true,
          output,
        };
      } catch (e: any) {
        lastError =
          e?.name === "AbortError"
            ? `Search failed: timeout (${searchUrl})`
            : `Search failed: ${e?.message || String(e)} (${searchUrl})`;
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      success: false,
      error: lastError || "Search failed",
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Search failed: ${error.message}`,
    };
  }
}

export async function executeSearchNewsTool(
  args: { query: string; max_results?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { query, max_results = 10 } = args;
  const limit = Math.min(max_results, 50);

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&iar=news`;

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `News search failed: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const results = parseNewsResults(html, limit);

    if (results.length === 0) {
      // Log HTML snippet for debugging (first 500 chars)
      console.log(
        "[DuckDuckGo News] No results parsed. HTML preview:",
        html.substring(0, 500),
      );
      return {
        success: false,
        error: `No news results found for: ${query}. The search may be rate-limited or DuckDuckGo's HTML structure changed.`,
      };
    }

    const output = `News results for "${query}":\n\n${results
      .map((r) => {
        let result = `${r.position}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`;
        if (r.source) result += `\n   Source: ${r.source}`;
        if (r.date) result += `\n   Date: ${r.date}`;
        return result + "\n";
      })
      .join("\n")}`;

    return {
      success: true,
      output,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `News search failed: ${error.message}`,
    };
  }
}

export async function executeSearchImagesTool(
  args: { query: string; max_results?: number },
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const { query, max_results = 10 } = args;
  const limit = Math.min(max_results, 50);

  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Image search failed: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const results = parseImageResults(html, limit);

    if (results.length === 0) {
      return {
        success: false,
        error: `No image results found for: ${query}`,
      };
    }

    const output = `Image results for "${query}":\n\n${results
      .map((r, i) => `${i + 1}. Image URL: ${r.image}\n   Page: ${r.url}\n`)
      .join("\n")}`;

    return {
      success: true,
      output,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Image search failed: ${error.message}`,
    };
  }
}

// ============================================================================
// Export All Tool Definitions
// ============================================================================

export const ALL_SEARCH_TOOL_DEFINITIONS = [
  SearchToolDefinition,
  SearchNewsToolDefinition,
  SearchImagesToolDefinition,
];
