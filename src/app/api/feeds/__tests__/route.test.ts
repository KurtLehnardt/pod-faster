/**
 * Tests for GET/POST /api/feeds
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ──────────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockGetUser = vi.fn();

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    insert: mockInsert,
    upsert: mockUpsert,
    update: mockUpdate,
    eq: mockEq,
    in: mockIn,
    order: mockOrder,
    limit: mockLimit,
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
      auth: {
        getUser: mockGetUser,
      },
      from: mockFrom,
    })
  ),
}));

// ── Mock RSS modules ──────────────────────────────────────────────────────

const mockParseFeed = vi.fn();
const mockValidateFeedUrl = vi.fn();
const mockExtractTranscript = vi.fn();

vi.mock("@/lib/rss/parser", () => ({
  parseFeed: (...args: unknown[]) => mockParseFeed(...args),
}));

vi.mock("@/lib/rss/url-validator", () => ({
  validateFeedUrl: (...args: unknown[]) => mockValidateFeedUrl(...args),
}));

vi.mock("@/lib/rss/transcript", () => ({
  extractTranscript: (...args: unknown[]) => mockExtractTranscript(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function mockUser(id = "user-123") {
  mockGetUser.mockResolvedValue({
    data: { user: { id } },
  });
}

function mockNoUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
  });
}

function makeRequest(
  method: string,
  body?: Record<string, unknown>
): Request {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/feeds", init);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { GET } = await import("../route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns feeds list with episode counts", async () => {
    mockUser();

    const feeds = [
      { id: "feed-1", user_id: "user-123", feed_url: "https://example.com/feed1.xml", title: "Feed 1" },
      { id: "feed-2", user_id: "user-123", feed_url: "https://example.com/feed2.xml", title: "Feed 2" },
    ];

    const episodeCounts = [
      { feed_id: "feed-1" },
      { feed_id: "feed-1" },
      { feed_id: "feed-1" },
      { feed_id: "feed-2" },
    ];

    // First call: podcast_feeds select
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.order.mockResolvedValue({ data: feeds, error: null });
      return chain;
    });

    // Second call: feed_episodes select for counts (now with .limit(10000))
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.limit.mockResolvedValue({ data: episodeCounts, error: null });
      return chain;
    });

    const { GET } = await import("../route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.feeds).toHaveLength(2);
    expect(json.feeds[0].episode_count).toBe(3);
    expect(json.feeds[1].episode_count).toBe(1);
  });

  it("returns empty list when user has no feeds", async () => {
    mockUser();

    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.order.mockResolvedValue({ data: [], error: null });
      return chain;
    });

    const { GET } = await import("../route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.feeds).toEqual([]);
  });
});

describe("POST /api/feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateFeedUrl.mockReturnValue({ valid: true });
    mockExtractTranscript.mockResolvedValue({
      transcript: null,
      source: null,
      truncated: false,
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", { feedUrl: "https://example.com/feed.xml" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid body", async () => {
    mockUser();

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", { feedUrl: "not-a-url" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid");
  });

  it("returns 400 for invalid feed URL (SSRF)", async () => {
    mockUser();
    mockValidateFeedUrl.mockReturnValue({
      valid: false,
      error: "Private IP",
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", {
        feedUrl: "https://192.168.1.1/feed.xml",
      }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid feed URL");
  });

  it("returns 409 when feed limit reached", async () => {
    mockUser();

    // Count query returns 50 (at limit)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 50, error: null });
      return chain;
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", {
        feedUrl: "https://example.com/feed.xml",
      }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toContain("Feed limit reached");
  });

  it("returns 409 for duplicate feed", async () => {
    mockUser();

    // Count query (under limit)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 5, error: null });
      return chain;
    });

    // Duplicate check — existing feed found
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.maybeSingle.mockResolvedValue({
        data: { id: "existing-feed" },
        error: null,
      });
      return chain;
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", {
        feedUrl: "https://example.com/feed.xml",
      }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toContain("already subscribed");
  });

  it("creates feed with parsed metadata and episodes", async () => {
    mockUser();

    const parsedFeed = {
      title: "Tech Podcast",
      description: "A tech podcast",
      imageUrl: "https://example.com/image.jpg",
      episodes: [
        {
          guid: "ep-1",
          title: "Episode 1",
          description: "First episode",
          audioUrl: "https://example.com/ep1.mp3",
          publishedAt: new Date("2025-01-01"),
          durationSeconds: 3600,
          transcriptUrl: null,
        },
      ],
    };

    mockParseFeed.mockResolvedValue(parsedFeed);

    // Count query (under limit)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 2, error: null });
      return chain;
    });

    // Duplicate check — no existing feed
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      return chain;
    });

    // Insert feed
    const insertedFeed = {
      id: "new-feed-id",
      user_id: "user-123",
      feed_url: "https://example.com/feed.xml",
      title: "Tech Podcast",
      description: "A tech podcast",
      image_url: "https://example.com/image.jpg",
      is_active: true,
    };

    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.single.mockResolvedValue({
        data: insertedFeed,
        error: null,
      });
      return chain;
    });

    // Batch upsert episodes (returns .upsert().select("id"))
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.select.mockResolvedValue({
        data: [{ id: "ep-id-1" }],
        error: null,
      });
      return chain;
    });

    // Update last_episode_at
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ error: null });
      return chain;
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", {
        feedUrl: "https://example.com/feed.xml",
      }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.feed.id).toBe("new-feed-id");
    expect(json.feed.title).toBe("Tech Podcast");
    expect(json.episodesImported).toBe(1);
  });

  it("returns 422 when feed cannot be parsed", async () => {
    mockUser();

    mockParseFeed.mockRejectedValue(new Error("Invalid XML"));

    // Count query
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 0, error: null });
      return chain;
    });

    // Duplicate check
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      return chain;
    });

    const { POST } = await import("../route");
    const response = await POST(
      makeRequest("POST", {
        feedUrl: "https://example.com/bad-feed.xml",
      }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toContain("Unable to fetch or parse feed");
  });
});
