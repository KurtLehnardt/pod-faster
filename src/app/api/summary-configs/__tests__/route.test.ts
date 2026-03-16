import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock data ──────────────────────────────────────────────

const TEST_USER = { id: "user-123", user_metadata: {} };
const TEST_CONFIG_ID = "config-abc";
const TEST_FEED_ID_1 = "11111111-1111-4111-a111-111111111111";
const TEST_FEED_ID_2 = "22222222-2222-4222-a222-222222222222";

const TEST_CONFIG = {
  id: TEST_CONFIG_ID,
  user_id: TEST_USER.id,
  name: "My Daily Summary",
  cadence: "daily",
  preferred_time: null,
  timezone: null,
  style: "monologue",
  tone: "serious",
  length_minutes: 10,
  voice_config: null,
  is_active: true,
  last_generated_at: null,
  next_due_at: "2026-03-16T00:00:00.000Z",
  created_at: "2026-03-15T00:00:00.000Z",
  updated_at: "2026-03-15T00:00:00.000Z",
};

const TEST_FEED_LINKS = [
  { summary_config_id: TEST_CONFIG_ID, feed_id: TEST_FEED_ID_1 },
  { summary_config_id: TEST_CONFIG_ID, feed_id: TEST_FEED_ID_2 },
];

const TEST_GENERATION_LOG = [
  {
    id: "log-1",
    summary_config_id: TEST_CONFIG_ID,
    user_id: TEST_USER.id,
    episode_id: null,
    status: "completed",
    error_message: null,
    feeds_included: 2,
    feeds_excluded: 0,
    episodes_summarized: 5,
    claude_tokens_used: 1000,
    elevenlabs_characters_used: 500,
    started_at: "2026-03-14T00:00:00.000Z",
    completed_at: "2026-03-14T00:05:00.000Z",
  },
];

// ── Mock state ─────────────────────────────────────────────

let mockUser: typeof TEST_USER | null = TEST_USER;

// Results that the mock chains resolve to
let mockListConfigsResult: { data: unknown[] | null; error: unknown };
let mockSingleConfigResult: { data: unknown; error: unknown };
let mockInsertConfigResult: { data: unknown; error: unknown };
let mockUpdateConfigResult: { error: unknown };
let mockDeleteConfigResult: { error: unknown };
let mockFeedLinksResult: { data: unknown[] | null; error: unknown };
let mockInsertFeedsResult: { error: unknown };
let mockDeleteFeedsResult: { error: unknown };
let mockLogsResult: { data: unknown[] | null; error: unknown };

function resetMockResults() {
  mockListConfigsResult = { data: [TEST_CONFIG], error: null };
  mockSingleConfigResult = { data: TEST_CONFIG, error: null };
  mockInsertConfigResult = { data: TEST_CONFIG, error: null };
  mockUpdateConfigResult = { error: null };
  mockDeleteConfigResult = { error: null };
  mockFeedLinksResult = { data: TEST_FEED_LINKS, error: null };
  mockInsertFeedsResult = { error: null };
  mockDeleteFeedsResult = { error: null };
  mockLogsResult = { data: TEST_GENERATION_LOG, error: null };
}

// ── Chainable mock builder ────────────────────────────────

/**
 * Creates a fluent Supabase query builder mock.
 * Every method returns itself so chains like .select().eq().order() work.
 * The terminal methods (.single(), or implicit result) resolve to the
 * provided result function.
 */
function chainMock(getResult: () => unknown) {
  const self: Record<string, unknown> = {};
  const methods = [
    "select", "insert", "update", "delete", "upsert",
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "not",
    "order", "limit", "range", "is",
  ];
  for (const m of methods) {
    self[m] = vi.fn(() => self);
  }
  // Terminal: single() returns the result
  self.single = vi.fn(() => getResult());
  // When the chain is used as a thenable (implicit await), return result
  self.then = (
    resolve: (val: unknown) => unknown,
    reject: (err: unknown) => unknown
  ) => {
    try {
      return Promise.resolve(getResult()).then(resolve, reject);
    } catch (err) {
      return Promise.reject(err).then(resolve, reject);
    }
  };
  return self;
}

