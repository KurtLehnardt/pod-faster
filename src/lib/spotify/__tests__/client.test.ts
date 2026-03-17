import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SpotifyApiError,
  spotifyFetch,
  fetchAllSavedShows,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
} from "../client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeShow(id: string) {
  return {
    id,
    name: `Show ${id}`,
    description: `Description ${id}`,
    publisher: "Publisher",
    images: [],
    uri: `spotify:show:${id}`,
    external_urls: { spotify: `https://open.spotify.com/show/${id}` },
    total_episodes: 10,
    media_type: "audio",
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();

  process.env.SPOTIFY_CLIENT_ID = "test-client-id";
  process.env.SPOTIFY_CLIENT_SECRET = "test-client-secret";
  process.env.SPOTIFY_REDIRECT_URI = "http://localhost:3000/callback";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  delete process.env.SPOTIFY_REDIRECT_URI;
});

// ---------------------------------------------------------------------------
// spotifyFetch
// ---------------------------------------------------------------------------

describe("spotifyFetch", () => {
  it("sends Bearer token header", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await spotifyFetch("my-token", "/me");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.spotify.com/v1/me");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-token"
    );
  });

  it("retries on 429 respecting Retry-After header", async () => {
    const rateLimitResponse = new Response(null, {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": "1" },
    });
    mockFetch
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const response = await spotifyFetch("tok", "/me", {}, 3);
    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 with exponential backoff", async () => {
    const serverError = new Response(null, {
      status: 500,
      statusText: "Internal Server Error",
    });
    mockFetch
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const response = await spotifyFetch("tok", "/me", {}, 3);
    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws SpotifyApiError on 401 without retrying", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, 401)
    );

    await expect(spotifyFetch("bad-tok", "/me")).rejects.toThrow(
      SpotifyApiError
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws SpotifyApiError on 403 without retrying", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "forbidden" }, 403)
    );

    const err = await spotifyFetch("tok", "/me").catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect((err as SpotifyApiError).status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// fetchAllSavedShows
// ---------------------------------------------------------------------------

describe("fetchAllSavedShows", () => {
  it("paginates correctly across multiple pages", async () => {
    const page1Items = Array.from({ length: 50 }, (_, i) => ({
      added_at: "2024-01-01T00:00:00Z",
      show: makeShow(`s${i}`),
    }));
    const page2Items = Array.from({ length: 10 }, (_, i) => ({
      added_at: "2024-01-01T00:00:00Z",
      show: makeShow(`s${50 + i}`),
    }));

    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          href: "https://api.spotify.com/v1/me/shows?offset=0&limit=50",
          items: page1Items,
          limit: 50,
          next: "https://api.spotify.com/v1/me/shows?offset=50&limit=50",
          offset: 0,
          previous: null,
          total: 60,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          href: "https://api.spotify.com/v1/me/shows?offset=50&limit=50",
          items: page2Items,
          limit: 50,
          next: null,
          offset: 50,
          previous: "https://api.spotify.com/v1/me/shows?offset=0&limit=50",
          total: 60,
        })
      );

    const shows = await fetchAllSavedShows("tok");

    expect(shows).toHaveLength(60);
    expect(shows[0].id).toBe("s0");
    expect(shows[59].id).toBe("s59");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify pagination URLs
    const [url1] = mockFetch.mock.calls[0];
    const [url2] = mockFetch.mock.calls[1];
    expect(url1).toContain("offset=0");
    expect(url2).toContain("offset=50");
  });

  it("handles empty library (0 shows)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        href: "https://api.spotify.com/v1/me/shows?offset=0&limit=50",
        items: [],
        limit: 50,
        next: null,
        offset: 0,
        previous: null,
        total: 0,
      })
    );

    const shows = await fetchAllSavedShows("tok");
    expect(shows).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  it("sends correct body format", async () => {
    const tokenResponse = {
      access_token: "access-123",
      token_type: "Bearer",
      scope: "user-library-read",
      expires_in: 3600,
      refresh_token: "refresh-456",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(tokenResponse));

    const result = await exchangeCodeForTokens("auth-code", "pkce-verifier", "http://localhost:3000/api/spotify/callback");

    expect(result.access_token).toBe("access-123");
    expect(result.refresh_token).toBe("refresh-456");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(init?.method).toBe("POST");
    expect(
      (init?.headers as Record<string, string>)["Content-Type"]
    ).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(init?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("http://localhost:3000/api/spotify/callback");
    expect(body.get("code_verifier")).toBe("pkce-verifier");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe("refreshAccessToken", () => {
  it("sends correct body format", async () => {
    const tokenResponse = {
      access_token: "new-access-789",
      token_type: "Bearer",
      scope: "user-library-read",
      expires_in: 3600,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(tokenResponse));

    const result = await refreshAccessToken("refresh-456");

    expect(result.access_token).toBe("new-access-789");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(init?.method).toBe("POST");

    const body = new URLSearchParams(init?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-456");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });
});

// ---------------------------------------------------------------------------
// revokeToken
// ---------------------------------------------------------------------------

describe("revokeToken", () => {
  it("does not throw on error response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: "Internal Server Error" })
    );

    // Should not throw
    await expect(revokeToken("some-token")).resolves.toBeUndefined();
  });

  it("does not throw on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    // Should not throw
    await expect(revokeToken("some-token")).resolves.toBeUndefined();
  });
});
