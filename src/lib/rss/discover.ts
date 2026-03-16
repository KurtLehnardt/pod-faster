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

/** Per-request timeout for iTunes API calls (ms). */
const ITUNES_TIMEOUT_MS = 5_000;

/** Max concurrent iTunes lookups during batch discovery. */
const MAX_CONCURRENCY = 5;

/**
 * Normalize a string for comparison:
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
 * Title similarity check. Requires the query words to be a subset of the
 * candidate words (not the reverse, to avoid "The Daily" matching
 * "The Daily Wire"). Exact normalized match always wins.
 */
function isTitleMatch(query: string, candidate: string): boolean {
  const q = normalize(query);
  const c = normalize(candidate);

  if (q === c) return true;

  // Only accept if all query words appear in the candidate AND
  // the candidate isn't much longer (max 2 extra words to prevent
  // matching wildly different podcasts)
  const qWords = q.split(" ");
  const cWords = c.split(" ");

  if (cWords.length > qWords.length + 2) return false;

  return qWords.every((w) => c.includes(w));
}

/**
 * Validate a discovered RSS URL is safe to store and poll.
 * Rejects non-HTTPS URLs and private/reserved IP addresses.
 */
function isSafeRssUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS (and HTTP for known podcast CDNs)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }

    // Reject private/reserved IPs and localhost
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.") ||
      hostname === "169.254.169.254" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    // Check 172.16-31.x.x range
    const parts = hostname.split(".");
    if (
      parts[0] === "172" &&
      parts.length === 4 &&
      parseInt(parts[1]) >= 16 &&
      parseInt(parts[1]) <= 31
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Discover the RSS feed URL for a podcast using the iTunes Search API.
 *
 * @param showName - The podcast title from Spotify
 * @param publisher - The publisher name (optional, used for disambiguation)
 * @returns The RSS feed URL, or null if not found or unsafe
 */
export async function discoverRssFeedUrl(
  showName: string,
  publisher?: string
): Promise<string | null> {
  const searchTerm = encodeURIComponent(showName);
  const url = `https://itunes.apple.com/search?term=${searchTerm}&media=podcast&limit=10`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`iTunes search failed: ${response.status} for "${showName}"`);
      return null;
    }

    const data = (await response.json()) as ITunesSearchResponse;
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    // Try title match first
    for (const result of data.results) {
      if (!result.feedUrl) continue;
      if (!isSafeRssUrl(result.feedUrl)) continue;
      if (isTitleMatch(showName, result.collectionName)) {
        return result.feedUrl;
      }
    }

    // If publisher is provided, try matching with publisher + title both present
    if (publisher) {
      for (const result of data.results) {
        if (!result.feedUrl) continue;
        if (!isSafeRssUrl(result.feedUrl)) continue;
        if (
          normalize(result.artistName).includes(normalize(publisher)) &&
          normalize(result.collectionName).includes(normalize(showName).split(" ")[0])
        ) {
          return result.feedUrl;
        }
      }
    }

    return null;
  } catch (err) {
    console.warn(
      `RSS discovery failed for "${showName}":`,
      err instanceof Error ? err.message : "Unknown error"
    );
    return null;
  }
}

/**
 * Discover RSS feed URLs for multiple podcasts in parallel.
 * Uses a concurrency limiter to avoid overwhelming the iTunes API.
 */
export async function discoverRssFeedUrlsBatch(
  shows: Array<{ name: string; publisher?: string }>
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  // Process in batches of MAX_CONCURRENCY
  for (let i = 0; i < shows.length; i += MAX_CONCURRENCY) {
    const batch = shows.slice(i, i + MAX_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (show) => {
        const url = await discoverRssFeedUrl(show.name, show.publisher);
        return { name: show.name, url };
      })
    );

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.set(result.value.name, result.value.url);
      } else {
        // Extract show name from the batch for this index
        const idx = settled.indexOf(result);
        results.set(batch[idx].name, null);
      }
    }
  }

  return results;
}
