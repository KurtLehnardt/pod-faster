# PLAN.md -- Spotify Web API Integration

## Overview

Add Spotify podcast subscription import so users can connect their Spotify account, auto-import their saved podcast shows, and selectively enable/disable which podcasts receive AI-generated summary episodes.

## Environment Variables Required

Add to `.env.example` and `.env`:

```
SPOTIFY_CLIENT_ID=           # From Spotify Developer Dashboard
SPOTIFY_CLIENT_SECRET=       # From Spotify Developer Dashboard
SPOTIFY_REDIRECT_URI=        # e.g. http://localhost:3000/api/spotify/callback
SPOTIFY_TOKEN_ENCRYPTION_KEY= # 32-byte hex string for AES-256-GCM encryption
```

`SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` do NOT need `NEXT_PUBLIC_` prefix because the OAuth flow is server-initiated (the frontend calls `POST /api/spotify/connect` which returns a redirect URL -- the client never talks to Spotify directly).

---

## Task Breakdown

### Task 1: TypeScript Types and Interfaces

**Scope:** Define all Spotify-related types used across the feature. Foundation for everything else.

**Complexity:** S

**Files to create:**
- `src/types/spotify.ts`

**Dependencies:** None

**Exports:**
```typescript
// Spotify API response types
export interface SpotifyShow {
  id: string;
  name: string;
  publisher: string;
  description: string;
  images: { url: string; height: number; width: number }[];
  external_urls: { spotify: string };
  total_episodes: number;
}

export interface SpotifyShowsResponse {
  href: string;
  items: { added_at: string; show: SpotifyShow }[];
  limit: number;
  next: string | null;
  offset: number;
  total: number;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token: string;
}

export interface SpotifyUserProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  images: { url: string }[];
}

// Internal types
export interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO timestamp
  spotify_user_id: string;
  spotify_display_name: string | null;
}

export interface SpotifySubscription {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export type SpotifyConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      spotify_user_id: string;
      spotify_display_name: string | null;
      last_synced_at: string | null;
      subscription_count: number;
    };

export interface SyncResult {
  added: number;
  removed: number;
  unchanged: number;
  total: number;
}
```

---

### Task 2: Database Migration

**Scope:** Create the `spotify_tokens` and `spotify_subscriptions` tables with RLS policies and indexes.

**Complexity:** M

**Files to create:**
- `supabase/migrations/00005_spotify_integration.sql`

**Files to modify:**
- `src/types/database.types.ts` (add table type definitions)

**Dependencies:** Task 1 (uses type names for reference, but the SQL stands alone)

**Migration SQL:**