const mockSupabase = {
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({ data: { user: mockUser }, error: null })
    ),
  },
  from: vi.fn((table: string) => {
    if (table === "summary_configs") {
      // We need to differentiate select vs insert vs update vs delete.
      // Strategy: return a chain where .select / .insert / .update / .delete
      // switch which result to return.
      const outer: Record<string, unknown> = {};

      // SELECT path: .select("*").eq(...).order(...) -> list result
      // or: .select("*").eq(...).eq(...).single() -> single result
      outer.select = vi.fn(() => {
        // After select, could be list or single query
        const selectChain = chainMock(() => mockListConfigsResult);
        // Override single() to use single result
        selectChain.single = vi.fn(() => mockSingleConfigResult);
        // Override order() to return list result directly
        selectChain.order = vi.fn(() => mockListConfigsResult);
        // Override eq to return another chain that can go either way
        selectChain.eq = vi.fn(() => {
          const eqChain = chainMock(() => mockListConfigsResult);
          eqChain.single = vi.fn(() => mockSingleConfigResult);
          eqChain.order = vi.fn(() => mockListConfigsResult);
          // Second eq (for ownership check)
          eqChain.eq = vi.fn(() => {
            const eq2Chain = chainMock(() => mockListConfigsResult);
            eq2Chain.single = vi.fn(() => mockSingleConfigResult);
            eq2Chain.order = vi.fn(() => mockListConfigsResult);
            return eq2Chain;
          });
          return eqChain;
        });
        return selectChain;
      });

      // INSERT path: .insert({...}).select().single()
      outer.insert = vi.fn(() => {
        const insertChain: Record<string, unknown> = {};
        insertChain.select = vi.fn(() => {
          const selectAfterInsert: Record<string, unknown> = {};
          selectAfterInsert.single = vi.fn(() => mockInsertConfigResult);
          return selectAfterInsert;
        });
        return insertChain;
      });

      // UPDATE path: .update({...}).eq(...)
      outer.update = vi.fn(() => {
        const updateChain: Record<string, unknown> = {};
        updateChain.eq = vi.fn(() => mockUpdateConfigResult);
        return updateChain;
      });

      // DELETE path: .delete().eq(...).eq(...)
      outer.delete = vi.fn(() => {
        const deleteChain: Record<string, unknown> = {};
        deleteChain.eq = vi.fn(() => {
          const eq2: Record<string, unknown> = {};
          eq2.eq = vi.fn(() => mockDeleteConfigResult);
          return eq2;
        });
        return deleteChain;
      });

      return outer;
    }

    if (table === "summary_config_feeds") {
      const outer: Record<string, unknown> = {};
      outer.select = vi.fn(() => {
        const selChain: Record<string, unknown> = {};
        selChain.eq = vi.fn(() => mockFeedLinksResult);
        selChain.in = vi.fn(() => mockFeedLinksResult);
        return selChain;
      });
      outer.insert = vi.fn(() => mockInsertFeedsResult);
      outer.delete = vi.fn(() => {
        const delChain: Record<string, unknown> = {};
        delChain.eq = vi.fn(() => mockDeleteFeedsResult);
        return delChain;
      });
      return outer;
    }

    if (table === "summary_generation_log") {
      return chainMock(() => mockLogsResult);
    }

    return chainMock(() => ({ data: null, error: null }));
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock("@/lib/pipeline/summary-pipeline", () => ({
  computeNextDueAt: vi.fn(() => "2026-03-16T00:00:00.000Z"),
}));

// ── Import routes after mocks ──────────────────────────────

const summaryConfigsRoute = await import("../route");
const summaryConfigDetailRoute = await import("../../summary-configs/[id]/route");

// ── Helpers ────────────────────────────────────────────────

function makeRequest(
  method: string,
  url: string,
  body?: unknown
): NextRequest {
  const init: Record<string, unknown> = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    init as ConstructorParameters<typeof NextRequest>[1]
  );
}

// ── Tests: GET /api/summary-configs ────────────────────────

describe("GET /api/summary-configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    resetMockResults();
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const res = await summaryConfigsRoute.GET();
    expect(res.status).toBe(401);
  });

  it("returns user's configs with linked feed IDs", async () => {
    const res = await summaryConfigsRoute.GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.configs).toHaveLength(1);
    expect(data.configs[0].id).toBe(TEST_CONFIG_ID);
    expect(data.configs[0].feedIds).toEqual([TEST_FEED_ID_1, TEST_FEED_ID_2]);
  });

  it("returns empty array when user has no configs", async () => {
    mockListConfigsResult = { data: [], error: null };
    const res = await summaryConfigsRoute.GET();
    const data = await res.json();
    expect(data.configs).toEqual([]);
  });

  it("returns 500 on database error", async () => {
    mockListConfigsResult = { data: null, error: { message: "DB error" } };
    const res = await summaryConfigsRoute.GET();
    expect(res.status).toBe(500);
  });
});

