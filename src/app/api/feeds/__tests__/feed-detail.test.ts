/**
 * Tests for GET/PUT/DELETE /api/feeds/[id]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn();

/**
 * Creates an isolated Supabase query-builder chain where every method
 * returns the same chain object by default. Each chain has its OWN set of
 * vi.fn() instances so separate chains never interfere with each other.
 */
function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "in",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ];

  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
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

// ── Mock validation ──────────────────────────────────────────────────────

vi.mock("@/lib/validation/feed-schemas", () => {
  const { z } = require("zod");
  return {
    updateFeedSchema: z.object({
      is_active: z.boolean().optional(),
      title: z.string().max(500).optional(),
    }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────

function mockUser(id = "user-123") {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

function mockNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
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
  return new Request("http://localhost/api/feeds/feed-1", init);
}

function makeContext(id = "feed-1") {
  return { params: Promise.resolve({ id }) };
}

function makeFeed(overrides: Record<string, unknown> = {}) {
  return {
    id: "feed-1",
    user_id: "user-123",
    feed_url: "https://example.com/feed.xml",
    title: "Test Podcast",
    description: "A test podcast",
    image_url: null,
    last_polled_at: null,
    last_episode_at: null,
    is_active: true,
    poll_error: null,
    poll_error_count: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEpisode(overrides: Record<string, unknown> = {}) {
  return {
    id: "ep-1",
    feed_id: "feed-1",
    user_id: "user-123",
    guid: "guid-1",
    title: "Episode 1",
    description: "First episode",
    audio_url: "https://example.com/ep1.mp3",
    published_at: "2025-06-01T00:00:00Z",
    duration_seconds: 3600,
    transcript: null,
    transcript_source: null,
    transcription_status: "none",
    transcription_error: null,
    elevenlabs_cost_cents: 0,
    created_at: "2025-06-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Mock a .select().eq().eq().single() query (e.g., fetch feed by id + user_id).
 */
function mockSingleFetch(data: unknown, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.single.mockResolvedValue({ data, error });
    return chain;
  });
}

/**
 * Mock a .select().eq().eq().order().limit() query (e.g., episodes list).
 */
function mockEpisodesFetch(data: unknown[], error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.limit.mockResolvedValue({ data, error });
    return chain;
  });
}

/**
 * Mock a .update().eq().eq().select().single() query.
 */
function mockUpdateWithSelect(data: unknown, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.single.mockResolvedValue({ data, error });
    return chain;
  });
}

/**
 * Mock a .delete().eq("id").eq("user_id") query — two chained .eq() calls
 * where the second is the terminal that gets awaited.
 */
function mockDeleteChain(error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    // .delete() returns chain, first .eq() returns chain, second .eq() resolves
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ error });
    return chain;
  });
}

// ── Tests: GET /api/feeds/[id] ───────────────────────────────────────────

describe("GET /api/feeds/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
  });

  it("returns feed with recent episodes", async () => {
    mockUser();

    const feed = makeFeed();
    const episodes = [
      makeEpisode(),
      makeEpisode({ id: "ep-2", guid: "guid-2", title: "Episode 2" }),
    ];

    // 1. Fetch feed -> .select().eq().eq().single()
    mockSingleFetch(feed);

    // 2. Fetch episodes -> .select().eq().eq().order().limit()
    mockEpisodesFetch(episodes);

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest("GET") as Parameters<typeof GET>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.feed.id).toBe("feed-1");
    expect(json.feed.title).toBe("Test Podcast");
    expect(json.episodes).toHaveLength(2);
  });

  it("returns 404 for another user's feed (ownership check)", async () => {
    mockUser("user-456");

    mockSingleFetch(null, { message: "Not found" });

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest("GET") as Parameters<typeof GET>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Feed not found");
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { GET } = await import("../[id]/route");
    const response = await GET(
      makeRequest("GET") as Parameters<typeof GET>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });
});

// ── Tests: PUT /api/feeds/[id] ───────────────────────────────────────────

describe("PUT /api/feeds/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
  });

  it("updates is_active toggle", async () => {
    mockUser();

    const feed = makeFeed();

    // 1. Verify ownership -> .select("id").eq().eq().single()
    mockSingleFetch({ id: "feed-1" });

    // 2. Update -> .update().eq().eq().select().single()
    mockUpdateWithSelect({
      ...feed,
      is_active: false,
      updated_at: "2025-07-01T00:00:00Z",
    });

    const { PUT } = await import("../[id]/route");
    const response = await PUT(
      makeRequest("PUT", { is_active: false }) as Parameters<typeof PUT>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.feed.is_active).toBe(false);
  });

  it("updates title", async () => {
    mockUser();

    const feed = makeFeed();

    // 1. Verify ownership
    mockSingleFetch({ id: "feed-1" });

    // 2. Update
    mockUpdateWithSelect({
      ...feed,
      title: "Renamed Podcast",
      updated_at: "2025-07-01T00:00:00Z",
    });

    const { PUT } = await import("../[id]/route");
    const response = await PUT(
      makeRequest("PUT", { title: "Renamed Podcast" }) as Parameters<
        typeof PUT
      >[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.feed.title).toBe("Renamed Podcast");
  });

  it("returns 404 for another user's feed (ownership check)", async () => {
    mockUser("user-456");

    mockSingleFetch(null, { message: "Not found" });

    const { PUT } = await import("../[id]/route");
    const response = await PUT(
      makeRequest("PUT", { is_active: false }) as Parameters<typeof PUT>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Feed not found");
  });

  it("returns 400 for invalid body", async () => {
    mockUser();

    const { PUT } = await import("../[id]/route");
    const response = await PUT(
      makeRequest("PUT", { is_active: "not-a-boolean" }) as Parameters<
        typeof PUT
      >[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid");
  });
});

// ── Tests: DELETE /api/feeds/[id] ────────────────────────────────────────

describe("DELETE /api/feeds/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
  });

  it("removes feed successfully", async () => {
    mockUser();

    // 1. Verify ownership -> .select("id").eq().eq().single()
    mockSingleFetch({ id: "feed-1" });

    // 2. Delete feed -> .delete().eq("id").eq("user_id")
    mockDeleteChain();

    const { DELETE } = await import("../[id]/route");
    const response = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.deleted).toBe(true);
  });

  it("returns 404 for another user's feed (ownership check)", async () => {
    mockUser("user-456");

    mockSingleFetch(null, { message: "Not found" });

    const { DELETE } = await import("../[id]/route");
    const response = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Feed not found");
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { DELETE } = await import("../[id]/route");
    const response = await DELETE(
      makeRequest("DELETE") as Parameters<typeof DELETE>[0],
      makeContext()
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });
});
