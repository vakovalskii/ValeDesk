/**
 * ExtractPageContentTool - Extract full content from web pages using Tavily API or fetch fallback
 * Falls back to fetch_html if Tavily API key is not configured
 */

import { tavily } from "@tavily/core";
import type {
  ToolDefinition,
  ToolResult,
  ToolExecutionContext,
} from "./base-tool.js";
import type { WebSearchProvider } from "../../types.js";
import { webCache } from "../web-cache.js";
import { executeFetchHtmlTool } from "./fetch-tool.js";

export interface ExtractPageParams {
  urls: string[];
  explanation: string;
}

export interface PageContent {
  url: string;
  content: string;
  char_count: number;
  success: boolean;
  error?: string;
}

export const ExtractPageContentToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "extract_page",
    description:
      "Extract full content from web pages. Use AFTER search_web to get complete page content from URLs. Returns full page content in readable format. Works with or without API keys (falls back to simple HTTP fetch if no Tavily key).",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Why extract these specific pages",
        },
        urls: {
          type: "array",
          items: {
            type: "string",
          },
          description: "List of URLs to extract full content from (1-5 URLs)",
          minItems: 1,
          maxItems: 5,
        },
      },
      required: ["explanation", "urls"],
    },
  },
};

export class ExtractPageContentTool {
  private tvly: any | null = null;
  private provider: WebSearchProvider;
  private useFallback: boolean = false;

  constructor(apiKey: string | null, provider: WebSearchProvider = "tavily") {
    this.provider = provider;

    // If no API key or dummy key, use fetch fallback
    if (!apiKey || apiKey === "dummy-key") {
      console.log(
        "[ExtractPageContentTool] No API key configured, using fetch fallback",
      );
      this.useFallback = true;
      return;
    }

    // Page extraction is only available with Tavily
    if (provider !== "tavily") {
      console.log(
        "[ExtractPageContentTool] Provider is not Tavily, using fetch fallback",
      );
      this.useFallback = true;
      return;
    }

    this.tvly = tavily({ apiKey });
  }

  async extract(params: ExtractPageParams): Promise<PageContent[]> {
    const { urls } = params;

    console.log(`[ExtractPage] Extracting ${urls.length} URLs`);

    if (urls.length === 0 || urls.length > 5) {
      throw new Error("Must provide 1-5 URLs to extract");
    }

    // Use fallback if no Tavily API
    if (this.useFallback) {
      return this.extractWithFetch(urls);
    }

    // Check cache for each URL
    const cachedResults: PageContent[] = [];
    const urlsToFetch: string[] = [];

    for (const url of urls) {
      const cacheKey = `extract:tavily:${url}`;
      const cached = await webCache.get(cacheKey);
      if (cached && typeof cached === "object" && "content" in cached) {
        console.log(`[ExtractPage] Cache hit for URL: ${url}`);
        cachedResults.push(cached as PageContent);
      } else {
        urlsToFetch.push(url);
      }
    }

    // If all URLs were cached, return early
    if (urlsToFetch.length === 0) {
      return cachedResults;
    }

    // Fetch uncached URLs with Tavily
    try {
      const response = await this.tvly.extract(urlsToFetch);

      const results: PageContent[] = [...cachedResults];

      // Add successful extractions
      response.results?.forEach((result: any) => {
        const pageResult: PageContent = {
          url: result.url,
          content: result.rawContent,
          char_count: result.rawContent.length,
          success: true,
        };
        results.push(pageResult);

        // Cache the result (TTL: 10 minutes)
        const cacheKey = `extract:tavily:${result.url}`;
        webCache.set(cacheKey, pageResult, 10 * 60 * 1000);
      });

      // Add failed extractions
      response.failedResults?.forEach((failed: any) => {
        const pageResult: PageContent = {
          url: failed.url,
          content: "",
          char_count: 0,
          success: false,
          error: failed.error,
        };
        results.push(pageResult);

        // Cache failures too (shorter TTL: 1 minute)
        const cacheKey = `extract:tavily:${failed.url}`;
        webCache.set(cacheKey, pageResult, 1 * 60 * 1000);
      });

      console.log(
        `[ExtractPage] Extracted ${results.filter((r) => r.success).length}/${urls.length} pages (${cachedResults.length} from cache)`,
      );
      return results;
    } catch (error) {
      console.error(
        "[ExtractPage] Tavily error, falling back to fetch:",
        error,
      );
      return this.extractWithFetch(urls);
    }
  }

  /**
   * Fallback extraction using simple HTTP fetch
   */
  private async extractWithFetch(urls: string[]): Promise<PageContent[]> {
    const results: PageContent[] = [];

    for (const url of urls) {
      try {
        const result = await executeFetchHtmlTool(
          { url, extract_text: true, max_length: 50000 },
          {
            cwd: "",
            isPathSafe: () => false,
          },
        );

        if (result.success && result.output) {
          const data = JSON.parse(result.output);
          results.push({
            url,
            content: data.content,
            char_count: data.length,
            success: true,
          });
        } else {
          results.push({
            url,
            content: "",
            char_count: 0,
            success: false,
            error: result.output,
          });
        }
      } catch (error: any) {
        results.push({
          url,
          content: "",
          char_count: 0,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  formatResults(results: PageContent[], contentLimit: number = 5000): string {
    let formatted = "Extracted Page Content\n\n";
    formatted +=
      "IMPORTANT: When using information from these pages, ALWAYS cite the source with [Source X] and include the URL.\n\n";

    results.forEach((result, index) => {
      const sourceNum = index + 1;
      formatted += `[Source ${sourceNum}] ${result.url}\n`;

      if (result.success) {
        const preview = result.content.substring(0, contentLimit);
        formatted += `Content (${result.char_count} characters total):\n\n`;
        formatted += `${preview}`;
        if (result.content.length > contentLimit) {
          formatted += `\n\n...[Content truncated. Showing first ${contentLimit} of ${result.char_count} characters]...`;
        }
        formatted += "\n\n";
      } else {
        formatted += `Extraction Failed: ${result.error || "Unknown error"}\n\n`;
      }

      formatted += "---\n\n";
    });

    formatted += "Instructions:\n";
    formatted += "- Cite sources as [Source 1], [Source 2], etc.\n";
    formatted += "- Include URLs as clickable links: [text](url)\n";
    formatted += "- Always provide source attribution for facts and data\n";

    return formatted;
  }
}
