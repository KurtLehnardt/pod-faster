/**
 * Spotify subscription sync engine.
 *
 * Performs diff-based synchronization between the user's Spotify saved shows
 * and the local spotify_subscriptions table. Uses the admin client for all
 * DB writes (bypasses RLS).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllSavedShows } from "./client";
import { getValidAccessToken } from "./tokens";
import { discoverRssFeedUrl } from "@/lib/rss/discover";
import type {
  SpotifyShow,
  SpotifySubscription,
  SyncResult,
} from "@/types/spotify";

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Synchronize the user's Spotify saved shows with the database.
 *
 * 1. Fetch a valid access token (throws if Spotify not connected).
 * 2. Fetch all saved shows from the Spotify API.
 * 3. Load existing spotify_subscriptions rows (including soft-removed).
 * 4. Diff: insert new, update existing metadata, soft-remove missing.
 * 5. Return counts: { added, removed, unchanged, total }.
 *
 * `summarization_enabled` is never overwritten during sync — it is a
 * user-controlled preference.
 */
export async function syncSubscriptions(userId: string): Promise<SyncResult> {
  // 1. Get a valid access token
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("Spotify not connected");
  }

  // 2. Fetch all shows from Spotify
  const spotifyShows = await fetchAllSavedShows(accessToken);

  // 3. Load all existing subscriptions for this user (including removed)
  const supabase = createAdminClient();
  const { data: existingRows, error: fetchError } = await supabase
    .from("spotify_subscriptions")
    .select("*")
    .eq("user_id", userId);

  if (fetchError) {
    throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
  }

  // 4. Build lookup structures
  const existingByShowId = new Map<string, SpotifySubscription>();
  for (const row of (existingRows ?? []) as SpotifySubscription[]) {
    existingByShowId.set(row.spotify_show_id, row);
  }

  const spotifyShowIds = new Set(spotifyShows.map((s) => s.id));

  // 5. Diff — categorize shows into batches
  let added = 0;
  let unchanged = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  // Separate new shows from existing for batched operations
  interface NewShowRecord {
    user_id: string;
    spotify_show_id: string;
    show_name: string;
    publisher: string;
    description: string;
    image_url: string | null;
    spotify_url: string;
    total_episodes: number;
    summarization_enabled: boolean;
    is_removed: boolean;
    synced_at: string;
  }

  interface ExistingShowRecord {
    id: string;
    user_id: string;
    spotify_show_id: string;
    show_name: string;
    publisher: string;
    description: string;
    image_url: string | null;
    spotify_url: string;
    total_episodes: number;
    is_removed: boolean;
    synced_at: string;
  }

  const newShowRecords: NewShowRecord[] = [];
  const existingShowRecords: ExistingShowRecord[] = [];

  for (const show of spotifyShows) {
    const existing = existingByShowId.get(show.id);
    const imageUrl =
      show.images && show.images.length > 0 ? show.images[0].url : null;

    if (existing) {
      // Existing show — update metadata (do NOT touch summarization_enabled)
      existingShowRecords.push({
        id: existing.id,
        user_id: userId,
        spotify_show_id: show.id,
        show_name: show.name,
        publisher: show.publisher,
        description: show.description,
        image_url: imageUrl,
        spotify_url: show.external_urls.spotify,
        total_episodes: show.total_episodes,
        is_removed: false,
        synced_at: now,
      });

      if (existing.is_removed) {
        added++;
      } else {
        unchanged++;
      }
    } else {
      // New show — insert with summarization_enabled default
      newShowRecords.push({
        user_id: userId,
        spotify_show_id: show.id,
        show_name: show.name,
        publisher: show.publisher,
        description: show.description,
        image_url: imageUrl,
        spotify_url: show.external_urls.spotify,
        total_episodes: show.total_episodes,
        summarization_enabled: true,
        is_removed: false,
        synced_at: now,
      });
      added++;
    }
  }

  // 5a. Batch upsert new shows
  if (newShowRecords.length > 0) {
    const { error: insertError } = await supabase
      .from("spotify_subscriptions")
      .upsert(newShowRecords, { onConflict: "user_id,spotify_show_id" });

    if (insertError) {
      errors.push(`Batch insert (${newShowRecords.length} shows): ${insertError.message}`);
    }
  }

  // 5b. Batch upsert existing shows (metadata update, preserves summarization_enabled)
  if (existingShowRecords.length > 0) {
    const { error: updateError } = await supabase
      .from("spotify_subscriptions")
      .upsert(existingShowRecords, { onConflict: "user_id,spotify_show_id" });

    if (updateError) {
      errors.push(`Batch update (${existingShowRecords.length} shows): ${updateError.message}`);
    }
  }

  // 6. Soft-remove subscriptions no longer in Spotify (batched)
  const idsToRemove: string[] = [];
  for (const [showId, existing] of existingByShowId) {
    if (!spotifyShowIds.has(showId) && !existing.is_removed) {
      idsToRemove.push(existing.id);
    }
  }

  const removed = idsToRemove.length;
  if (idsToRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("spotify_subscriptions")
      .update({ is_removed: true, synced_at: now })
      .in("id", idsToRemove);

    if (removeError) {
      errors.push(`Batch remove (${idsToRemove.length} shows): ${removeError.message}`);
    }
  }

  // 7. Create/update podcast_feeds entries for Spotify shows
  await syncSpotifyFeeds(supabase, userId, spotifyShows, idsToRemove, existingByShowId, errors);

  if (errors.length > 0) {
    console.error(
      `Sync completed with ${errors.length} error(s):`,
      errors.join("; ")
    );
  }

  return {
    added,
    removed,
    unchanged,
    total: spotifyShows.length,
  };
}

