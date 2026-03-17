/**
 * Tests for POST /api/feeds/poll
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChain } from "@/__tests__/helpers/mock-supabase";

// -- Mock Supabase ----------------------------------------------------------

const mockGetUser = vi.fn();
const mockFrom = vi.fn(() => createChain());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}));

// -- Mock RSS modules -------------------------------------------------------

const mockPollFeed = vi.fn();
const mockExtractTranscript = vi.fn();

vi.mock("@/lib/rss/poller", () => ({
  pollFeed: (...args: unknown[]) => mockPollFeed(...args),
}));

vi.mock("@/lib/rss/transcript", () => ({
  extractTranscript: (...args: unknown[]) => mockExtractTranscript(...args),
}));

// -- Helpers ----------------------------------------------------------------

function mockUser(id = "user-123") {
  mockGetUser.mockResolvedValue({ data: { user: { id } } });
}

function mockNoUser() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}

function makeRequest(body?: Record<string, unknown>): Request {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/feeds/poll", init);
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

/**
 * Helper: set up a mockFrom.mockImplementationOnce for a query that ends with
 * .select("*").eq(X).eq(Y).single()   (single-feed fetch by id + user_id)
 */
function mockFeedFetchById(feed: ReturnType<typeof makeFeed> | null, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    // Terminal is .single()
    chain.single.mockResolvedValue({ data: feed, error });
    return chain;
  });
}

/**
 * Helper: set up a mockFrom for a query that ends with
 * .select("*").eq(user_id).eq(is_active) -- the second .eq() is the terminal.
 */
function mockActiveFeedsFetch(feeds: ReturnType<typeof makeFeed>[]) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    // Two chained .eq() calls -- first returns chain, second resolves
    chain.eq
      .mockReturnValueOnce(chain)
      .mockResolvedValueOnce({ data: feeds, error: null });
    return chain;
  });
}

/**
 * Helper: set up a mockFrom for a query that ends with .select("guid").eq(feed_id)
 */
function mockExistingEpisodes(guids: string[]) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.eq.mockResolvedValue({
      data: guids.map((g) => ({ guid: g })),
      error: null,
    });
    return chain;
  });
}

/**
 * Helper: set up a mockFrom for a batch upsert that resolves with .select()
 */
function mockBatchEpisodeUpsert(count = 1, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    const rows = Array.from({ length: count }, (_, i) => ({ id: `ep-row-${i}` }));
    chain.select.mockResolvedValue({ data: rows, error });
    return chain;
  });
}

/**
 * Helper: set up mockFrom entries for duration backfill.
 * Each episode with a non-null durationSeconds triggers one
 * .update().eq().eq().is() call on feed_episodes.
 */
function mockDurationBackfill(count: number) {
  for (let i = 0; i < count; i++) {
    mockFrom.mockImplementationOnce(() => {
      const chain = createChain();
      chain.is.mockResolvedValue({ error: null });
      return chain;
    });
  }
}

/**
 * Helper: set up a mockFrom for .update(payload).eq(id) -- single .eq() terminal.
 * Returns the captured update payload via a ref callback.
 */
function mockFeedUpdate(onPayload?: (p: Record<string, unknown>) => void) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    if (onPayload) {
      chain.update.mockImplementation((payload: Record<string, unknown>) => {
        onPayload(payload);
        return chain;
      });
    }
    chain.eq.mockResolvedValue({ error: null });
    return chain;
  });
}

// -- Tests ------------------------------------------------------------------

