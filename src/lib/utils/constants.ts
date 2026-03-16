/**
 * Shared application constants.
 */

/** Maximum number of podcast feeds a single user may own. */
export const MAX_FEEDS_PER_USER = parseInt(
  process.env.MAX_FEEDS_PER_USER ?? "50",
  10
);