/**
 * Create or update podcast_feeds entries for Spotify-synced shows.
 * Discovers RSS feed URLs via iTunes Search API and creates feed entries
 * so Spotify podcasts appear alongside imported feeds.
 */
async function syncSpotifyFeeds(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  spotifyShows: SpotifyShow[],
  removedSubscriptionIds: string[],
  existingByShowId: Map<string, SpotifySubscription>,
  errors: string[]
): Promise<void> {
  // Load existing Spotify-sourced feeds for this user
  const { data: existingFeeds } = await supabase
    .from("podcast_feeds")
    .select("id, spotify_show_id, feed_url, is_active")
    .eq("user_id", userId)
    .eq("source", "spotify");

  const feedByShowId = new Map<string, { id: string; feed_url: string; is_active: boolean }>();
  for (const f of existingFeeds ?? []) {
    if (f.spotify_show_id) {
      feedByShowId.set(f.spotify_show_id, f);
    }
  }

  // Create feeds for new Spotify shows (ones that don't have a podcast_feed yet)
  for (const show of spotifyShows) {
    if (feedByShowId.has(show.id)) {
      // Feed already exists — reactivate if it was deactivated
      const existing = feedByShowId.get(show.id)!;
      if (!existing.is_active) {
        await supabase
          .from("podcast_feeds")
          .update({ is_active: true })
          .eq("id", existing.id);
      }
      continue;
    }

    const imageUrl = show.images?.[0]?.url ?? null;

    // Discover RSS feed URL via iTunes
    const rssUrl = await discoverRssFeedUrl(show.name, show.publisher);

    if (rssUrl) {
      // Check if this RSS URL already exists for this user (imported manually)
      const { data: existingRss } = await supabase
        .from("podcast_feeds")
        .select("id")
        .eq("user_id", userId)
        .eq("feed_url", rssUrl)
        .maybeSingle();

      if (existingRss) {
        // RSS feed already exists — link it to this Spotify show
        await supabase
          .from("podcast_feeds")
          .update({ source: "spotify", spotify_show_id: show.id })
          .eq("id", existingRss.id);
        continue;
      }
    }

    // Create new feed entry
    const { error: insertError } = await supabase
      .from("podcast_feeds")
      .insert({
        user_id: userId,
        feed_url: rssUrl ?? show.external_urls.spotify,
        title: show.name,
        description: show.description,
        image_url: imageUrl,
        source: "spotify",
        spotify_show_id: show.id,
        is_active: true,
        poll_error: rssUrl ? null : "RSS feed not found — episodes cannot be polled automatically",
        poll_error_count: rssUrl ? 0 : 1,
      });

    if (insertError) {
      errors.push(`Feed creation for "${show.name}": ${insertError.message}`);
    }
  }

  // Deactivate feeds for removed Spotify subscriptions
  if (removedSubscriptionIds.length > 0) {
    // Get the spotify_show_ids for removed subscriptions
    const removedShowIds: string[] = [];
    for (const [showId, sub] of existingByShowId) {
      if (removedSubscriptionIds.includes(sub.id)) {
        removedShowIds.push(showId);
      }
    }

    if (removedShowIds.length > 0) {
      const { error: deactivateError } = await supabase
        .from("podcast_feeds")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("source", "spotify")
        .in("spotify_show_id", removedShowIds);

      if (deactivateError) {
        errors.push(`Feed deactivation: ${deactivateError.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch subscriptions for a user.
 *
 * By default, soft-removed subscriptions are excluded. Pass
 * `{ includeRemoved: true }` to include them.
 */
export async function getSubscriptions(
  userId: string,
  options?: { includeRemoved?: boolean }
): Promise<SpotifySubscription[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("spotify_subscriptions")
    .select("*")
    .eq("user_id", userId);

  if (!options?.includeRemoved) {
    query = query.eq("is_removed", false);
  }

  query = query.order("show_name", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch subscriptions: ${error.message}`);
  }

  return (data ?? []) as SpotifySubscription[];
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Update the summarization_enabled flag for a single subscription.
 * Scoped to the user to prevent cross-user writes.
 *
 * @returns true if a row was updated, false if no matching row was found.
 */
export async function updateSubscriptionPreference(
  userId: string,
  subscriptionId: string,
  summarizationEnabled: boolean
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("spotify_subscriptions")
    .update({ summarization_enabled: summarizationEnabled })
    .eq("id", subscriptionId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to update preference for ${subscriptionId}: ${error.message}`
    );
  }

  return (data?.length ?? 0) > 0;
}

/**
 * Bulk update summarization_enabled for multiple subscriptions.
 */
export async function bulkUpdatePreferences(
  userId: string,
  updates: { id: string; summarization_enabled: boolean }[]
): Promise<void> {
  for (const update of updates) {
    await updateSubscriptionPreference(
      userId,
      update.id,
      update.summarization_enabled
    );
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Hard-delete all subscriptions for a user.
 * Used when the user disconnects Spotify with `remove_data=true`.
 */
export async function removeAllSubscriptions(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("spotify_subscriptions")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      `Failed to remove subscriptions for user ${userId}: ${error.message}`
    );
  }
}