describe("POST /api/feeds/poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish the default mockFrom implementation after clearAllMocks
    mockFrom.mockImplementation(() => createChain());
    mockExtractTranscript.mockResolvedValue({
      transcript: null,
      source: null,
      truncated: false,
    });
  });

  it("returns 401 when not authenticated", async () => {
    mockNoUser();

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
  });

  it("polls a single feed and returns new episodes via batch upsert", async () => {
    mockUser();

    const feed = makeFeed();
    const newEpisode = {
      guid: "ep-new-1",
      title: "New Episode",
      description: "A brand new episode",
      audioUrl: "https://example.com/ep-new.mp3",
      publishedAt: new Date("2025-06-01"),
      durationSeconds: 1800,
      transcriptUrl: null,
    };

    mockPollFeed.mockResolvedValue({
      feed: {
        title: "Test Podcast",
        description: "A test podcast",
        imageUrl: null,
      },
      newEpisodes: [newEpisode],
      allEpisodes: [newEpisode],
      totalEpisodes: 5,
    });

    // 1. Fetch feed by id + user_id -> .select().eq().eq().single()
    mockFeedFetchById(feed);

    // 2. Fetch existing episode GUIDs -> .select("guid").eq("feed_id")
    mockExistingEpisodes(["ep-old-1"]);

    // 3. Batch upsert new episodes
    mockBatchEpisodeUpsert(1);

    // 3b. Duration backfill (1 episode with durationSeconds)
    mockDurationBackfill(1);

    // 4. Update feed metadata -> .update().eq()
    mockFeedUpdate();

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.polled).toBe(1);
    expect(json.newEpisodes).toBe(1);
  });

  it("polls all active feeds when no feedId provided", async () => {
    mockUser();

    const feeds = [
      makeFeed({ id: "feed-1" }),
      makeFeed({ id: "feed-2", feed_url: "https://example.com/feed2.xml" }),
    ];

    mockPollFeed.mockResolvedValue({
      feed: { title: "Podcast", description: null, imageUrl: null },
      newEpisodes: [],
      allEpisodes: [],
      totalEpisodes: 3,
    });

    // 1. Fetch all active feeds -> .select().eq(user_id).eq(is_active)
    mockActiveFeedsFetch(feeds);

    // 2. feed-1: existing episodes
    mockExistingEpisodes([]);

    // 3. feed-1: update metadata
    mockFeedUpdate();

    // 4. feed-2: existing episodes
    mockExistingEpisodes([]);

    // 5. feed-2: update metadata
    mockFeedUpdate();

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({}) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.polled).toBe(2);
  });

  it("returns 429 when feed was polled less than 15 minutes ago", async () => {
    mockUser();

    const recentPollTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const feed = makeFeed({ last_polled_at: recentPollTime });

    // Fetch feed -> .select().eq().eq().single()
    mockFeedFetchById(feed);

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toContain("polled recently");
  });

  it("auto-deactivates feed after 5 consecutive poll errors", async () => {
    mockUser();

    const feed = makeFeed({ poll_error_count: 4 });

    mockPollFeed.mockRejectedValue(new Error("Network timeout"));

    // 1. Fetch feed
    mockFeedFetchById(feed);

    // 2. Existing episode GUIDs
    mockExistingEpisodes([]);

    // 3. Update feed with error -- capture the payload
    let updatePayload: Record<string, unknown> | undefined;
    mockFeedUpdate((p) => {
      updatePayload = p;
    });

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.is_active).toBe(false);
    expect(updatePayload!.poll_error_count).toBe(5);
    expect(updatePayload!.poll_error).toBe("Network timeout");
  });

  it("calls extractTranscript for new episodes", async () => {
    mockUser();

    const feed = makeFeed();
    const newEpisode = {
      guid: "ep-tx-1",
      title: "Episode With Transcript",
      description: "Has a transcript available",
      audioUrl: "https://example.com/ep-tx.mp3",
      publishedAt: new Date("2025-06-01"),
      durationSeconds: 2400,
      transcriptUrl: "https://example.com/transcript.vtt",
    };

    mockPollFeed.mockResolvedValue({
      feed: { title: "Test Podcast", description: null, imageUrl: null },
      newEpisodes: [newEpisode],
      allEpisodes: [newEpisode],
      totalEpisodes: 5,
    });

    mockExtractTranscript.mockResolvedValue({
      transcript: "Hello, this is the transcript text.",
      source: "rss_description",
      truncated: false,
    });

    // 1. Fetch feed
    mockFeedFetchById(feed);

    // 2. Existing episodes
    mockExistingEpisodes([]);

    // 3. Batch upsert episode
    mockBatchEpisodeUpsert(1);

    // 3b. Duration backfill (1 episode with durationSeconds)
    mockDurationBackfill(1);

    // 4. Update feed metadata
    mockFeedUpdate();

    const { POST } = await import("../poll/route");
    await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );

    expect(mockExtractTranscript).toHaveBeenCalledWith({
      transcriptUrl: "https://example.com/transcript.vtt",
      description: "Has a transcript available",
      audioUrl: "https://example.com/ep-tx.mp3",
      podcastTitle: "Test Podcast",
    });
  });

  it("updates feed metadata on successful poll", async () => {
    mockUser();

    const feed = makeFeed({
      poll_error: "previous error",
      poll_error_count: 2,
    });
    const newEpisode = {
      guid: "ep-meta-1",
      title: "Latest Episode",
      description: null,
      audioUrl: "https://example.com/ep-meta.mp3",
      publishedAt: new Date("2025-07-15"),
      durationSeconds: 3600,
      transcriptUrl: null,
    };

    mockPollFeed.mockResolvedValue({
      feed: {
        title: "Updated Podcast Name",
        description: "New desc",
        imageUrl: "https://example.com/new-img.jpg",
      },
      newEpisodes: [newEpisode],
      allEpisodes: [newEpisode],
      totalEpisodes: 10,
    });

    // 1. Fetch feed
    mockFeedFetchById(feed);

    // 2. Existing episodes
    mockExistingEpisodes([]);

    // 3. Batch upsert episode
    mockBatchEpisodeUpsert(1);

    // 3b. Duration backfill (1 episode with durationSeconds)
    mockDurationBackfill(1);

    // 4. Update feed metadata -- capture the payload
    let updatePayload: Record<string, unknown> | undefined;
    mockFeedUpdate((p) => {
      updatePayload = p;
    });

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toBeDefined();
    expect(updatePayload!.last_polled_at).toBeDefined();
    expect(updatePayload!.poll_error).toBeNull();
    expect(updatePayload!.poll_error_count).toBe(0);
    expect(updatePayload!.last_episode_at).toBeDefined();
    expect(updatePayload!.title).toBe("Updated Podcast Name");
  });

  it("increments poll_error_count on poll failure", async () => {
    mockUser();

    const feed = makeFeed({ poll_error_count: 1 });

    mockPollFeed.mockRejectedValue(new Error("DNS resolution failed"));

    // 1. Fetch feed
    mockFeedFetchById(feed);

    // 2. Existing episodes
    mockExistingEpisodes([]);

    // 3. Update feed with error
    let updatePayload: Record<string, unknown> | undefined;
    mockFeedUpdate((p) => {
      updatePayload = p;
    });

    const { POST } = await import("../poll/route");
    await POST(
      makeRequest({ feedId: "feed-1" }) as Parameters<typeof POST>[0]
    );

    expect(updatePayload).toBeDefined();
    expect(updatePayload!.poll_error_count).toBe(2);
    expect(updatePayload!.poll_error).toBe("DNS resolution failed");
    expect(updatePayload!.is_active).toBeUndefined();
  });

  it("returns 404 when feed not found", async () => {
    mockUser();

    // Fetch feed -- not found
    mockFeedFetchById(null, { message: "Not found" });

    const { POST } = await import("../poll/route");
    const response = await POST(
      makeRequest({ feedId: "nonexistent-feed" }) as Parameters<typeof POST>[0]
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe("Feed not found");
  });
});
