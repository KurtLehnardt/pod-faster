import type { SearchResult } from "@/types/search";
import { searchTavily, type TavilySearchParams } from "./tavily";

export interface GatherNewsParams {
  queries: string[];
  maxResults?: number;
  maxTotal?: number;
  searchDepth?: TavilySearchParams["searchDepth"];
  topic?: TavilySearchParams["topic"];
}

/**
 * Normalize a URL to hostname + pathname for deduplication.
 * Strips query params, fragments, trailing slashes, and www prefix.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${hostname}${pathname}`;
  } catch {
    return raw;
  }
}

/**
 * Run multiple search queries in parallel, deduplicate by URL, and return
 * the top results sorted by relevance score.
 */
export async function gatherNews(
  params: GatherNewsParams,
): Promise<SearchResult[]> {
  const {
    queries,
    maxResults = 5,
    maxTotal = 15,
    searchDepth = "basic",
    topic = "news",
  } = params;

  if (queries.length === 0) return [];

  const searches = queries.map((query) =>
    searchTavily({ query, maxResults, searchDepth, topic }),
  );

  const settled = await Promise.allSettled(searches);

  const seen = new Set<string>();
  const results: SearchResult[] = [];

  // Flatten results from all settled promises, skipping failures
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled") continue;
    for (const item of outcome.value) {
      const key = normalizeUrl(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: item.title,
        url: item.url,
        content: item.content,
        score: item.score,
        published_date: item.published_date,
      });
    }
  }

  // Sort by score descending, then take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxTotal);
}
