/**
 * Web Request Cache Service
 * Shares web search and page read results between threads in the same session
 */

export interface CachedSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
  timestamp: number;
  provider: string;
}

export interface CachedPageResult {
  url: string;
  content: string;
  timestamp: number;
}

class WebCache {
  // Cache for search queries
  private searchCache = new Map<string, CachedSearchResult>();

  // Cache for page reads
  private pageCache = new Map<string, CachedPageResult>();

  // Cache TTL: 5 minutes for searches, 30 minutes for pages
  private readonly SEARCH_TTL = 5 * 60 * 1000;
  private readonly PAGE_TTL = 30 * 60 * 1000;

  /**
   * Get or fetch search results with caching
   */
  async getSearch(
    query: string,
    provider: string,
    fetchFn: () => Promise<Array<{ title: string; url: string; snippet?: string }>>
  ): Promise<Array<{ title: string; url: string; snippet?: string }>> {
    const key = this.getSearchKey(query, provider);

    // Check cache
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.SEARCH_TTL) {
      console.log(`[WebCache] HIT for search: ${query}`);
      return cached.results;
    }

    // Cache miss - fetch
    console.log(`[WebCache] MISS for search: ${query}`);
    const results = await fetchFn();

    // Cache the result
    this.searchCache.set(key, {
      query,
      results,
      timestamp: Date.now(),
      provider
    });

    return results;
  }

  /**
   * Get or fetch page content with caching
   */
  async getPage(
    url: string,
    fetchFn: () => Promise<string>
  ): Promise<string> {
    // Check cache
    const cached = this.pageCache.get(url);
    if (cached && Date.now() - cached.timestamp < this.PAGE_TTL) {
      console.log(`[WebCache] HIT for page: ${url}`);
      return cached.content;
    }

    // Cache miss - fetch
    console.log(`[WebCache] MISS for page: ${url}`);
    const content = await fetchFn();

    // Cache the result
    this.pageCache.set(url, {
      url,
      content,
      timestamp: Date.now()
    });

    return content;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.searchCache.clear();
    this.pageCache.clear();
    console.log('[WebCache] Cache cleared');
  }

  /**
   * Clear expired cache entries
   */
  clearExpired(): void {
    const now = Date.now();
    let clearedSearch = 0;
    let clearedPages = 0;

    for (const [key, value] of this.searchCache.entries()) {
      if (now - value.timestamp >= this.SEARCH_TTL) {
        this.searchCache.delete(key);
        clearedSearch++;
      }
    }

    for (const [key, value] of this.pageCache.entries()) {
      if (now - value.timestamp >= this.PAGE_TTL) {
        this.pageCache.delete(key);
        clearedPages++;
      }
    }

    if (clearedSearch > 0 || clearedPages > 0) {
      console.log(`[WebCache] Cleared ${clearedSearch} expired searches, ${clearedPages} expired pages`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    searchCacheSize: number;
    pageCacheSize: number;
    searchCacheKeys: string[];
    pageCacheKeys: string[];
  } {
    return {
      searchCacheSize: this.searchCache.size,
      pageCacheSize: this.pageCache.size,
      searchCacheKeys: Array.from(this.searchCache.keys()),
      pageCacheKeys: Array.from(this.pageCache.keys())
    };
  }

  /**
   * Generate cache key for search query
   */
  private getSearchKey(query: string, provider: string): string {
    return `search:${provider}:${query}`;
  }

  /**
   * Generic get method for backward compatibility
   */
  async get(key: string): Promise<any> {
    if (key.startsWith('search:')) {
      const cached = this.searchCache.get(key);
      if (cached && Date.now() - cached.timestamp < this.SEARCH_TTL) {
        return cached.results;
      }
      return null;
    } else if (key.startsWith('extract:') || key.startsWith('reader:')) {
      const cached = this.pageCache.get(key);
      if (cached && Date.now() - cached.timestamp < this.PAGE_TTL) {
        return cached.content || cached;
      }
      return null;
    }
    return null;
  }

  /**
   * Generic set method for backward compatibility
   */
  set(key: string, value: any, ttl?: number): void {
    if (key.startsWith('search:')) {
      const [_, provider, ...queryParts] = key.split(':');
      const query = queryParts.join(':');
      this.searchCache.set(key, {
        query,
        results: value,
        timestamp: Date.now(),
        provider
      });
    } else if (key.startsWith('extract:') || key.startsWith('reader:')) {
      const pageValue = typeof value === 'object' && 'content' in value ? value : { url: key, content: value };
      this.pageCache.set(key, {
        ...pageValue,
        timestamp: Date.now()
      });
    }
  }
}

// Export singleton instance
export const webCache = new WebCache();
