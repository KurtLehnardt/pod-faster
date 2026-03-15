/**
 * Pipeline Step 1 — SEARCH
 *
 * Uses gatherNews() to find articles for the given topic query.
 * Returns a deduplicated, relevance-sorted list of sources.
 */

import type { SearchResult } from "@/types/search";
import { gatherNews } from "@/lib/search/gatherer";

export interface SearchStepResult {
  sources: SearchResult[];
}

/**
 * Search for news articles matching the topic query.
 *
 * Runs up to 2 search queries (the original + a refined variant) to increase
 * coverage, then deduplicates and returns the top results.
 */
export async function searchStep(topicQuery: string): Promise<SearchStepResult> {
  if (!topicQuery.trim()) {
    throw new Error("Topic query cannot be empty");
  }

  // Build a small set of query variations to improve coverage
  const queries = [
    topicQuery,
    `${topicQuery} latest news`,
  ];

  const sources = await gatherNews({
    queries,
    maxResults: 5,
    maxTotal: 10,
    searchDepth: "basic",
    topic: "news",
  });

  if (sources.length === 0) {
    throw new Error(
      `No search results found for topic: "${topicQuery}". Try a different or broader query.`
    );
  }

  return { sources };
}
