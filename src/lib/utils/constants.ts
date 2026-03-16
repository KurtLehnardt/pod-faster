/**
 * Shared application constants.
 *
 * All magic numbers that are used across multiple modules should be
 * defined here to avoid drift and make them easy to find/change.
 */

/** Maximum number of podcast feeds a single user may own. */
const parsedMaxFeeds = parseInt(process.env.MAX_FEEDS_PER_USER ?? "50", 10);
export const MAX_FEEDS_PER_USER =
  Number.isFinite(parsedMaxFeeds) && parsedMaxFeeds > 0 ? parsedMaxFeeds : 50;

/** Maximum transcript size in bytes before truncation (500 KB). */
export const MAX_TRANSCRIPT_BYTES = 512_000;

/** Minimum interval between feed polls in milliseconds (15 minutes). */
export const MIN_POLL_INTERVAL_MS = 15 * 60 * 1000;

/** Maximum consecutive poll errors before a feed is deactivated. */
export const MAX_POLL_ERRORS = 5;
