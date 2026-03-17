import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/headers (used by server Supabase client)
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock Supabase server client (for auth checks)
// ---------------------------------------------------------------------------

const mockAuthGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: (...args: unknown[]) => mockAuthGetUser(...args),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/spotify/tokens
// ---------------------------------------------------------------------------

const mockStoreTokens = vi.fn();
const mockGetTokens = vi.fn();
const mockGetValidAccessToken = vi.fn();
const mockDeleteTokens = vi.fn();
const mockGetConnectionStatus = vi.fn();

vi.mock("@/lib/spotify/tokens", () => ({
  storeTokens: (...args: unknown[]) => mockStoreTokens(...args),
  getTokens: (...args: unknown[]) => mockGetTokens(...args),
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
  deleteTokens: (...args: unknown[]) => mockDeleteTokens(...args),
  getConnectionStatus: (...args: unknown[]) =>
    mockGetConnectionStatus(...args),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/spotify/client
// ---------------------------------------------------------------------------

const mockExchangeCodeForTokens = vi.fn();
const mockFetchUserProfile = vi.fn();
const mockRevokeToken = vi.fn();

vi.mock("@/lib/spotify/client", () => ({
  exchangeCodeForTokens: (...args: unknown[]) =>
    mockExchangeCodeForTokens(...args),
  fetchUserProfile: (...args: unknown[]) => mockFetchUserProfile(...args),
  revokeToken: (...args: unknown[]) => mockRevokeToken(...args),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/spotify/sync
// ---------------------------------------------------------------------------

const mockSyncSubscriptions = vi.fn();
const mockGetSubscriptions = vi.fn();
const mockUpdateSubscriptionPreference = vi.fn();
const mockBulkUpdatePreferences = vi.fn();
const mockRemoveAllSubscriptions = vi.fn();

vi.mock("@/lib/spotify/sync", () => ({
  syncSubscriptions: (...args: unknown[]) => mockSyncSubscriptions(...args),
  getSubscriptions: (...args: unknown[]) => mockGetSubscriptions(...args),
  updateSubscriptionPreference: (...args: unknown[]) =>
    mockUpdateSubscriptionPreference(...args),
  bulkUpdatePreferences: (...args: unknown[]) =>
    mockBulkUpdatePreferences(...args),
  removeAllSubscriptions: (...args: unknown[]) =>
    mockRemoveAllSubscriptions(...args),
}));

// ---------------------------------------------------------------------------
// Helper: construct a Request suitable for route handlers
// ---------------------------------------------------------------------------

function makeRequest(method: string, url: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost${url}`, init);
}

/**
 * Build a Request with query params and a cookie header.
 * Needed for the callback route which reads request.nextUrl.searchParams
 * and request.cookies.
 */
function makeCallbackRequest(
  queryParams: Record<string, string>,
  cookieValue?: string
): Request {
  const url = new URL("http://localhost/api/spotify/callback");
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (cookieValue) {
    headers["cookie"] = `spotify_oauth=${cookieValue}`;
  }

  return new Request(url.toString(), { method: "GET", headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Spotify API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // POST /api/spotify/connect
  // =========================================================================

  describe("POST /api/spotify/connect", () => {
    let POST: (request: Request) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/connect/route");
      POST = mod.POST as unknown as (request: Request) => Promise<Response>;
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const res = await POST(new Request("http://localhost:3000/api/spotify/connect", { method: "POST" }));
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns URL with correct Spotify params", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      // Set required env vars
      process.env.SPOTIFY_CLIENT_ID = "test-client-id";
      process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/api/spotify/callback";

      const { NextRequest } = await import("next/server");
      const res = await POST(new NextRequest("http://localhost:3000/api/spotify/connect", {
        method: "POST",
        headers: { host: "localhost:3000" },
      }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.url).toBeDefined();
      expect(data.url).toContain("https://accounts.spotify.com/authorize");
      expect(data.url).toContain("client_id=test-client-id");
      expect(data.url).toContain("response_type=code");
      expect(data.url).toContain("code_challenge_method=S256");
      expect(data.url).toContain("user-library-read");
      expect(data.url).toContain("state=");
      expect(data.url).toContain("code_challenge=");

      // Verify cookie is set
      const setCookieHeader = res.headers.getSetCookie();
      expect(setCookieHeader.length).toBeGreaterThan(0);
      const cookieStr = setCookieHeader[0];
      expect(cookieStr).toContain("spotify_oauth=");
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("Path=/api/spotify");
    });
  });

  // =========================================================================
  // GET /api/spotify/callback
  // =========================================================================

  describe("GET /api/spotify/callback", () => {
    let GET: (
      req: import("next/server").NextRequest
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/callback/route");
      GET = mod.GET;
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    });

    it("redirects to error on state mismatch", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const oauthCookie = JSON.stringify({
        codeVerifier: "test-verifier",
        state: "correct-state",
      });

      const req = makeCallbackRequest(
        { code: "auth-code", state: "wrong-state" },
        oauthCookie
      );

      // NextRequest constructor accepts a Request
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await GET(nextReq);
      expect(res.status).toBe(307);

      const location = res.headers.get("location");
      expect(location).toContain("spotify=error");
      expect(location).toContain("reason=state_mismatch");
    });

    it("redirects to error on missing cookie", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      // No cookie set
      const req = makeCallbackRequest({
        code: "auth-code",
        state: "some-state",
      });

      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await GET(nextReq);
      expect(res.status).toBe(307);

      const location = res.headers.get("location");
      expect(location).toContain("spotify=error");
      expect(location).toContain("reason=expired");
    });

    it("exchanges code and redirects on success", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const theState = "matching-state-value";
      const oauthCookie = JSON.stringify({
        codeVerifier: "test-verifier",
        state: theState,
      });

      mockExchangeCodeForTokens.mockResolvedValueOnce({
        access_token: "sp-access-token",
        token_type: "Bearer",
        scope: "user-library-read",
        expires_in: 3600,
        refresh_token: "sp-refresh-token",
      });

      mockFetchUserProfile.mockResolvedValueOnce({
        id: "spotify-user-1",
        display_name: "Test User",
        email: "test@example.com",
        images: [],
      });

      mockStoreTokens.mockResolvedValueOnce(undefined);
      mockSyncSubscriptions.mockResolvedValueOnce({
        added: 5,
        removed: 0,
        unchanged: 0,
        total: 5,
      });

      const req = makeCallbackRequest(
        { code: "auth-code", state: theState },
        oauthCookie
      );

      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await GET(nextReq);
      expect(res.status).toBe(307);

      const location = res.headers.get("location");
      expect(location).toContain("spotify=connected");

      // Verify the exchange was called with the right args (3-arg form: code, verifier, redirectUri)
      expect(mockExchangeCodeForTokens).toHaveBeenCalledWith(
        "auth-code",
        "test-verifier",
        "http://localhost/api/spotify/callback"
      );
      expect(mockFetchUserProfile).toHaveBeenCalledWith("sp-access-token");
      expect(mockStoreTokens).toHaveBeenCalledWith(
        "user-123",
        expect.objectContaining({ access_token: "sp-access-token" }),
        expect.objectContaining({ id: "spotify-user-1" })
      );
    });
  });

  // =========================================================================
  // POST /api/spotify/sync
  // =========================================================================

  describe("POST /api/spotify/sync", () => {
    let POST: () => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/sync/route");
      POST = mod.POST;
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const res = await POST();
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 404 when Spotify not connected", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockSyncSubscriptions.mockRejectedValueOnce(
        new Error("Spotify not connected")
      );

      const res = await POST();
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.error).toBe("Spotify not connected");
    });

    it("returns sync result on success", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const syncResult = {
        added: 3,
        removed: 1,
        unchanged: 10,
        total: 13,
      };
      mockSyncSubscriptions.mockResolvedValueOnce(syncResult);

      const res = await POST();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.result).toEqual(syncResult);
    });
  });

  // =========================================================================
  // GET /api/spotify/subscriptions
  // =========================================================================

  describe("GET /api/spotify/subscriptions", () => {
    let GET: (
      req: import("next/server").NextRequest
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/subscriptions/route");
      GET = mod.GET;
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = makeRequest("GET", "/api/spotify/subscriptions");
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await GET(nextReq);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns subscription list", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const subscriptions = [
        {
          id: "sub-1",
          show_name: "Podcast A",
          summarization_enabled: true,
          is_removed: false,
        },
        {
          id: "sub-2",
          show_name: "Podcast B",
          summarization_enabled: false,
          is_removed: false,
        },
      ];
      mockGetSubscriptions.mockResolvedValueOnce(subscriptions);

      const req = makeRequest("GET", "/api/spotify/subscriptions");
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await GET(nextReq);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.subscriptions).toHaveLength(2);
      expect(data.subscriptions[0].show_name).toBe("Podcast A");

      // Verify includeRemoved defaults to false
      expect(mockGetSubscriptions).toHaveBeenCalledWith("user-123", {
        includeRemoved: false,
      });
    });
  });

  // =========================================================================
  // PATCH /api/spotify/subscriptions/:id
  // =========================================================================

  describe("PATCH /api/spotify/subscriptions/:id", () => {
    let PATCH: (
      req: import("next/server").NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import(
        "@/app/api/spotify/subscriptions/[id]/route"
      );
      PATCH = mod.PATCH;
    });

    it("validates body — rejects missing summarization_enabled", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = makeRequest(
        "PATCH",
        "/api/spotify/subscriptions/sub-1",
        { invalid: true }
      );
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await PATCH(nextReq, {
        params: Promise.resolve({ id: "sub-1" }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("summarization_enabled");
    });

    it("updates subscription preference correctly", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockUpdateSubscriptionPreference.mockResolvedValueOnce(true);

      const req = makeRequest(
        "PATCH",
        "/api/spotify/subscriptions/sub-1",
        { summarization_enabled: false }
      );
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await PATCH(nextReq, {
        params: Promise.resolve({ id: "sub-1" }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.updated).toBe(true);

      expect(mockUpdateSubscriptionPreference).toHaveBeenCalledWith(
        "user-123",
        "sub-1",
        false
      );
    });
  });

  // =========================================================================
  // PATCH /api/spotify/subscriptions/bulk
  // =========================================================================

  describe("PATCH /api/spotify/subscriptions/bulk", () => {
    let PATCH: (
      req: import("next/server").NextRequest
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import(
        "@/app/api/spotify/subscriptions/bulk/route"
      );
      PATCH = mod.PATCH;
    });

    it("validates body — rejects empty updates array", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = makeRequest(
        "PATCH",
        "/api/spotify/subscriptions/bulk",
        { updates: [] }
      );
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await PATCH(nextReq);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("non-empty array");
    });

    it("bulk updates multiple subscriptions", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockBulkUpdatePreferences.mockResolvedValueOnce(undefined);

      const updates = [
        { id: "sub-1", summarization_enabled: true },
        { id: "sub-2", summarization_enabled: false },
      ];

      const req = makeRequest(
        "PATCH",
        "/api/spotify/subscriptions/bulk",
        { updates }
      );
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await PATCH(nextReq);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.updated).toBe(2);

      expect(mockBulkUpdatePreferences).toHaveBeenCalledWith(
        "user-123",
        updates
      );
    });
  });

  // =========================================================================
  // DELETE /api/spotify/disconnect
  // =========================================================================

  describe("DELETE /api/spotify/disconnect", () => {
    let DELETE: (
      req: import("next/server").NextRequest
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/disconnect/route");
      DELETE = mod.DELETE;
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = makeRequest("DELETE", "/api/spotify/disconnect");
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await DELETE(nextReq);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("disconnects and removes data when remove_data=true", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockGetValidAccessToken.mockResolvedValueOnce("sp-access-token");
      mockRevokeToken.mockResolvedValueOnce(undefined);
      mockDeleteTokens.mockResolvedValueOnce(undefined);
      mockRemoveAllSubscriptions.mockResolvedValueOnce(undefined);

      const req = makeRequest(
        "DELETE",
        "/api/spotify/disconnect?remove_data=true"
      );
      const { NextRequest } = await import("next/server");
      const nextReq = new NextRequest(req);

      const res = await DELETE(nextReq);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.disconnected).toBe(true);

      expect(mockRevokeToken).toHaveBeenCalledWith("sp-access-token");
      expect(mockDeleteTokens).toHaveBeenCalledWith("user-123");
      expect(mockRemoveAllSubscriptions).toHaveBeenCalledWith("user-123");
    });
  });

  // =========================================================================
  // GET /api/spotify/status
  // =========================================================================

  describe("GET /api/spotify/status", () => {
    let GET: () => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/spotify/status/route");
      GET = mod.GET;
    });

    it("returns connection status", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const statusResult = {
        connected: true,
        spotify_user_id: "spotify-user-1",
        spotify_display_name: "Test User",
        last_synced_at: "2026-03-15T00:00:00.000Z",
        subscription_count: 5,
      };
      mockGetConnectionStatus.mockResolvedValueOnce(statusResult);

      const res = await GET();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.connected).toBe(true);
      expect(data.spotify_user_id).toBe("spotify-user-1");
      expect(data.subscription_count).toBe(5);

      expect(mockGetConnectionStatus).toHaveBeenCalledWith("user-123");
    });
  });
});
