import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock data ──────────────────────────────────────────────

const TEST_USER = { id: "user-123", user_metadata: {} };
const TEST_CONFIG_ID = "config-abc";

const TEST_CONFIG = {
  id: TEST_CONFIG_ID,
  user_id: TEST_USER.id,
  name: "My Summary",
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

// ── Mock state ─────────────────────────────────────────────

let mockUser: typeof TEST_USER | null = TEST_USER;
let mockConfigResult: { data: unknown; error: unknown } = {
  data: TEST_CONFIG,
  error: null,
};

const mockRunSummaryPipeline = vi.fn(() => Promise.resolve());

// ── Mock Supabase ──────────────────────────────────────────

const mockSupabase = {
  auth: {
    getUser: vi.fn(() =>
      Promise.resolve({ data: { user: mockUser }, error: null })
    ),
  },
  from: vi.fn((table: string) => {
    if (table === "summary_configs") {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = () => mockConfigResult;
      return chain;
    }
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock("@/lib/pipeline/summary-pipeline", () => ({
  runSummaryPipeline: (...args: Parameters<typeof mockRunSummaryPipeline>) =>
    mockRunSummaryPipeline(...args),
}));

// ── Import route after mocks ───────────────────────────────

const { POST } = await import("../route");

// ── Helpers ────────────────────────────────────────────────

function makeRequest(body?: unknown): NextRequest {
  const init: Record<string, unknown> = { method: "POST" };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(
    new URL("/api/generate-summary", "http://localhost:3000"),
    init as ConstructorParameters<typeof NextRequest>[1]
  );
}

// ── Tests ──────────────────────────────────────────────────

describe("POST /api/generate-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = TEST_USER;
    mockConfigResult = { data: TEST_CONFIG, error: null };
    mockRunSummaryPipeline.mockResolvedValue(undefined);
  });

  it("returns 401 without authenticated user", async () => {
    mockUser = null;
    const req = makeRequest({ summaryConfigId: TEST_CONFIG_ID });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest(
      new URL("/api/generate-summary", "http://localhost:3000"),
      {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      } as ConstructorParameters<typeof NextRequest>[1]
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing summaryConfigId", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("summaryConfigId");
  });

  it("returns 400 for empty summaryConfigId", async () => {
    const req = makeRequest({ summaryConfigId: "  " });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent config", async () => {
    mockConfigResult = {
      data: null,
      error: { message: "Not found" },
    };
    const req = makeRequest({ summaryConfigId: "nonexistent" });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 409 for inactive config", async () => {
    mockConfigResult = {
      data: { ...TEST_CONFIG, is_active: false },
      error: null,
    };
    const req = makeRequest({ summaryConfigId: TEST_CONFIG_ID });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("inactive");
  });

  it("triggers pipeline for valid active config", async () => {
    const req = makeRequest({ summaryConfigId: TEST_CONFIG_ID });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.started).toBe(true);
    expect(data.summaryConfigId).toBe(TEST_CONFIG_ID);
    expect(mockRunSummaryPipeline).toHaveBeenCalledOnce();
  });

  it("passes correct params to runSummaryPipeline", async () => {
    const configWithVoice = {
      ...TEST_CONFIG,
      voice_config: {
        voices: [
          { role: "host", voice_id: "v1", name: "Alice" },
        ],
      },
    };
    mockConfigResult = { data: configWithVoice, error: null };

    const req = makeRequest({ summaryConfigId: TEST_CONFIG_ID });
    await POST(req);

    expect(mockRunSummaryPipeline).toHaveBeenCalledWith({
      summaryConfigId: TEST_CONFIG_ID,
      userId: TEST_USER.id,
      style: "monologue",
      tone: "serious",
      lengthMinutes: 10,
      voiceConfig: {
        voices: [{ role: "host", voice_id: "v1", name: "Alice" }],
      },
    });
  });
});
