import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Supabase admin client ──────────────────────────────

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockUpdate = vi.fn();

// Chain builder for select queries
function createSelectChain(data: unknown[] | null, error: { message: string } | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnValue({ data, error }),
  };
  return chain;
}

// Chain builder for update queries
function createUpdateChain(error: { message: string } | null = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnValue({ error }),
  };
  return chain;
}

let selectChain: ReturnType<typeof createSelectChain>;
let updateChain: ReturnType<typeof createUpdateChain>;

const mockFrom = vi.fn().mockImplementation(() => {
  // Return the appropriate chain based on which method is called next
  return {
    select: (...args: unknown[]) => {
      selectChain.select(...args);
      return {
        eq: (...eqArgs: unknown[]) => {
          selectChain.eq(...eqArgs);
          return {
            eq: (...eq2Args: unknown[]) => {
              selectChain.eq(...eq2Args);
              return {
                gte: (...gteArgs: unknown[]) => selectChain.gte(...gteArgs),
              };
            },
          };
        },
      };
    },
    update: (...args: unknown[]) => {
      updateChain.update(...args);
      return {
        eq: (...eqArgs: unknown[]) => updateChain.eq(...eqArgs),
      };
    },
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

// ── Mock transcribeAudio ────────────────────────────────────

const mockTranscribeAudio = vi.fn();
vi.mock("../elevenlabs-stt", () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
}));

import {
  checkSttBudget,
  processTranscription,
  type TranscriptionJob,
} from "../orchestrator";

// ── Setup / teardown ────────────────────────────────────────

const originalSttLimit = process.env.STT_DAILY_LIMIT_MINUTES;

beforeEach(() => {
  vi.restoreAllMocks();
  mockFrom.mockClear();
  mockTranscribeAudio.mockReset();
  selectChain = createSelectChain([]);
  updateChain = createUpdateChain(null);
  delete process.env.STT_DAILY_LIMIT_MINUTES;
});

afterEach(() => {
  if (originalSttLimit !== undefined) {
    process.env.STT_DAILY_LIMIT_MINUTES = originalSttLimit;
  } else {
    delete process.env.STT_DAILY_LIMIT_MINUTES;
  }
});

// ── checkSttBudget ──────────────────────────────────────────

describe("checkSttBudget", () => {
  it("returns allowed when usage is under the default limit", async () => {
    // 30 minutes used (1800 seconds across 2 episodes)
    selectChain = createSelectChain([
      { duration_seconds: 900 },
      { duration_seconds: 900 },
    ]);

    const result = await checkSttBudget("user-123");

    expect(result.allowed).toBe(true);
    expect(result.usedMinutes).toBe(30);
    expect(result.limitMinutes).toBe(120);
    expect(result.remainingMinutes).toBe(90);
  });

  it("returns not allowed when usage exceeds limit", async () => {
    // 120 minutes used (7200 seconds)
    selectChain = createSelectChain([{ duration_seconds: 7200 }]);

    const result = await checkSttBudget("user-123");

    expect(result.allowed).toBe(false);
    expect(result.usedMinutes).toBe(120);
    expect(result.remainingMinutes).toBe(0);
  });

  it("returns allowed with zero usage", async () => {
    selectChain = createSelectChain([]);

    const result = await checkSttBudget("user-123");

    expect(result.allowed).toBe(true);
    expect(result.usedMinutes).toBe(0);
    expect(result.limitMinutes).toBe(120);
    expect(result.remainingMinutes).toBe(120);
  });

  it("uses STT_DAILY_LIMIT_MINUTES from env", async () => {
    process.env.STT_DAILY_LIMIT_MINUTES = "60";
    selectChain = createSelectChain([{ duration_seconds: 3000 }]);

    const result = await checkSttBudget("user-123");

    expect(result.limitMinutes).toBe(60);
    expect(result.usedMinutes).toBe(50);
    expect(result.remainingMinutes).toBe(10);
    expect(result.allowed).toBe(true);
  });

  it("defaults limit when STT_DAILY_LIMIT_MINUTES is invalid", async () => {
    process.env.STT_DAILY_LIMIT_MINUTES = "not-a-number";
    selectChain = createSelectChain([]);

    const result = await checkSttBudget("user-123");

    expect(result.limitMinutes).toBe(120);
  });

  it("handles null duration_seconds gracefully", async () => {
    selectChain = createSelectChain([
      { duration_seconds: null },
      { duration_seconds: 600 },
      { duration_seconds: null },
    ]);

    const result = await checkSttBudget("user-123");

    expect(result.usedMinutes).toBe(10);
    expect(result.allowed).toBe(true);
  });

  it("throws on Supabase query error", async () => {
    selectChain = createSelectChain(null, {
      message: "connection refused",
    });

    await expect(checkSttBudget("user-123")).rejects.toThrow(
      "Failed to check STT budget: connection refused"
    );
  });
});

// ── processTranscription ────────────────────────────────────

describe("processTranscription", () => {
  const baseJob: TranscriptionJob = {
    feedEpisodeId: "ep-001",
    userId: "user-123",
    audioUrl: "https://example.com/episode.mp3",
    durationSeconds: 300,
  };

  it("transcribes successfully and updates DB", async () => {
    // Budget check: no usage
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain(null);

    mockTranscribeAudio.mockResolvedValue({
      text: "Transcribed text content.",
      durationSeconds: 300,
      costCents: 3.35,
    });

    const result = await processTranscription(baseJob);

    expect(result.success).toBe(true);
    expect(result.transcript).toBe("Transcribed text content.");
    expect(result.costCents).toBe(3.35);
    expect(result.error).toBeNull();

    // Should have called transcribeAudio with the right URL
    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      "https://example.com/episode.mp3"
    );
  });

  it("returns error when budget is exceeded", async () => {
    // Budget check: over limit
    selectChain = createSelectChain([{ duration_seconds: 7200 }]);

    const result = await processTranscription(baseJob);

    expect(result.success).toBe(false);
    expect(result.transcript).toBeNull();
    expect(result.costCents).toBe(0);
    expect(result.error).toBe("Daily STT budget exceeded");

    // Should NOT have called transcribeAudio
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it("handles transcription failure and sets error status", async () => {
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain(null);

    mockTranscribeAudio.mockRejectedValue(
      new Error("ElevenLabs API error: 500 Internal Server Error")
    );

    const result = await processTranscription(baseJob);

    expect(result.success).toBe(false);
    expect(result.transcript).toBeNull();
    expect(result.costCents).toBe(0);
    expect(result.error).toBe(
      "ElevenLabs API error: 500 Internal Server Error"
    );
  });

  it("handles non-Error thrown from transcription", async () => {
    selectChain = createSelectChain([]);
    updateChain = createUpdateChain(null);

    mockTranscribeAudio.mockRejectedValue("string error");

    const result = await processTranscription(baseJob);

    expect(result.success).toBe(false);
    expect(result.error).toBe("string error");
  });
});