```sql
-- =============================================================================
-- Migration: 00005_spotify_integration
-- Description: Add tables for Spotify OAuth tokens and podcast subscriptions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: spotify_tokens
-- Stores encrypted Spotify OAuth tokens per user. One row per user.
-- ---------------------------------------------------------------------------
CREATE TABLE public.spotify_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Tokens stored as encrypted text (AES-256-GCM, encrypted at application layer)
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  -- Expiry tracked as timestamp for server-side refresh logic
  expires_at timestamptz NOT NULL,
  -- Spotify account metadata (not sensitive, stored in plaintext)
  spotify_user_id text NOT NULL,
  spotify_display_name text,
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One Spotify connection per user
  CONSTRAINT spotify_tokens_user_id_unique UNIQUE (user_id)
);

-- RLS
ALTER TABLE public.spotify_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only read their own tokens (though in practice the admin client
-- will handle token operations server-side, this provides defense-in-depth)
CREATE POLICY "Users can read own spotify tokens"
  ON public.spotify_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update/delete (all token ops go through admin client)
CREATE POLICY "Service role manages spotify tokens"
  ON public.spotify_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Table: spotify_subscriptions
-- Stores imported Spotify podcast subscriptions with per-show preferences.
-- ---------------------------------------------------------------------------
CREATE TABLE public.spotify_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spotify_show_id text NOT NULL,
  show_name text NOT NULL,
  publisher text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  image_url text,
  spotify_url text NOT NULL DEFAULT '',
  total_episodes integer NOT NULL DEFAULT 0,
  -- User preference: should this podcast get AI summaries?
  summarization_enabled boolean NOT NULL DEFAULT true,
  -- Soft-delete flag for shows the user unsubscribed from on Spotify
  is_removed boolean NOT NULL DEFAULT false,
  -- When this subscription was last confirmed via Spotify API sync
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate imports of the same show for the same user
  CONSTRAINT spotify_subscriptions_user_show_unique UNIQUE (user_id, spotify_show_id)
);

-- RLS
ALTER TABLE public.spotify_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read, update their own subscriptions
CREATE POLICY "Users can read own spotify subscriptions"
  ON public.spotify_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own spotify subscriptions"
  ON public.spotify_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (needed for sync operations via admin client)
CREATE POLICY "Service role manages spotify subscriptions"
  ON public.spotify_subscriptions FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Fast lookup of subscriptions by user (the most common query)
CREATE INDEX idx_spotify_subscriptions_user_id
  ON public.spotify_subscriptions (user_id);

-- Fast lookup by user + show for deduplication during sync
CREATE INDEX idx_spotify_subscriptions_user_show
  ON public.spotify_subscriptions (user_id, spotify_show_id);

-- Filter active (not removed) subscriptions efficiently
CREATE INDEX idx_spotify_subscriptions_user_active
  ON public.spotify_subscriptions (user_id)
  WHERE is_removed = false;

-- Token lookup by user
CREATE INDEX idx_spotify_tokens_user_id
  ON public.spotify_tokens (user_id);
```

**database.types.ts additions** (add inside `Database.public.Tables`):

```typescript
spotify_tokens: {
  Row: {
    id: string;
    user_id: string;
    encrypted_access_token: string;
    encrypted_refresh_token: string;
    expires_at: string;
    spotify_user_id: string;
    spotify_display_name: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    encrypted_access_token: string;
    encrypted_refresh_token: string;
    expires_at: string;
    spotify_user_id: string;
    spotify_display_name?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    encrypted_access_token?: string;
    encrypted_refresh_token?: string;
    expires_at?: string;
    spotify_user_id?: string;
    spotify_display_name?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "spotify_tokens_user_id_fkey";
      columns: ["user_id"];
      isOneToOne: true;
      referencedRelation: "profiles";
      referencedColumns: ["id"];
    },
  ];
};
spotify_subscriptions: {
  Row: {
    id: string;
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
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    spotify_show_id: string;
    show_name: string;
    publisher?: string;
    description?: string;
    image_url?: string | null;
    spotify_url?: string;
    total_episodes?: number;
    summarization_enabled?: boolean;
    is_removed?: boolean;
    synced_at?: string;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    id?: string;
    user_id?: string;
    spotify_show_id?: string;
    show_name?: string;
    publisher?: string;
    description?: string;
    image_url?: string | null;
    spotify_url?: string;
    total_episodes?: number;
    summarization_enabled?: boolean;
    is_removed?: boolean;
    synced_at?: string;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: "spotify_subscriptions_user_id_fkey";
      columns: ["user_id"];
      isOneToOne: false;
      referencedRelation: "profiles";
      referencedColumns: ["id"];
    },
  ];
};
```

---

### Task 3: Token Encryption Utilities

**Scope:** AES-256-GCM encryption/decryption for Spotify tokens at rest. Uses Node.js `crypto` module. No external dependencies.

**Complexity:** S

**Files to create:**
- `src/lib/spotify/crypto.ts`

**Dependencies:** None

**Exports:**
```typescript
export function encryptToken(plaintext: string): string;
  // Returns: base64 string of "iv:authTag:ciphertext"
  // Uses SPOTIFY_TOKEN_ENCRYPTION_KEY env var

export function decryptToken(encrypted: string): string;
  // Input: the base64 string from encryptToken
  // Returns: original plaintext

export class TokenEncryptionError extends Error {}
```

**Implementation notes:**
- Key from `SPOTIFY_TOKEN_ENCRYPTION_KEY` env var (32-byte hex = 64 hex chars)
- 12-byte random IV per encryption call
- 16-byte auth tag
- Format: `base64(iv):base64(authTag):base64(ciphertext)`
- Throws `TokenEncryptionError` if key is missing or malformed

