/**
 * Shared application constants.
 *
 * Magic numbers are centralized here so they can be changed in one place.
 */

// ── Feed limits ──────────────────────────────────────────────

/** Maximum number of podcast feeds a single user may own. */
const parsedMaxFeeds = parseInt(process.env.MAX_FEEDS_PER_USER || "50", 10);
export const MAX_FEEDS_PER_USER =
  Number.isFinite(parsedMaxFeeds) && parsedMaxFeeds > 0 ? parsedMaxFeeds : 50;

// ── Transcript limits ────────────────────────────────────────

/** Maximum transcript size in bytes (500 KB). */
export const MAX_TRANSCRIPT_BYTES = 512_000;

// ── Polling limits ───────────────────────────────────────────

/** Minimum interval between feed polls (15 minutes). */
export const MIN_POLL_INTERVAL_MS = 15 * 60 * 1000;

/** Maximum consecutive poll errors before deactivating a feed. */
export const MAX_POLL_ERRORS = 5;
