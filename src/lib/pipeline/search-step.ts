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
 * Split a multi-topic query into individual topic queries.
 * Handles comma-separated, "and"-separated, and newline-separated topics.
 */
function splitTopics(topicQuery: string): string[] {
  // Split on commas, " and ", newlines
  const parts = topicQuery
    .split(/,|\band\b|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If splitting produced nothing useful, return the original
  if (parts.length === 0) return [topicQuery.trim()];
  return parts;
}

/**
 * Search for news articles matching the topic query.
 *
 * If the query contains multiple topics (comma or "and" separated),
 * each topic gets its own search to ensure balanced coverage across
 * all requested subjects.
 */
export async function searchStep(topicQuery: string): Promise<SearchStepResult> {
  if (!topicQuery.trim()) {
    throw new Error("Topic query cannot be empty");
  }

  const topics = splitTopics(topicQuery);

  // Build queries: each topic gets its own search + a "latest news" variant
  const queries: string[] = [];
  for (const topic of topics) {
    queries.push(topic);
    queries.push(`${topic} latest news`);
  }

  // Scale maxResults per topic so each gets fair coverage
  const perTopicMax = Math.max(3, Math.ceil(10 / topics.length));

  const sources = await gatherNews({
    queries,
    maxResults: perTopicMax,
    maxTotal: Math.max(15, topics.length * 5),
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