// ── Tests: POST /api/summary-configs ───────────────────────

describe("POST /api/summary-configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    resetMockResults();
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "Test",
      cadence: "daily",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      feedIds: [TEST_FEED_ID_1],
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(401);
  });

  it("creates config with valid body", async () => {
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "My Summary",
      cadence: "daily",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      feedIds: [TEST_FEED_ID_1, TEST_FEED_ID_2],
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.config.id).toBe(TEST_CONFIG_ID);
    expect(data.config.feedIds).toEqual([TEST_FEED_ID_1, TEST_FEED_ID_2]);
  });

  it("rejects invalid cadence", async () => {
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "Test",
      cadence: "hourly",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      feedIds: [TEST_FEED_ID_1],
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Validation failed");
  });

  it("rejects missing feedIds", async () => {
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "Test",
      cadence: "daily",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects empty feedIds array", async () => {
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "Test",
      cadence: "daily",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      feedIds: [],
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const req = new NextRequest(
      new URL("/api/summary-configs", "http://localhost:3000"),
      {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      } as ConstructorParameters<typeof NextRequest>[1]
    );
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 on insert error", async () => {
    mockInsertConfigResult = { data: null, error: { message: "Insert failed" } };
    const req = makeRequest("POST", "/api/summary-configs", {
      name: "Test",
      cadence: "daily",
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      feedIds: [TEST_FEED_ID_1],
    });
    const res = await summaryConfigsRoute.POST(req);
    expect(res.status).toBe(500);
  });
});

// ── Tests: GET /api/summary-configs/[id] ───────────────────

describe("GET /api/summary-configs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    resetMockResults();
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const req = makeRequest("GET", `/api/summary-configs/${TEST_CONFIG_ID}`);
    const res = await summaryConfigDetailRoute.GET(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns config with feeds and generation history", async () => {
    const req = makeRequest("GET", `/api/summary-configs/${TEST_CONFIG_ID}`);
    const res = await summaryConfigDetailRoute.GET(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.config.id).toBe(TEST_CONFIG_ID);
    expect(data.config.feeds).toBeDefined();
    expect(data.config.generationHistory).toBeDefined();
  });

  it("returns 404 for non-existent config", async () => {
    mockSingleConfigResult = { data: null, error: { message: "Not found" } };
    const req = makeRequest("GET", "/api/summary-configs/nonexistent");
    const res = await summaryConfigDetailRoute.GET(req, {
      params: Promise.resolve({ id: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Tests: PUT /api/summary-configs/[id] ───────────────────

describe("PUT /api/summary-configs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    resetMockResults();
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const req = makeRequest("PUT", `/api/summary-configs/${TEST_CONFIG_ID}`, {
      name: "Updated",
    });
    const res = await summaryConfigDetailRoute.PUT(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("updates config with valid body", async () => {
    const req = makeRequest("PUT", `/api/summary-configs/${TEST_CONFIG_ID}`, {
      name: "Updated Name",
    });
    const res = await summaryConfigDetailRoute.PUT(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 for other user's config", async () => {
    mockSingleConfigResult = { data: null, error: { message: "Not found" } };
    const req = makeRequest("PUT", `/api/summary-configs/${TEST_CONFIG_ID}`, {
      name: "Updated",
    });
    const res = await summaryConfigDetailRoute.PUT(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects invalid body", async () => {
    const req = makeRequest("PUT", `/api/summary-configs/${TEST_CONFIG_ID}`, {
      cadence: "hourly",
    });
    const res = await summaryConfigDetailRoute.PUT(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Tests: DELETE /api/summary-configs/[id] ────────────────

describe("DELETE /api/summary-configs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    resetMockResults();
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const req = makeRequest(
      "DELETE",
      `/api/summary-configs/${TEST_CONFIG_ID}`
    );
    const res = await summaryConfigDetailRoute.DELETE(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("deletes config successfully", async () => {
    const req = makeRequest(
      "DELETE",
      `/api/summary-configs/${TEST_CONFIG_ID}`
    );
    const res = await summaryConfigDetailRoute.DELETE(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.deleted).toBe(true);
  });

  it("returns 500 on delete error", async () => {
    mockDeleteConfigResult = { error: { message: "Delete failed" } };
    const req = makeRequest(
      "DELETE",
      `/api/summary-configs/${TEST_CONFIG_ID}`
    );
    const res = await summaryConfigDetailRoute.DELETE(req, {
      params: Promise.resolve({ id: TEST_CONFIG_ID }),
    });
    expect(res.status).toBe(500);
  });
});
