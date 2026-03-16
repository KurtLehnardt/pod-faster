/**
 * Tests for POST /api/feeds/import (OPML import)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ──────────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockGetUser = vi.fn();

const mockUpsert = vi.fn();

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    insert: mockInsert,
    upsert: mockUpsert,
    eq: mockEq,
    single: mockSingle,
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

const mockParseOpml = vi.fn();
const mockParseFeed = vi.fn();

vi.mock("@/lib/rss/parser", () => ({
  parseOpml: (...args: unknown[]) => mockParseOpml(...args),
  parseFeed: (...args: unknown[]) => mockParseFeed(...args),
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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/feeds/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_OPML = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Feed 1" xmlUrl="https://example.com/feed1.xml"/>
    <outline text="Feed 2" xmlUrl="https://example.com/feed2.xml"/>
    <outline text="Feed 3" xmlUrl="https://example.com/feed3.xml"/>
  </body>
</opml>`;

// ── Tests ─────────────────────────────────────────────────────────────────

describe("POST /api/feeds/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({ opml: SAMPLE_OPML }) as Parameters<typeof POST>[0]);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 for missing opml field", async () => {
    mockUser();

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({}) as Parameters<typeof POST>[0]);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid");
  });

  it("returns 400 for opml exceeding size limit", async () => {
    mockUser();

    const { POST } = await import("../import/route");
    const response = await POST(
      makeRequest({ opml: "x".repeat(1_000_001) }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid");
  });

  it("creates multiple feeds from OPML", async () => {
    mockUser();

    const opmlFeeds = [
      { title: "Feed 1", feedUrl: "https://example.com/feed1.xml" },
      { title: "Feed 2", feedUrl: "https://example.com/feed2.xml" },
    ];

    mockParseOpml.mockResolvedValue(opmlFeeds);

    mockParseFeed.mockResolvedValue({
      title: "Parsed Title",
      description: "Parsed description",
      imageUrl: null,
      episodes: [
        {
          guid: "ep-1",
          title: "Episode 1",
          description: null,
          audioUrl: null,
          publishedAt: null,
          durationSeconds: null,
          transcriptUrl: null,
        },
      ],
    });

    // Count query (under limit)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 0, error: null });
      return chain;
    });

    // Existing feeds query (none)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({
        data: [],
        error: null,
      });
      return chain;
    });

    // Feeds are processed in parallel batches, so use a generic mock
    // that handles feed inserts (.insert().select().single()) and
    // episode upserts (.upsert()) in any order.
    let feedInsertCount = 0;
    mockFrom.mockImplementation((...args: unknown[]) => {
      const table = args[0] as string;
      const chain = createChain();
      if (table === "podcast_feeds") {
        feedInsertCount++;
        chain.single.mockResolvedValue({
          data: { id: `feed-${feedInsertCount}` },
          error: null,
        });
      } else if (table === "feed_episodes") {
        // Batch upsert — terminal is the upsert itself (no .select() chain needed)
        chain.upsert.mockResolvedValue({ error: null });
      }
      return chain;
    });

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({ opml: SAMPLE_OPML }) as Parameters<typeof POST>[0]);
    const json = await response.json();

    // Restore default mock
    mockFrom.mockImplementation(() => createChain());

    expect(response.status).toBe(201);
    expect(json.created).toBe(2);
    expect(json.skipped).toBe(0);
    expect(json.errors).toHaveLength(0);
  });

  it("skips duplicate feeds during import", async () => {
    mockUser();

    const opmlFeeds = [
      { title: "Feed 1", feedUrl: "https://example.com/feed1.xml" },
      { title: "Feed 2", feedUrl: "https://example.com/feed2.xml" },
    ];

    mockParseOpml.mockResolvedValue(opmlFeeds);

    mockParseFeed.mockResolvedValue({
      title: "Parsed Title",
      description: null,
      imageUrl: null,
      episodes: [],
    });

    // Count query
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 1, error: null });
      return chain;
    });

    // Existing feeds — feed1 already exists
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({
        data: [{ feed_url: "https://example.com/feed1.xml" }],
        error: null,
      });
      return chain;
    });

    // Feed 2 insert (feed1 is skipped)
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.single.mockResolvedValue({
        data: { id: "feed-2" },
        error: null,
      });
      return chain;
    });

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({ opml: SAMPLE_OPML }) as Parameters<typeof POST>[0]);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.created).toBe(1);
    expect(json.skipped).toBe(1);
  });

  it("enforces feed limit during OPML import", async () => {
    mockUser();

    mockParseOpml.mockResolvedValue([
      { title: "Feed 1", feedUrl: "https://example.com/feed1.xml" },
    ]);

    // Count query — already at limit
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.eq.mockResolvedValue({ count: 50, error: null });
      return chain;
    });

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({ opml: SAMPLE_OPML }) as Parameters<typeof POST>[0]);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toContain("Feed limit reached");
  });

  it("returns 422 for empty OPML (no feeds)", async () => {
    mockUser();

    mockParseOpml.mockResolvedValue([]);

    const { POST } = await import("../import/route");
    const response = await POST(
      makeRequest({ opml: "<opml><body></body></opml>" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toContain("No valid feed URLs");
  });

  it("returns 422 when OPML parsing fails", async () => {
    mockUser();

    mockParseOpml.mockRejectedValue(new Error("Invalid XML"));

    const { POST } = await import("../import/route");
    const response = await POST(makeRequest({ opml: "not xml" }) as Parameters<typeof POST>[0]);
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toContain("Failed to parse OPML content");
  });
});
