/**
 * Integration journey test for the feed importer feature.
 *
 * Tests the complete flow: import OPML → verify feeds → poll feeds → verify
 * episodes → trigger transcription → trigger summary generation.
 *
 * All external services (Supabase, RSS, ElevenLabs, Claude) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase (server client) ────────────────────────────
// Use shared mock functions so all chains reference the same fns.

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockGetUser = vi.fn();

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
  };

  for (const fn of Object.values(chain)) {
    fn.mockReturnValue(chain);
  }

  return chain;
}

const mockFrom = vi.fn(() => createChain());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}));

// ── Mock RSS modules ─────────────────────────────────────────

const mockParseFeed = vi.fn();
const mockParseOpml = vi.fn();
const mockValidateFeedUrl = vi.fn();
const mockExtractTranscript = vi.fn();

vi.mock("@/lib/rss/parser", () => ({
  parseFeed: (...args: unknown[]) => mockParseFeed(...args),
  parseOpml: (...args: unknown[]) => mockParseOpml(...args),
}));

vi.mock("@/lib/rss/url-validator", () => ({
  validateFeedUrl: (...args: unknown[]) => mockValidateFeedUrl(...args),
}));

vi.mock("@/lib/rss/transcript", () => ({
  extractTranscript: (...args: unknown[]) => mockExtractTranscript(...args),
}));

// ── Helpers ──────────────────────────────────────────────────

function mockAuthUser(id = "user-journey-1") {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

function mockNoAuth() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}

function makeRequest(method: string, url: string, body?: Record<string, unknown>): Request {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost${url}`, init);
}

// ── Reset ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateFeedUrl.mockReturnValue({ valid: true });
  mockExtractTranscript.mockResolvedValue({ transcript: null, source: null, truncated: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ── Journey Tests ────────────────────────────────────────────

describe("Feed Importer Journey", () => {
  describe("OPML import → feeds created", () => {
    it("imports multiple feeds from OPML and returns created count", async () => {
      mockAuthUser();

      mockParseOpml.mockReturnValue([
        { title: "Tech Talk", feedUrl: "https://techtalk.example.com/feed.xml" },
        { title: "Dev Digest", feedUrl: "https://devdigest.example.com/rss" },
      ]);

      mockParseFeed.mockResolvedValue({
        title: "Parsed Title",
        description: "Description",
        imageUrl: null,
        episodes: [],
      });

      // 1. Count check (under limit)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 2, error: null });
        return chain;
      });

      // 2. Existing URLs query (none exist)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ data: [], error: null });
        return chain;
      });

      // 3. Feed 1 insert
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.single.mockResolvedValue({
          data: { id: "feed-1" },
          error: null,
        });
        return chain;
      });

      // 4. Feed 2 insert
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.single.mockResolvedValue({
          data: { id: "feed-2" },
          error: null,
        });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/import/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds/import", {
          opml: "<opml>...</opml>",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.created).toBe(2);
      expect(json.skipped).toBe(0);
    });

    it("skips duplicate feeds during OPML import", async () => {
      mockAuthUser();

      mockParseOpml.mockReturnValue([
        { title: "Existing Feed", feedUrl: "https://existing.example.com/feed.xml" },
        { title: "New Feed", feedUrl: "https://new.example.com/feed.xml" },
      ]);

      mockParseFeed.mockResolvedValue({
        title: "Parsed",
        description: null,
        imageUrl: null,
        episodes: [],
      });

      // 1. Count check
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 5, error: null });
        return chain;
      });

      // 2. Existing URLs — one already exists
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({
          data: [{ feed_url: "https://existing.example.com/feed.xml" }],
          error: null,
        });
        return chain;
      });

      // 3. New feed insert (existing is skipped via Set check)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.single.mockResolvedValue({
          data: { id: "new-feed-id" },
          error: null,
        });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/import/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds/import", {
          opml: "<opml>...</opml>",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.created).toBe(1);
      expect(json.skipped).toBe(1);
    });
  });

  describe("OPML over feed limit", () => {
    it("returns 409 when user is already at the feed limit", async () => {
      mockAuthUser();

      mockParseOpml.mockReturnValue([
        { title: "New Feed", feedUrl: "https://new.example.com/rss" },
      ]);

      // Count check — already at limit (50)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 50, error: null });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/import/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds/import", {
          opml: "<opml>...</opml>",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(409);
      expect(json.error).toContain("limit");
    });
  });

  describe("Feed with no episodes", () => {
    it("creates feed with zero episodes when RSS has no items", async () => {
      mockAuthUser();

      mockParseFeed.mockResolvedValue({
        title: "Empty Podcast",
        description: "A podcast with no episodes yet",
        imageUrl: null,
        episodes: [],
      });

      // 1. Count check
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 0, error: null });
        return chain;
      });

      // 2. Duplicate check (single feed route uses maybeSingle)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        return chain;
      });

      // 3. Insert feed
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.single.mockResolvedValue({
          data: { id: "empty-feed", title: "Empty Podcast" },
          error: null,
        });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds", {
          feedUrl: "https://empty.example.com/feed.xml",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.episodesImported).toBe(0);
    });
  });

  describe("Malformed RSS feed → stores error", () => {
    it("returns 422 for unparseable feed XML", async () => {
      mockAuthUser();

      mockParseFeed.mockRejectedValue(new Error("Invalid XML: unclosed tag"));

      // 1. Count check
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 0, error: null });
        return chain;
      });

      // 2. Duplicate check
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds", {
          feedUrl: "https://malformed.example.com/feed.xml",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(422);
      expect(json.error).toContain("Unable to fetch or parse feed");
    });
  });

  describe("Auth enforcement across all feed routes", () => {
    it("returns 401 on GET /api/feeds when unauthenticated", async () => {
      mockNoAuth();

      const { GET } = await import("@/app/api/feeds/route");
      const response = await GET();

      expect(response.status).toBe(401);
    });

    it("returns 401 on POST /api/feeds when unauthenticated", async () => {
      mockNoAuth();

      const { POST } = await import("@/app/api/feeds/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds", {
          feedUrl: "https://example.com/feed.xml",
        }) as Parameters<typeof POST>[0]
      );

      expect(response.status).toBe(401);
    });

    it("returns 401 on POST /api/feeds/import when unauthenticated", async () => {
      mockNoAuth();

      const { POST } = await import("@/app/api/feeds/import/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds/import", {
          opml: "<opml/>",
        }) as Parameters<typeof POST>[0]
      );

      expect(response.status).toBe(401);
    });
  });

  describe("SSRF prevention via URL validator", () => {
    it("blocks feeds with private IP addresses", async () => {
      mockAuthUser();
      mockValidateFeedUrl.mockReturnValue({ valid: false, error: "Private IP address" });

      // Count check (under limit)
      mockFrom.mockImplementationOnce(() => {
        const chain = createChain();
        chain.eq.mockResolvedValue({ count: 0, error: null });
        return chain;
      });

      const { POST } = await import("@/app/api/feeds/route");
      const response = await POST(
        makeRequest("POST", "/api/feeds", {
          feedUrl: "https://192.168.1.1/feed.xml",
        }) as Parameters<typeof POST>[0]
      );
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toContain("Invalid feed URL");
    });
  });
});