---

### Task 4: Spotify API Client

**Scope:** HTTP client for Spotify Web API with retry, rate-limit handling, and token refresh. Follows the same pattern as `src/lib/elevenlabs/client.ts`.

**Complexity:** M

**Files to create:**
- `src/lib/spotify/client.ts`

**Dependencies:** Task 3 (for token decryption)

**Exports:**
```typescript
export class SpotifyApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly detail?: unknown);
}

// Core fetch function with retry/rate-limit handling
export async function spotifyFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
  maxRetries?: number
): Promise<Response>;

// High-level methods
export async function fetchUserProfile(accessToken: string): Promise<SpotifyUserProfile>;

export async function fetchAllSavedShows(accessToken: string): Promise<SpotifyShow[]>;
  // Paginates through all saved shows (limit=50, offset-based)
  // Handles 429 with Retry-After header
  // Returns flat array of all shows

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<SpotifyTokenResponse>;
  // Uses SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET

export async function refreshAccessToken(
  refreshToken: string
): Promise<SpotifyTokenResponse>;

export async function revokeToken(accessToken: string): Promise<void>;
```

**Implementation notes:**
- Base URL: `https://api.spotify.com/v1`
- Token URL: `https://accounts.spotify.com/api/token`
- Retry strategy: exponential backoff with jitter, same as ElevenLabs client
- On 429: respect `Retry-After` header (seconds), then retry
- On 401: do NOT retry here (caller handles token refresh)
- On 5xx: retry up to 3 times with backoff
- `fetchAllSavedShows` paginates with `limit=50`, follows `next` URL or increments `offset` until all shows are fetched

---

### Task 5: Token Storage and Lifecycle Service

**Scope:** Database operations for storing, retrieving, and refreshing Spotify tokens. Thin service layer over Supabase admin client + encryption.

**Complexity:** M

**Files to create:**
- `src/lib/spotify/tokens.ts`

**Dependencies:** Task 2 (database tables), Task 3 (encryption), Task 4 (refresh API call)

**Exports:**
```typescript
// Store tokens after initial OAuth exchange
export async function storeTokens(
  userId: string,
  tokens: SpotifyTokenResponse,
  spotifyProfile: SpotifyUserProfile
): Promise<void>;

// Retrieve and decrypt tokens for a user. Returns null if not connected.
export async function getTokens(userId: string): Promise<SpotifyTokens | null>;

// Get a valid access token, refreshing if expired. Returns null if not connected.
export async function getValidAccessToken(userId: string): Promise<string | null>;
  // Checks expires_at, if within 5 minutes of expiry: refresh
  // On refresh: update DB with new encrypted tokens and new expires_at
  // On refresh failure (e.g. revoked): delete token row, return null

// Delete tokens (user disconnect)
export async function deleteTokens(userId: string): Promise<void>;

// Get connection status (for frontend display)
export async function getConnectionStatus(userId: string): Promise<SpotifyConnectionStatus>;
```

**Implementation notes:**
- All DB operations use `createAdminClient()` to bypass RLS (same pattern as pipeline orchestrator)
- `storeTokens` calculates `expires_at` from `expires_in` (seconds from now)
- `storeTokens` does an upsert on `user_id` (handles re-connect after disconnect)
- `getValidAccessToken` implements the refresh-before-expiry pattern with a 5-minute buffer

---

### Task 6: Sync Engine

**Scope:** The core sync logic that diffs Spotify subscriptions against the local database and performs upserts/soft-deletes.

**Complexity:** M

**Files to create:**
- `src/lib/spotify/sync.ts`

**Dependencies:** Task 4 (Spotify client), Task 5 (token service)

