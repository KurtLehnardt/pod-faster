import type {
  SpotifyUserProfile,
  SpotifyShow,
  SpotifySavedShowItem,
  SpotifyPaginatedResponse,
  SpotifyTokenResponse,
} from "@/types/spotify";

const BASE_URL = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new SpotifyApiError(`${name} is not set`, 503);
  }
  return value;
}

/**
 * Exponential backoff delay for retries.
 * base * 2^attempt with jitter: 1s, 2s, 4s, ...
 */
function backoffMs(attempt: number, baseMs = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs * 0.5;
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core fetch with retry / rate-limit handling
// ---------------------------------------------------------------------------

/**
 * Make a request to the Spotify Web API with automatic retry on 429 and 5xx.
 *
 * - 429: reads `Retry-After` header (seconds), waits, retries
 * - 5xx: retry with exponential backoff (1s, 2s, 4s ...) up to maxRetries
 * - 401: throws SpotifyApiError (caller handles token refresh)
 * - Other 4xx: throws SpotifyApiError (no retry)
 */
export async function spotifyFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(init.headers as Record<string, string>),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { ...init, headers });

    // Rate limited -- respect Retry-After then retry
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get("Retry-After");
      const delaySeconds = retryAfter ? parseInt(retryAfter, 10) : 1;
      await sleep(delaySeconds * 1000);
      continue;
    }

    // Server error -- retry with exponential backoff
    if (response.status >= 500 && attempt < maxRetries) {
      await sleep(backoffMs(attempt));
      continue;
    }

    // Success
    if (response.ok) {
      return response;
    }

    // Non-retryable error -- parse detail and throw
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    throw new SpotifyApiError(
      `Spotify API error: ${response.status} ${response.statusText} on ${path}`,
      response.status,
      detail
    );
  }

  // Unreachable -- the loop always returns or throws -- but satisfies TypeScript.
  throw new SpotifyApiError("Max retries exceeded", 429);
}

// ---------------------------------------------------------------------------
// High-level methods
// ---------------------------------------------------------------------------

/** Fetch the current user's Spotify profile. */
export async function fetchUserProfile(
  accessToken: string
): Promise<SpotifyUserProfile> {
  const response = await spotifyFetch(accessToken, "/me");
  return response.json() as Promise<SpotifyUserProfile>;
}

/**
 * Fetch all saved shows (podcasts) from the user's library.
 * Handles pagination automatically with a safety limit to prevent
 * infinite loops (max 50 pages / 2500 shows).
 */
export async function fetchAllSavedShows(
  accessToken: string
): Promise<SpotifyShow[]> {
  const shows: SpotifyShow[] = [];
  const limit = 50;
  const maxPages = 50;
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const response = await spotifyFetch(
      accessToken,
      `/me/shows?limit=${limit}&offset=${offset}`
    );
    const data =
      (await response.json()) as SpotifyPaginatedResponse<SpotifySavedShowItem>;

    for (const item of data.items) {
      shows.push(item.show);
    }

    // Check if we've fetched everything
    if (offset + data.items.length >= data.total) {
      break;
    }

    offset += limit;
  }

  return shows;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 * Uses the Authorization Code + PKCE flow with a confidential client.
 *
 * @param redirectUri - Must match the redirect_uri used in the authorization request.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<SpotifyTokenResponse> {
  const clientId = getEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = getEnv("SPOTIFY_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    throw new SpotifyApiError(
      `Token exchange failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }

  return response.json() as Promise<SpotifyTokenResponse>;
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<SpotifyTokenResponse> {
  const clientId = getEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = getEnv("SPOTIFY_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    throw new SpotifyApiError(
      `Token refresh failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }

  return response.json() as Promise<SpotifyTokenResponse>;
}

/**
 * Revoke an access token (no-op).
 *
 * Spotify does not provide a token revocation endpoint (RFC 7009).
 * See: https://github.com/spotify/web-api/issues/600
 *
 * Tokens are invalidated by deleting them from our database.
 * The access token will expire naturally (typically within 1 hour).
 * Users can also manually revoke app access via their Spotify account settings.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function revokeToken(_accessToken: string): Promise<void> {
  // Intentional no-op — Spotify has no revocation API.
}
