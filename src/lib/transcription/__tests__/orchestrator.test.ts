import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase admin client ──────────────────────────────

function createUpdateChain(error: { message: string } | null = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnValue({ error }),
  };
  return chain;
}

let updateChain: ReturnType<typeof createUpdateChain>;

const mockFrom = vi.fn().mockImplementation(() => {
  return {
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

// ── Mock tier-budget ────────────────────────────────────────

const mockCheckTierBudget = vi.fn();
vi.mock("../tier-budget", () => ({
  checkTierBudget: (...args: unknown[]) => mockCheckTierBudget(...args),
}));

// ── Mock elevenlabs-stt ─────────────────────────────────────

const mockTranscribeAudio = vi.fn();
const mockTranscribeAudioBlob = vi.fn();
const mockCalculateSttCost = vi.fn();

vi.mock("../elevenlabs-stt", () => ({
  transcribeAudio: (...args: unknown[]) => mockTranscribeAudio(...args),
  transcribeAudioBlob: (...args: unknown[]) => mockTranscribeAudioBlob(...args),
  calculateSttCost: (...args: unknown[]) => mockCalculateSttCost(...args),
}));

// ── Mock audio-slicer ───────────────────────────────────────

const mockSliceAudio = vi.fn();
vi.mock("../audio-slicer", () => ({
  sliceAudio: (...args: unknown[]) => mockSliceAudio(...args),
}));

import {
  processTranscription,
  type TranscriptionJob,
} from "../orchestrator";

// ── Setup ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockClear();
  updateChain = createUpdateChain(null);
  mockCheckTierBudget.mockReset();
  mockTranscribeAudio.mockReset();
  mockTranscribeAudioBlob.mockReset();
  mockCalculateSttCost.mockReset();
  mockSliceAudio.mockReset();

  // Default: calculateSttCost returns something reasonable
  mockCalculateSttCost.mockReturnValue(3.35);
});

/** Helper: mock budget check as allowed. */
function budgetAllowed() {
  mockCheckTierBudget.mockResolvedValue({
    allowed: true,
    reason: null,
    usedCentsThisMonth: 50,
    remainingCents: 950,
    weeklyClipsUsed: 0,
  });
}

/** Helper: mock budget check as denied. */
function budgetDenied(reason: string) {
  mockCheckTierBudget.mockResolvedValue({
    allowed: false,
    reason,
    usedCentsThisMonth: 1000,
    remainingCents: 0,
    weeklyClipsUsed: 1,
  });
}

// ── processTranscription ────────────────────────────────────

describe("processTranscription", () => {
  const proJob: TranscriptionJob = {
    feedEpisodeId: "ep-001",
    userId: "user-123",
    audioUrl: "https://example.com/episode.mp3",
    durationSeconds: 300,
    tier: "pro",
  };

  const freeJob: TranscriptionJob = {
    feedEpisodeId: "ep-002",
    userId: "user-456",
    audioUrl: "https://example.com/episode.mp3",
    durationSeconds: 3600,
    tier: "free",
  };

  it("pro tier: full transcription success", async () => {
    budgetAllowed();
    mockTranscribeAudio.mockResolvedValue({
      text: "Full transcript text.",
      durationSeconds: 300,
      costCents: 3.35,
    });

    const result = await processTranscription(proJob);

    expect(result.success).toBe(true);
    expect(result.transcript).toBe("Full transcript text.");
    expect(result.costCents).toBe(3.35);
    expect(result.isPartial).toBe(false);
    expect(result.clipRange).toBeNull();
    expect(result.error).toBeNull();

    expect(mockTranscribeAudio).toHaveBeenCalledWith(proJob.audioUrl);
    expect(mockSliceAudio).not.toHaveBeenCalled();
    expect(mockTranscribeAudioBlob).not.toHaveBeenCalled();
  });

  it("free tier: partial transcription via sliceAudio + transcribeAudioBlob", async () => {
    budgetAllowed();
    const fakeBlob = new Blob([new Uint8Array([0xff])]);
    mockSliceAudio.mockResolvedValue({
      audioBlob: fakeBlob,
      startSeconds: 300,
      endSeconds: 600,
    });
    mockTranscribeAudioBlob.mockResolvedValue({
      text: "Partial clip text.",
      durationSeconds: 295,
      costCents: 3.35,
    });

    const result = await processTranscription(freeJob);

    expect(result.success).toBe(true);
    expect(result.transcript).toBe("Partial clip text.");
    expect(result.isPartial).toBe(true);
    expect(result.clipRange).toBe("300-600");
    expect(result.error).toBeNull();

    expect(mockSliceAudio).toHaveBeenCalledWith(freeJob.audioUrl, freeJob.durationSeconds);
    expect(mockTranscribeAudioBlob).toHaveBeenCalledWith(fakeBlob);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it("returns error when budget is exceeded", async () => {
    budgetDenied("Monthly cap reached for pro tier");

    const result = await processTranscription(proJob);

    expect(result.success).toBe(false);
    expect(result.transcript).toBeNull();
    expect(result.costCents).toBe(0);
    expect(result.error).toBe("Monthly cap reached for pro tier");

    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(mockSliceAudio).not.toHaveBeenCalled();
  });

  it("handles transcription failure and sets error status", async () => {
    budgetAllowed();
    mockTranscribeAudio.mockRejectedValue(
      new Error("ElevenLabs API error: 500 Internal Server Error")
    );

    const result = await processTranscription(proJob);

    expect(result.success).toBe(false);
    expect(result.transcript).toBeNull();
    expect(result.costCents).toBe(0);
    expect(result.error).toBe(
      "ElevenLabs API error: 500 Internal Server Error"
    );
    expect(result.isPartial).toBe(false);
  });

  it("handles non-Error thrown from transcription", async () => {
    budgetAllowed();
    mockTranscribeAudio.mockRejectedValue("string error");

    const result = await processTranscription(proJob);

    expect(result.success).toBe(false);
    expect(result.error).toBe("string error");
  });

  it("calls checkTierBudget with correct tier and estimated cost", async () => {
    budgetAllowed();
    mockCalculateSttCost.mockReturnValue(3.35);
    mockTranscribeAudio.mockResolvedValue({
      text: "text",
      durationSeconds: 300,
      costCents: 3.35,
    });

    await processTranscription(proJob);

    expect(mockCheckTierBudget).toHaveBeenCalledWith("user-123", "pro", 3.35);
  });

  it("free tier uses clipped duration for cost estimation", async () => {
    budgetAllowed();
    mockCalculateSttCost.mockReturnValue(3.35);
    mockSliceAudio.mockResolvedValue({
      audioBlob: new Blob([]),
      startSeconds: 300,
      endSeconds: 600,
    });
    mockTranscribeAudioBlob.mockResolvedValue({
      text: "clip",
      durationSeconds: 300,
      costCents: 3.35,
    });

    await processTranscription(freeJob);

    // For free tier with 3600s episode, should estimate cost for 300s (clip), not 3600s
    expect(mockCalculateSttCost).toHaveBeenCalledWith(300);
  });
});
