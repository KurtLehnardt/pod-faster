import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Test the API route validation logic directly. We import the route handlers
// and call them with mocked NextRequest objects and mocked Supabase clients.
// ---------------------------------------------------------------------------

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
// Mock Supabase server client
// ---------------------------------------------------------------------------

const mockAuthGetUser = vi.fn();
const mockSelectSingle = vi.fn();
const mockSelectAll = vi.fn();
const mockInsert = vi.fn();
const mockFromChain = vi.fn();

// Default handler for the "profiles" upsert that the POST route now performs
const mockProfilesUpsert = vi.fn().mockResolvedValue({ error: null });
const profilesChain = { upsert: mockProfilesUpsert };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: (...args: unknown[]) => mockAuthGetUser(...args),
    },
    from: (...args: unknown[]) => {
      const table = args[0] as string;
      if (table === "profiles") return profilesChain;
      return mockFromChain(...args);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock Supabase admin client (used by DELETE)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  }),
}));

// ---------------------------------------------------------------------------
// Mock pipeline orchestrator (used by generate route)
// ---------------------------------------------------------------------------

vi.mock("@/lib/pipeline/orchestrator", () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock ElevenLabs voices (used by voices route)
// ---------------------------------------------------------------------------

const mockListVoices = vi.fn();

vi.mock("@/lib/elevenlabs/voices", () => ({
  listVoices: () => mockListVoices(),
}));

vi.mock("@/lib/elevenlabs/client", () => {
  class ElevenLabsError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ElevenLabsError";
      this.status = status;
    }
  }
  return { ElevenLabsError };
});

// ---------------------------------------------------------------------------
// Mock search gatherer
// ---------------------------------------------------------------------------

const mockGatherNews = vi.fn();

vi.mock("@/lib/search/gatherer", () => ({
  gatherNews: (...args: unknown[]) => mockGatherNews(...args),
}));

// ---------------------------------------------------------------------------
// Helper: create a NextRequest-like object
// ---------------------------------------------------------------------------

function createRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const { method = "GET", body, headers = {} } = options;

  return {
    method,
    url,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: body !== undefined ? () => Promise.resolve(body) : () => Promise.reject(new Error("No body")),
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API Route Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/episodes", () => {
    let POST: (req: import("next/server").NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/episodes/route");
      POST = mod.POST;
    });

    it("returns 401 when user is not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test",
          style: "monologue",
          tone: "serious",
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 when topicQuery is missing", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          style: "monologue",
          tone: "serious",
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain("Invalid body");
    });

    it("returns 400 when style is invalid", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test topic",
          style: "invalid_style",
          tone: "serious",
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when tone is invalid", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test topic",
          style: "monologue",
          tone: "invalid_tone",
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when voiceConfig is missing", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test topic",
          style: "monologue",
          tone: "serious",
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when voiceConfig.voices is empty", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test topic",
          style: "monologue",
          tone: "serious",
          voiceConfig: { voices: [] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when lengthMinutes is out of range", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "Test topic",
          style: "monologue",
          tone: "serious",
          lengthMinutes: 60,
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 201 with valid payload", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const createdEpisode = {
        id: "ep-1",
        user_id: "user-123",
        topic_query: "AI trends",
        style: "monologue",
        tone: "serious",
        length_minutes: 5,
        status: "pending",
      };

      mockFromChain.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: createdEpisode,
              error: null,
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/episodes", {
        method: "POST",
        body: {
          topicQuery: "AI trends",
          style: "monologue",
          tone: "serious",
          lengthMinutes: 5,
          voiceConfig: { voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }] },
        },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.episode).toBeDefined();
      expect(data.episode.id).toBe("ep-1");
      expect(data.episode.status).toBe("pending");
    });
  });

  describe("GET /api/episodes", () => {
    let GET: (req: import("next/server").NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/episodes/route");
      GET = mod.GET;
    });

    it("returns 401 when user is not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = createRequest("http://localhost:3000/api/episodes");
      const res = await GET(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns episodes list for authenticated user", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({
                data: [
                  { id: "ep-1", title: "Episode 1", status: "completed" },
                ],
                error: null,
                count: 1,
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/episodes");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.episodes).toBeDefined();
      expect(data.episodes).toHaveLength(1);
      expect(data.pagination).toBeDefined();
    });
  });

  describe("POST /api/generate", () => {
    let POST: (req: import("next/server").NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/generate/route");
      POST = mod.POST;
    });

    it("returns 401 when user is not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = createRequest("http://localhost:3000/api/generate", {
        method: "POST",
        body: { episodeId: "ep-1" },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 when episodeId is missing", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const req = createRequest("http://localhost:3000/api/generate", {
        method: "POST",
        body: {},
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 404 when episode does not exist", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "Not found" },
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/generate", {
        method: "POST",
        body: { episodeId: "non-existent" },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Episode not found");
    });

    it("returns 409 when episode is already in progress", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "ep-1",
                  user_id: "user-123",
                  status: "scripting",
                  topic_query: "test",
                  style: "monologue",
                  tone: "serious",
                  length_minutes: 5,
                  voice_config: {
                    voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }],
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/generate", {
        method: "POST",
        body: { episodeId: "ep-1" },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("already scripting");
    });

    it("returns 200 for pending episode with valid voice config", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "ep-1",
                  user_id: "user-123",
                  status: "pending",
                  topic_query: "AI trends",
                  style: "monologue",
                  tone: "serious",
                  length_minutes: 5,
                  voice_config: {
                    voices: [{ role: "narrator", voice_id: "v1", name: "Alex" }],
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/generate", {
        method: "POST",
        body: { episodeId: "ep-1" },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.started).toBe(true);
      expect(data.episodeId).toBe("ep-1");
    });
  });

  describe("GET /api/voices", () => {
    let GET: () => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/voices/route");
      GET = mod.GET;
    });

    it("returns voice list on success", async () => {
      mockListVoices.mockResolvedValueOnce([
        { voice_id: "v1", name: "Alex", category: "premade" },
        { voice_id: "v2", name: "Jordan", category: "premade" },
      ]);

      const res = await GET();
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.voices).toHaveLength(2);
      expect(data.voices[0].name).toBe("Alex");
    });

    it("returns 500 on unknown error", async () => {
      mockListVoices.mockRejectedValueOnce(new Error("Unknown error"));

      const res = await GET();
      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toBe("Internal server error");
    });

    it("returns appropriate error for ElevenLabs API failure", async () => {
      const { ElevenLabsError } = await import("@/lib/elevenlabs/client");
      mockListVoices.mockRejectedValueOnce(
        new ElevenLabsError("Unauthorized", 401)
      );

      const res = await GET();
      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe("Failed to fetch voices");
    });
  });

  describe("POST /api/search", () => {
    let POST: (req: import("next/server").NextRequest) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/search/route");
      POST = mod.POST;
    });

    it("returns 401 when no authorization header", async () => {
      const req = createRequest("http://localhost:3000/api/search", {
        method: "POST",
        body: { query: "AI news" },
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 400 when query is missing", async () => {
      const req = createRequest("http://localhost:3000/api/search", {
        method: "POST",
        body: {},
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when query is empty", async () => {
      const req = createRequest("http://localhost:3000/api/search", {
        method: "POST",
        body: { query: "   " },
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns search results with valid query and auth", async () => {
      mockGatherNews.mockResolvedValueOnce([
        {
          title: "AI News",
          url: "https://example.com/ai",
          content: "Latest AI developments",
        },
      ]);

      const req = createRequest("http://localhost:3000/api/search", {
        method: "POST",
        body: { query: "AI trends" },
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.results).toBeDefined();
      expect(data.results).toHaveLength(1);
    });

    it("returns 502 when search fails", async () => {
      mockGatherNews.mockRejectedValueOnce(new Error("Search provider down"));

      const req = createRequest("http://localhost:3000/api/search", {
        method: "POST",
        body: { query: "AI trends" },
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(502);
    });
  });

  describe("GET /api/episodes/[id]", () => {
    let GET: (
      req: import("next/server").NextRequest,
      ctx: { params: Promise<{ id: string }> }
    ) => Promise<Response>;

    beforeEach(async () => {
      const mod = await import("@/app/api/episodes/[id]/route");
      GET = mod.GET;
    });

    it("returns 401 when user is not authenticated", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: null },
      });

      const req = createRequest("http://localhost:3000/api/episodes/ep-1");
      const res = await GET(req, { params: Promise.resolve({ id: "ep-1" }) });

      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent episode", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "Not found" },
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/episodes/non-existent");
      const res = await GET(req, {
        params: Promise.resolve({ id: "non-existent" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Episode not found");
    });

    it("returns episode data for valid request", async () => {
      mockAuthGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-123" } },
      });

      const episode = {
        id: "ep-1",
        user_id: "user-123",
        title: "Test Episode",
        status: "completed",
      };

      mockFromChain.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: episode,
                error: null,
              }),
            }),
          }),
        }),
      });

      const req = createRequest("http://localhost:3000/api/episodes/ep-1");
      const res = await GET(req, { params: Promise.resolve({ id: "ep-1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.episode.id).toBe("ep-1");
      expect(data.episode.title).toBe("Test Episode");
    });
  });
});
