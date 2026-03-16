/**
 * RSS feed URL discovery via iTunes Search API.
 *
 * Given a podcast name (and optionally publisher), searches the iTunes
 * podcast directory and returns the RSS feed URL if a good match is found.
 */

interface ITunesResult {
  collectionName: string;
  artistName: string;
  feedUrl?: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesResult[];
}

/**
 * Normalize a string for fuzzy comparison:
 * lowercase, strip punctuation, collapse whitespace.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple similarity check: returns true if the normalized candidate
 * contains all words from the normalized query, or vice versa.
 */
function isSimilar(query: string, candidate: string): boolean {
  const q = normalize(query);
  const c = normalize(candidate);

  if (q === c) return true;

  // Check if all words in the shorter string appear in the longer one
  const qWords = q.split(" ");
  const cWords = c.split(" ");

  const allQInC = qWords.every((w) => c.includes(w));
  const allCInQ = cWords.every((w) => q.includes(w));

  return allQInC || allCInQ;
}

/**
 * Discover the RSS feed URL for a podcast using the iTunes Search API.
 *
 * @param showName - The podcast title from Spotify
 * @param publisher - The publisher name (optional, used for disambiguation)
 * @returns The RSS feed URL, or null if not found
 */
export async function discoverRssFeedUrl(
  showName: string,
  publisher?: string
): Promise<string | null> {
  const searchTerm = encodeURIComponent(showName);
  const url = `https://itunes.apple.com/search?term=${searchTerm}&media=podcast&limit=10`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`iTunes search failed: ${response.status} for "${showName}"`);
      return null;
    }

    const data = (await response.json()) as ITunesSearchResponse;
    if (data.resultCount === 0 || data.results.length === 0) {
      return null;
    }

    // Try exact-ish title match first
    for (const result of data.results) {
      if (!result.feedUrl) continue;
      if (isSimilar(showName, result.collectionName)) {
        return result.feedUrl;
      }
    }

    // If publisher is provided, try matching with publisher as tiebreaker
    if (publisher) {
      for (const result of data.results) {
        if (!result.feedUrl) continue;
        if (isSimilar(publisher, result.artistName)) {
          return result.feedUrl;
        }
      }
    }

    // No good match found
    return null;
  } catch (err) {
    console.warn(
      `RSS discovery failed for "${showName}":`,
      err instanceof Error ? err.message : "Unknown error"
    );
    return null;
  }
}