**Exports:**
```typescript
export async function syncSubscriptions(userId: string): Promise<SyncResult>;
  // 1. getValidAccessToken(userId) -- refreshes if needed
  // 2. fetchAllSavedShows(accessToken)
  // 3. Fetch existing spotify_subscriptions for user from DB
  // 4. Diff:
  //    - New shows (in Spotify, not in DB): INSERT with summarization_enabled=true
  //    - Removed shows (in DB, not in Spotify): SET is_removed=true (preserve prefs)
  //    - Existing shows (in both): UPDATE metadata (name, episodes, etc.), SET is_removed=false, preserve summarization_enabled
  // 5. Return counts

export async function getSubscriptions(
  userId: string,
  options?: { includeRemoved?: boolean }
): Promise<SpotifySubscription[]>;

export async function updateSubscriptionPreference(
  userId: string,
  subscriptionId: string,
  summarizationEnabled: boolean
): Promise<void>;

export async function bulkUpdatePreferences(
  userId: string,
  updates: { id: string; summarization_enabled: boolean }[]
): Promise<void>;
```

**Implementation notes:**
- All DB operations via `createAdminClient()` for the sync upserts
- User-facing reads (getSubscriptions) can use server client with RLS
- Sync is idempotent: running twice in a row produces the same result
- `synced_at` timestamp updated on every show touched during sync
- Diff uses a Map keyed by `spotify_show_id` for O(n) comparison

---

### Task 7: OAuth Flow API Routes

**Scope:** The two API routes that handle the Spotify OAuth 2.0 Authorization Code flow with PKCE.

**Complexity:** M

**Files to create:**
- `src/app/api/spotify/connect/route.ts`
- `src/app/api/spotify/callback/route.ts`

**Dependencies:** Task 4 (client for token exchange), Task 5 (token storage), Task 6 (initial sync trigger)

**Route: POST /api/spotify/connect**

```
Request: (no body needed, user auth from session)
Response: { url: string }  -- the Spotify authorization URL to redirect to
```

Implementation:
1. Authenticate user via `supabase.auth.getUser()`
2. Generate PKCE `code_verifier` (128 random bytes, base64url) and `code_challenge` (SHA-256 of verifier, base64url)
3. Generate `state` parameter (32 random bytes, base64url) for CSRF protection
4. Store `code_verifier` and `state` in an HTTP-only cookie (encrypted, short-lived: 10 minutes)
5. Build Spotify authorization URL:
   - `https://accounts.spotify.com/authorize`
   - `response_type=code`
   - `client_id=SPOTIFY_CLIENT_ID`
   - `scope=user-library-read`
   - `redirect_uri=SPOTIFY_REDIRECT_URI`
   - `code_challenge_method=S256`
   - `code_challenge=<code_challenge>`
   - `state=<state>`
6. Return `{ url }` -- frontend does `window.location.href = url`

**Route: GET /api/spotify/callback**

```
Query params: code, state
Response: Redirect to /settings?spotify=connected (or ?spotify=error)
```

