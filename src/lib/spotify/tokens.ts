import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "./crypto";
import { refreshAccessToken } from "./client";
import type {
  SpotifyTokens,
  SpotifyTokenResponse,
  SpotifyUserProfile,
  SpotifyConnectionStatus,
} from "@/types/spotify";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Refresh tokens that expire within this window (ms). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Per-user mutex for token refresh.
 * Prevents concurrent refresh requests for the same user — if a refresh
 * is already in-flight, subsequent callers wait for the same promise.
 */
const refreshLocks = new Map<string, Promise<string | null>>();

// ---------------------------------------------------------------------------
// storeTokens
// ---------------------------------------------------------------------------

/**
 * Store tokens after initial OAuth exchange.
 * Encrypts both access and refresh tokens, then upserts into `spotify_tokens`.
 */
export async function storeTokens(
  userId: string,
  tokens: SpotifyTokenResponse,
  spotifyProfile: SpotifyUserProfile
): Promise<void> {
  const supabase = createAdminClient();

  const encryptedAccessToken = encryptToken(tokens.access_token);
  const encryptedRefreshToken = encryptToken(tokens.refresh_token ?? "");
  const expiresAt = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  const { error } = await supabase.from("spotify_tokens").upsert(
    {
      user_id: userId,
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      expires_at: expiresAt,
      spotify_user_id: spotifyProfile.id,
      spotify_display_name: spotifyProfile.display_name,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(`Failed to store Spotify tokens: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// getTokens
// ---------------------------------------------------------------------------

/**
 * Retrieve and decrypt tokens. Returns null if not connected.
 */
export async function getTokens(
  userId: string
): Promise<SpotifyTokens | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("spotify_tokens")
    .select(
      "encrypted_access_token, encrypted_refresh_token, expires_at, spotify_user_id, spotify_display_name"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch Spotify tokens: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    access_token: decryptToken(data.encrypted_access_token),
    refresh_token: decryptToken(data.encrypted_refresh_token),
    expires_at: data.expires_at,
    spotify_user_id: data.spotify_user_id,
    spotify_display_name: data.spotify_display_name,
  };
}

// ---------------------------------------------------------------------------
// getValidAccessToken
// ---------------------------------------------------------------------------

/**
 * Get a valid access token, refreshing if needed.
 * Returns null if the user is not connected or the refresh token has been revoked.
 *
 * Uses a per-user mutex so that concurrent calls for the same user share a
 * single refresh request rather than triggering parallel refreshes.
 */
export async function getValidAccessToken(
  userId: string
): Promise<string | null> {
  const tokens = await getTokens(userId);
  if (!tokens) {
    return null;
  }

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();

  // Token still valid — return as-is
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return tokens.access_token;
  }

  // If a refresh is already in-flight for this user, wait for it
  const existing = refreshLocks.get(userId);
  if (existing) {
    return existing;
  }

  // Token expired or expiring soon — refresh (with mutex)
  const refreshPromise = performTokenRefresh(userId, tokens.refresh_token);
  refreshLocks.set(userId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(userId);
  }
}

/**
 * Internal: performs the actual token refresh and DB update.
 * Callers should use getValidAccessToken which handles the mutex.
 */
async function performTokenRefresh(
  userId: string,
  currentRefreshToken: string
): Promise<string | null> {
  try {
    const refreshed = await refreshAccessToken(currentRefreshToken);

    const supabase = createAdminClient();
    const newExpiresAt = new Date(
      Date.now() + refreshed.expires_in * 1000
    ).toISOString();

    const { error } = await supabase
      .from("spotify_tokens")
      .update({
        encrypted_access_token: encryptToken(refreshed.access_token),
        encrypted_refresh_token: encryptToken(
          refreshed.refresh_token ?? currentRefreshToken
        ),
        expires_at: newExpiresAt,
      })
      .eq("user_id", userId);

    if (error) {
      throw new Error(
        `Failed to update refreshed Spotify tokens: ${error.message}`
      );
    }

    return refreshed.access_token;
  } catch {
    // Refresh failed (e.g. token revoked) — delete the row
    await deleteTokens(userId);
    return null;
  }
}

// ---------------------------------------------------------------------------
// deleteTokens
// ---------------------------------------------------------------------------

/**
 * Delete tokens (user disconnect).
 */
export async function deleteTokens(userId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("spotify_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete Spotify tokens: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// getConnectionStatus
// ---------------------------------------------------------------------------

/**
 * Get connection status for the frontend.
 */
export async function getConnectionStatus(
  userId: string
): Promise<SpotifyConnectionStatus> {
  const supabase = createAdminClient();

  // Fetch token row
  const { data: tokenRow, error: tokenError } = await supabase
    .from("spotify_tokens")
    .select("spotify_user_id, spotify_display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (tokenError) {
    throw new Error(
      `Failed to fetch connection status: ${tokenError.message}`
    );
  }

  if (!tokenRow) {
    return { connected: false };
  }

  // Count active subscriptions
  const { count, error: countError } = await supabase
    .from("spotify_subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_removed", false);

  if (countError) {
    throw new Error(
      `Failed to count subscriptions: ${countError.message}`
    );
  }

  // Get latest synced_at
  const { data: latestSync, error: syncError } = await supabase
    .from("spotify_subscriptions")
    .select("synced_at")
    .eq("user_id", userId)
    .eq("is_removed", false)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (syncError) {
    throw new Error(
      `Failed to fetch latest sync: ${syncError.message}`
    );
  }

  return {
    connected: true,
    spotify_user_id: tokenRow.spotify_user_id,
    spotify_display_name: tokenRow.spotify_display_name,
    last_synced_at: latestSync?.synced_at ?? null,
    subscription_count: count ?? 0,
  };
}
