import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — each supabase chain method is a shared vi.fn()
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

/** Build a fluent chain where every method returns the same object. */
function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    insert: mockInsert,
    upsert: mockUpsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
    limit: mockLimit,
  };
  for (const fn of Object.values(chain)) fn.mockReturnValue(chain);
  return chain;
}

const mockFrom = vi.fn(() => createChain());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("../crypto", () => ({
  encryptToken: vi.fn((input: string) => `encrypted_${input}`),
  decryptToken: vi.fn((input: string) => input.replace("encrypted_", "")),
}));

const mockRefreshAccessToken = vi.fn();
vi.mock("../client", () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));

// Import after mocks
import {
  storeTokens,
  getTokens,
  getValidAccessToken,
  deleteTokens,
  getConnectionStatus,
} from "../tokens";
import { encryptToken } from "../crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "user-123";

const TEST_TOKEN_RESPONSE = {
  access_token: "access-tok",
  token_type: "Bearer",
  scope: "user-library-read",
  expires_in: 3600,
  refresh_token: "refresh-tok",
};

const TEST_PROFILE = {
  id: "spotify-user-42",
  display_name: "Test User",
  email: "test@example.com",
  images: [{ url: "https://example.com/avatar.jpg" }],
};

const EXPIRING_TOKEN_ROW = {
  encrypted_access_token: "encrypted_old-access",
  encrypted_refresh_token: "encrypted_old-refresh",
  expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 min
  spotify_user_id: "spotify-user-42",
  spotify_display_name: "Test User",
};

const VALID_TOKEN_ROW = {
  encrypted_access_token: "encrypted_valid-access",
  encrypted_refresh_token: "encrypted_valid-refresh",
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hr
  spotify_user_id: "spotify-user-42",
  spotify_display_name: "Test User",
};

const REFRESHED_RESPONSE = {
  access_token: "new-access",
  token_type: "Bearer",
  scope: "user-library-read",
  expires_in: 3600,
  refresh_token: "new-refresh",
};

/**
 * Helper: set up mocks so getTokens returns token data, and subsequent
 * chained DB calls (update/delete) resolve to { error: null }.
 *
 * The trick: mockFrom returns a fresh chain per call, so each
 * `createAdminClient().from(...)` gets its own chain. The getTokens call
 * ends with .maybeSingle(), and the update/delete call ends with .eq().
 */
function setupGetTokensThenWrite(tokenRow: Record<string, unknown>) {
  let fromCallCount = 0;

  mockFrom.mockImplementation(() => {
    fromCallCount++;

    // First from() call: used by getTokens — needs full chain ending at maybeSingle
    if (fromCallCount === 1) {
      const getTokensChain = createChain();
      mockMaybeSingle.mockResolvedValueOnce({ data: tokenRow, error: null });
      return getTokensChain;
    }

    // Subsequent from() calls: used by update/delete — needs .eq() to return { error: null }
    const writeChain = createChain();
    mockEq.mockReturnValueOnce({ error: null });
    return writeChain;
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every from() returns a fresh chain
  mockFrom.mockImplementation(() => createChain());
});

// ---------------------------------------------------------------------------
// storeTokens
// ---------------------------------------------------------------------------

describe("storeTokens", () => {
  it("encrypts both tokens and upserts to DB", async () => {
    mockUpsert.mockReturnValueOnce({ error: null });

    await storeTokens(TEST_USER_ID, TEST_TOKEN_RESPONSE, TEST_PROFILE);

    expect(mockFrom).toHaveBeenCalledWith("spotify_tokens");
    expect(encryptToken).toHaveBeenCalledWith("access-tok");
    expect(encryptToken).toHaveBeenCalledWith("refresh-tok");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        encrypted_access_token: "encrypted_access-tok",
        encrypted_refresh_token: "encrypted_refresh-tok",
        spotify_user_id: "spotify-user-42",
        spotify_display_name: "Test User",
      }),
      { onConflict: "user_id" }
    );
  });

  it("calculates correct expires_at from expires_in", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    mockUpsert.mockReturnValueOnce({ error: null });

    await storeTokens(TEST_USER_ID, TEST_TOKEN_RESPONSE, TEST_PROFILE);

    const expectedExpiresAt = new Date(
      now + TEST_TOKEN_RESPONSE.expires_in * 1000
    ).toISOString();

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ expires_at: expectedExpiresAt }),
      expect.anything()
    );

    vi.spyOn(Date, "now").mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getTokens
// ---------------------------------------------------------------------------