Implementation:
1. Read `code` and `state` from query params
2. Read `code_verifier` and expected `state` from cookie
3. Verify `state` matches (CSRF protection) -- if not, redirect with error
4. Exchange `code` + `code_verifier` for tokens via `exchangeCodeForTokens()`
5. Fetch Spotify user profile via `fetchUserProfile(accessToken)`
6. Store tokens via `storeTokens(userId, tokens, profile)`
7. Clear the PKCE/state cookie
8. Trigger initial sync: `syncSubscriptions(userId)` (fire-and-forget, don't block redirect)
9. Redirect to `/settings?spotify=connected`

**PKCE cookie format:**
- Cookie name: `spotify_oauth`
- Value: JSON `{ codeVerifier, state }` -- encrypted with the same AES key or signed
- `httpOnly: true`, `secure: true` (in production), `sameSite: 'lax'`, `maxAge: 600` (10 min), `path: '/api/spotify/callback'`

---

### Task 8: Spotify Data API Routes

**Scope:** The CRUD API routes for managing Spotify connection and subscriptions.

**Complexity:** M

**Files to create:**
- `src/app/api/spotify/sync/route.ts`
- `src/app/api/spotify/subscriptions/route.ts`
- `src/app/api/spotify/subscriptions/[id]/route.ts`
- `src/app/api/spotify/subscriptions/bulk/route.ts`
- `src/app/api/spotify/disconnect/route.ts`
- `src/app/api/spotify/status/route.ts`

**Dependencies:** Task 5 (tokens), Task 6 (sync engine)

**Route: POST /api/spotify/sync**
```
Request: (no body, auth from session)
Response: { result: SyncResult }
Status: 200 on success, 401 if not authenticated, 404 if Spotify not connected
```

**Route: GET /api/spotify/subscriptions**
```
Request: query params: ?include_removed=true (optional)
Response: { subscriptions: SpotifySubscription[] }
Status: 200
```

**Route: PATCH /api/spotify/subscriptions/[id]**
```
Request: { summarization_enabled: boolean }
Response: { updated: true }
Status: 200 on success, 400 on bad body, 404 if subscription not found
```

**Route: PATCH /api/spotify/subscriptions/bulk**
```
Request: { updates: { id: string, summarization_enabled: boolean }[] }
Response: { updated: number }
Status: 200
```

**Route: DELETE /api/spotify/disconnect**
```
Request: query param: ?remove_data=true (optional, default false)
Response: { disconnected: true }
Status: 200
```
Implementation:
1. Revoke Spotify token via `revokeToken()`
2. Delete token row via `deleteTokens(userId)`
3. If `remove_data=true`: delete all `spotify_subscriptions` for user
4. If `remove_data=false`: subscriptions remain (orphaned but harmless)

**Route: GET /api/spotify/status**
```
Request: (auth from session)
Response: SpotifyConnectionStatus
Status: 200
```

All routes follow the existing pattern:
1. `const supabase = await createClient()`
2. `const { data: { user } } = await supabase.auth.getUser()`
3. `if (!user) return 401`
4. Inline type guard validation for request bodies
5. `{ error: string }` response format on errors

---

### Task 9: Frontend Hook -- useSpotify

**Scope:** Custom React hook for Spotify data fetching and mutations. Follows the `useChat` pattern.

**Complexity:** M

**Files to create:**
- `src/lib/hooks/use-spotify.ts`

**Dependencies:** Task 8 (API routes)

**Exports:**
```typescript
export interface UseSpotifyReturn {
  // Connection
  status: SpotifyConnectionStatus | null;
  isLoadingStatus: boolean;
  connect: () => Promise<void>;        // calls POST /api/spotify/connect, redirects
  disconnect: (removeData?: boolean) => Promise<void>;

  // Subscriptions
  subscriptions: SpotifySubscription[];
  isLoadingSubscriptions: boolean;

  // Sync
  isSyncing: boolean;
  syncError: string | null;
  sync: () => Promise<void>;

  // Preferences
  toggleSubscription: (id: string, enabled: boolean) => Promise<void>;
  setAllEnabled: (enabled: boolean) => Promise<void>;
}

export function useSpotify(): UseSpotifyReturn;
```

**Implementation notes:**
- On mount: fetch `/api/spotify/status` to get connection status
- If connected: fetch `/api/spotify/subscriptions`
- `connect()` calls the API, gets URL, does `window.location.href = url`
- `sync()` calls `POST /api/spotify/sync`, then refetches subscriptions
- `toggleSubscription()` calls `PATCH /api/spotify/subscriptions/:id` and optimistically updates local state
- `setAllEnabled()` calls `PATCH /api/spotify/subscriptions/bulk`

---

### Task 10: Frontend Components -- Spotify Settings Section

**Scope:** UI components for the Spotify integration displayed on the Settings page.

**Complexity:** L

**Files to create:**
- `src/components/spotify/spotify-connect-card.tsx`
- `src/components/spotify/spotify-subscription-list.tsx`
- `src/components/spotify/spotify-subscription-item.tsx`
- `src/components/spotify/spotify-disconnect-dialog.tsx`

**Files to modify:**
- `src/app/(app)/settings/page.tsx` (add Spotify section below existing preferences)

**Dependencies:** Task 9 (hook)

**Component: SpotifyConnectCard**
- Displays when Spotify is NOT connected
- "Connect Spotify" button (green, with Spotify logo from lucide `Music` icon)
- Brief description of what connecting does
- Uses `useSpotify().connect()`

**Component: SpotifySubscriptionList**
- Displays when Spotify IS connected
- Header: "Spotify Podcasts" with sync button and connected indicator
- "Select All" / "Deselect All" buttons
- Scrollable list of `SpotifySubscriptionItem`
- Loading skeleton state during sync
- Empty state if no subscriptions

**Component: SpotifySubscriptionItem**
- Show image (or placeholder), show name, publisher
- `Switch` toggle for `summarization_enabled`
- Episode count badge
- Link to Spotify

**Component: SpotifyDisconnectDialog**
- Confirmation dialog using existing `Dialog` component
- Option: "Also remove imported podcast data" checkbox
- "Disconnect" (destructive) and "Cancel" buttons

**Settings page modification:**
- Add a `Separator` after `PreferencesForm`
- Add heading "Connected Services"
- Conditionally render `SpotifyConnectCard` or connected state with `SpotifySubscriptionList`

---

### Task 11: Tests -- Crypto and Client

**Scope:** Unit tests for the encryption module and Spotify API client.

**Complexity:** M

**Files to create:**
- `src/lib/spotify/__tests__/crypto.test.ts`
- `src/lib/spotify/__tests__/client.test.ts`

**Dependencies:** Task 3, Task 4

**crypto.test.ts coverage:**
- Encrypt then decrypt roundtrip produces original value
- Decrypt with wrong key throws
- Decrypt with tampered ciphertext throws
- Missing env var throws `TokenEncryptionError`
- Different encryptions of the same value produce different ciphertexts (random IV)
- Empty string encryption/decryption works

**client.test.ts coverage (follows ElevenLabs client test pattern):**
- `spotifyFetch` sends Bearer token header
- Retries on 429 with `Retry-After` header respect
- Throws `SpotifyApiError` on non-retryable errors (403, 404)
- Retries on 5xx up to max retries
- `fetchAllSavedShows` paginates correctly (mock 2 pages of results)
- `exchangeCodeForTokens` sends correct body format
- `refreshAccessToken` sends correct body format

---

### Task 12: Tests -- Token Service and Sync Engine

**Scope:** Unit tests for the token lifecycle and sync diffing logic.

**Complexity:** M

**Files to create:**
- `src/lib/spotify/__tests__/tokens.test.ts`
- `src/lib/spotify/__tests__/sync.test.ts`

**Dependencies:** Task 5, Task 6

**tokens.test.ts coverage:**
- `storeTokens` encrypts and upserts to DB
- `getTokens` decrypts and returns correct shape
- `getTokens` returns null when no row exists
- `getValidAccessToken` returns existing token when not expired
- `getValidAccessToken` refreshes when within 5-minute buffer
- `getValidAccessToken` deletes row and returns null on refresh failure
- `deleteTokens` removes the row

**sync.test.ts coverage:**
- New shows from Spotify are inserted
- Shows no longer in Spotify are soft-removed (`is_removed = true`)
- Previously removed shows that reappear are un-removed
- `summarization_enabled` is preserved across syncs
- Show metadata (name, episode count) is updated on sync
- Empty Spotify library results in all existing shows being soft-removed
- Sync with no existing subscriptions inserts all
- `getSubscriptions` filters out removed by default
- `updateSubscriptionPreference` updates the correct row
- `bulkUpdatePreferences` handles multiple updates

---

### Task 13: Tests -- API Route Integration Tests

**Scope:** Integration tests for the Spotify API routes, following the existing `api-validation.test.ts` pattern.

**Complexity:** M

**Files to create:**
- `src/__tests__/journeys/spotify-api.test.ts`

**Dependencies:** Task 7, Task 8

**Test coverage:**
- `POST /api/spotify/connect` -- returns 401 when not auth'd, returns URL with correct params when auth'd
- `GET /api/spotify/callback` -- returns redirect on success, returns error redirect on state mismatch, returns error redirect on missing code
- `POST /api/spotify/sync` -- returns 401 when not auth'd, returns 404 when not connected, returns sync result when connected
- `GET /api/spotify/subscriptions` -- returns 401 when not auth'd, returns subscription list
- `PATCH /api/spotify/subscriptions/:id` -- validates body, returns 404 for non-existent, updates correctly
- `PATCH /api/spotify/subscriptions/bulk` -- validates body, updates multiple
- `DELETE /api/spotify/disconnect` -- returns 401 when not auth'd, disconnects and optionally removes data
- `GET /api/spotify/status` -- returns correct status for connected and disconnected states

---

### Task 14: Update .env.example

**Scope:** Add the new environment variables to `.env.example`.

**Complexity:** S

**Files to modify:**
- `.env.example`

**Dependencies:** None (can run in parallel with anything)

**Changes:**
```
# Spotify Integration
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/spotify/callback
SPOTIFY_TOKEN_ENCRYPTION_KEY=
```

---

## Execution Order

### Wave 1 (Parallel -- no dependencies)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T1   | TypeScript types | S | `src/types/spotify.ts` |
| T14  | .env.example update | S | `.env.example` |

### Wave 2 (Depends on T1)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T2   | Database migration + types update | M | `supabase/migrations/`, `src/types/database.types.ts` |
| T3   | Token encryption utilities | S | `src/lib/spotify/crypto.ts` |

### Wave 3 (Depends on T2, T3)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T4   | Spotify API client | M | `src/lib/spotify/client.ts` |
| T11  | Tests: crypto + client | M | `src/lib/spotify/__tests__/crypto.test.ts`, `client.test.ts` |

### Wave 4 (Depends on T4)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T5   | Token storage/lifecycle service | M | `src/lib/spotify/tokens.ts` |

### Wave 5 (Depends on T5)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T6   | Sync engine | M | `src/lib/spotify/sync.ts` |
| T12  | Tests: tokens + sync | M | `src/lib/spotify/__tests__/tokens.test.ts`, `sync.test.ts` |

### Wave 6 (Depends on T6)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T7   | OAuth flow API routes | M | `src/app/api/spotify/connect/route.ts`, `callback/route.ts` |
| T8   | Data API routes | M | `src/app/api/spotify/sync/route.ts`, etc. |

### Wave 7 (Depends on T7, T8)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T9   | Frontend hook | M | `src/lib/hooks/use-spotify.ts` |
| T13  | Tests: API routes | M | `src/__tests__/journeys/spotify-api.test.ts` |

### Wave 8 (Depends on T9)
| Task | Description | Complexity | Files |
|------|-------------|------------|-------|
| T10  | Frontend components + settings page integration | L | `src/components/spotify/`, `src/app/(app)/settings/page.tsx` |

---

## File Inventory

### New Files (18)
```
src/types/spotify.ts
supabase/migrations/00005_spotify_integration.sql
src/lib/spotify/crypto.ts
src/lib/spotify/client.ts
src/lib/spotify/tokens.ts
src/lib/spotify/sync.ts
src/app/api/spotify/connect/route.ts
src/app/api/spotify/callback/route.ts
src/app/api/spotify/sync/route.ts
src/app/api/spotify/subscriptions/route.ts
src/app/api/spotify/subscriptions/[id]/route.ts
src/app/api/spotify/subscriptions/bulk/route.ts
src/app/api/spotify/disconnect/route.ts
src/app/api/spotify/status/route.ts
src/components/spotify/spotify-connect-card.tsx
src/components/spotify/spotify-subscription-list.tsx
src/components/spotify/spotify-subscription-item.tsx
src/components/spotify/spotify-disconnect-dialog.tsx
```

### New Test Files (4)
```
src/lib/spotify/__tests__/crypto.test.ts
src/lib/spotify/__tests__/client.test.ts
src/lib/spotify/__tests__/tokens.test.ts
src/lib/spotify/__tests__/sync.test.ts
src/__tests__/journeys/spotify-api.test.ts
```

### Modified Files (3)
```
.env.example
src/types/database.types.ts
src/app/(app)/settings/page.tsx
```

---

## Security Implementation Details

### Token Encryption at Rest
- Algorithm: AES-256-GCM (authenticated encryption)
- Key: 256-bit from `SPOTIFY_TOKEN_ENCRYPTION_KEY` env var (64 hex chars)
- IV: 12 random bytes per encryption (crypto.randomBytes)
- Auth tag: 16 bytes (GCM default)
- Storage format: `base64(iv):base64(authTag):base64(ciphertext)` in Postgres text column
- Key rotation: not in scope for v1; document the process for future

### PKCE (Proof Key for Code Exchange)
- `code_verifier`: 128 random bytes, base64url-encoded (per RFC 7636)
- `code_challenge`: SHA-256 hash of verifier, base64url-encoded
- `code_challenge_method`: S256
- Verifier stored in HTTP-only cookie, never exposed to client-side JS

### CSRF Protection
- `state` parameter: 32 random bytes, base64url-encoded
- Stored alongside `code_verifier` in the same HTTP-only cookie
- Verified on callback before proceeding with token exchange
- Prevents authorization code injection attacks

### Token Isolation
- Spotify tokens are NEVER returned in API responses to the frontend
- The `/api/spotify/status` endpoint returns only `spotify_user_id` and `spotify_display_name`
- All Spotify API calls happen server-side using the admin Supabase client
- RLS policies on `spotify_tokens` only allow service_role writes

### Rate Limiting (Recommendations)
- The Spotify-related endpoints should be rate-limited at the middleware level
- Recommended limits:
  - `POST /api/spotify/connect`: 5 per minute per user
  - `POST /api/spotify/sync`: 2 per minute per user (syncs are expensive)
  - `PATCH` endpoints: 30 per minute per user
- Implementation: defer to a separate rate-limiting task/middleware (not in scope for this plan, but the routes should be designed to work with one)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Spotify rate limits (429) during large library sync | Exponential backoff with Retry-After header respect; pagination limit=50 reduces calls |
| Token refresh race condition (two requests try to refresh simultaneously) | The token service checks expires_at before refreshing; upsert semantics prevent duplicate rows; last writer wins is acceptable |
| User re-connects after disconnect | `storeTokens` uses upsert on `user_id`; `spotify_subscriptions` uses upsert on `(user_id, spotify_show_id)` |
| Supabase migration conflicts with other active agents | This migration creates new tables only (no ALTER on existing tables); zero conflict risk |
| PKCE cookie lost (user navigates away during OAuth) | Cookie has 10-minute TTL; callback gracefully redirects to settings with error |
| Large Spotify libraries (1000+ shows) | Pagination handles this; sync is O(n) with Map-based diffing |
| `SPOTIFY_TOKEN_ENCRYPTION_KEY` rotation | Not handled in v1; document that re-encryption of existing tokens would be needed |

---

## Architectural Decisions

1. **Server-initiated OAuth flow**: The frontend never sees Spotify credentials. `POST /api/spotify/connect` returns the URL; the frontend just redirects. This keeps the client ID server-side and simplifies PKCE implementation.

2. **Admin client for all token operations**: Spotify tokens are security-sensitive. All reads/writes go through `createAdminClient()` which bypasses RLS. The RLS policies are defense-in-depth only.

3. **Soft-delete for unsubscribed shows**: When a user unsubscribes from a show on Spotify, we set `is_removed = true` rather than deleting. This preserves the `summarization_enabled` preference in case they re-subscribe.

4. **No external crypto dependencies**: Using Node.js built-in `crypto` module for AES-256-GCM. No need for `crypto-js` or similar -- the built-in implementation is audited and performant.

5. **PKCE stored in cookies, not DB**: The OAuth flow state (code_verifier, state) is stored in an HTTP-only cookie rather than the database. This avoids a DB round-trip and automatically expires. The cookie path is scoped to `/api/spotify/callback` so it is only sent on the callback request.

6. **Sync is fire-and-forget on initial connect**: After the OAuth callback stores tokens, the initial sync is triggered but does not block the redirect. The user sees the settings page immediately and the sync completes in the background. The UI polls or refreshes to show results.

7. **No WebSocket/SSE for sync progress**: Given the existing codebase pattern (polling for episode status), sync progress will follow the same pattern. The sync operation is fast enough (typically <5 seconds) that a loading spinner is sufficient.
