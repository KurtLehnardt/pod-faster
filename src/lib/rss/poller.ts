/**
 * Feed poller — checks a podcast feed for new episodes since last poll.
 *
 * Uses parseFeed() internally and filters against known GUIDs and/or
 * a lastPolledAt timestamp.
 */

import { parseFeed, type ParsedEpisode } from "./parser";

// ── Public Types ──────────────────────────────────────────────

export interface PollParams {
  feedUrl: string;
  lastPolledAt: Date | null;
  existingGuids: string[];
}

export interface PollResult {
  feed: {
    title: string;
    description: string | null;
    imageUrl: string | null;
  };
  newEpisodes: ParsedEpisode[];
  /** All episodes from the feed (including existing), for metadata backfill. */
  allEpisodes: ParsedEpisode[];
  totalEpisodes: number;
}

// ── pollFeed ─────────────────────────────────────────────────

/**
 * Poll a single feed for new episodes.
 *
 * 1. Fetches and parses the feed.
 * 2. Filters out episodes whose GUIDs are already in `existingGuids`.
 * 3. If `lastPolledAt` is provided, further filters to episodes published
 *    after that date.
 * 4. Returns updated feed metadata alongside the new episodes.
 */
export async function pollFeed(params: PollParams): Promise<PollResult> {
  const { feedUrl, lastPolledAt, existingGuids } = params;

  const parsed = await parseFeed(feedUrl);
  const guidSet = new Set(existingGuids);

  let newEpisodes = parsed.episodes.filter(
    (ep) => !guidSet.has(ep.guid)
  );

  if (lastPolledAt) {
    newEpisodes = newEpisodes.filter((ep) => {
      if (!ep.publishedAt) return true; // Include episodes with unknown date
      return ep.publishedAt.getTime() > lastPolledAt.getTime();
    });
  }

  return {
    feed: {
      title: parsed.title,
      description: parsed.description,
      imageUrl: parsed.imageUrl,
    },
    newEpisodes,
    allEpisodes: parsed.episodes,
    totalEpisodes: parsed.episodes.length,
  };
}