describe("getTokens", () => {
  it("returns null when no row exists", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await getTokens(TEST_USER_ID);

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("spotify_tokens");
    expect(mockEq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });

  it("decrypts and returns correct SpotifyTokens shape", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        encrypted_access_token: "encrypted_access-tok",
        encrypted_refresh_token: "encrypted_refresh-tok",
        expires_at: "2026-12-31T23:59:59.000Z",
        spotify_user_id: "spotify-user-42",
        spotify_display_name: "Test User",
      },
      error: null,
    });

    const result = await getTokens(TEST_USER_ID);

    expect(result).toEqual({
      access_token: "access-tok",
      refresh_token: "refresh-tok",
      expires_at: "2026-12-31T23:59:59.000Z",
      spotify_user_id: "spotify-user-42",
      spotify_display_name: "Test User",
    });
  });
});

// ---------------------------------------------------------------------------
// getValidAccessToken
// ---------------------------------------------------------------------------

describe("getValidAccessToken", () => {
  it("returns null when user has no tokens", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await getValidAccessToken(TEST_USER_ID);

    expect(result).toBeNull();
  });

  it("returns existing token when not expired", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: VALID_TOKEN_ROW,
      error: null,
    });

    const result = await getValidAccessToken(TEST_USER_ID);

    expect(result).toBe("valid-access");
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes when token expires within 5 minutes", async () => {
    setupGetTokensThenWrite(EXPIRING_TOKEN_ROW);
    mockRefreshAccessToken.mockResolvedValue(REFRESHED_RESPONSE);

    const result = await getValidAccessToken(TEST_USER_ID);

    expect(result).toBe("new-access");
    expect(mockRefreshAccessToken).toHaveBeenCalledWith("old-refresh");
  });

  it("updates DB with new tokens after refresh", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    setupGetTokensThenWrite(EXPIRING_TOKEN_ROW);
    mockRefreshAccessToken.mockResolvedValue(REFRESHED_RESPONSE);

    await getValidAccessToken(TEST_USER_ID);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_access_token: "encrypted_new-access",
        encrypted_refresh_token: "encrypted_new-refresh",
      })
    );

    vi.spyOn(Date, "now").mockRestore();
  });

  it("deletes row and returns null on refresh failure", async () => {
    setupGetTokensThenWrite(EXPIRING_TOKEN_ROW);
    mockRefreshAccessToken.mockRejectedValue(new Error("Token revoked"));

    const result = await getValidAccessToken(TEST_USER_ID);

    expect(result).toBeNull();
    // deleteTokens calls from("spotify_tokens").delete().eq(...)
    expect(mockDelete).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteTokens
// ---------------------------------------------------------------------------

describe("deleteTokens", () => {
  it("removes the row for the given user", async () => {
    mockEq.mockReturnValueOnce({ error: null });

    await deleteTokens(TEST_USER_ID);

    expect(mockFrom).toHaveBeenCalledWith("spotify_tokens");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("user_id", TEST_USER_ID);
  });
});

// ---------------------------------------------------------------------------
// getConnectionStatus
// ---------------------------------------------------------------------------

describe("getConnectionStatus", () => {
  it("returns { connected: false } when no tokens exist", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await getConnectionStatus(TEST_USER_ID);

    expect(result).toEqual({ connected: false });
  });

  it("returns correct shape when connected", async () => {
    // getConnectionStatus calls from() three times:
    //   1. spotify_tokens select — maybeSingle -> token row
    //   2. spotify_subscriptions select count — eq chain -> { count, error }
    //   3. spotify_subscriptions select synced_at — maybeSingle -> sync row
    let fromCallCount = 0;

    mockFrom.mockImplementation(() => {
      fromCallCount++;
      const chain = createChain();

      if (fromCallCount === 1) {
        // Token row lookup
        mockMaybeSingle.mockResolvedValueOnce({
          data: {
            spotify_user_id: "spotify-user-42",
            spotify_display_name: "Test User",
          },
          error: null,
        });
      } else if (fromCallCount === 2) {
        // Count query — the last .eq() in the chain should resolve to { count, error }
        // Chain: select("*", { count: "exact", head: true }).eq().eq()
        // The final .eq() needs to return { count: 5, error: null }
        let eqCalls = 0;
        mockEq.mockImplementation(() => {
          eqCalls++;
          if (eqCalls >= 2) {
            return { count: 5, error: null };
          }
          return chain;
        });
      } else if (fromCallCount === 3) {
        // Latest sync query — chain ends with maybeSingle
        mockMaybeSingle.mockResolvedValueOnce({
          data: { synced_at: "2026-03-15T10:00:00.000Z" },
          error: null,
        });
      }

      return chain;
    });

    const result = await getConnectionStatus(TEST_USER_ID);

    expect(result).toEqual({
      connected: true,
      spotify_user_id: "spotify-user-42",
      spotify_display_name: "Test User",
      last_synced_at: "2026-03-15T10:00:00.000Z",
      subscription_count: 5,
    });
  });
});
