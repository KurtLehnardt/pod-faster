import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChain } from "@/__tests__/helpers/mock-supabase";

// -- Mock Supabase admin client ------------------------------------------------

const mockFrom = vi.fn(() => createChain());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

// -- Mock feature-gate ---------------------------------------------------------

const mockCheckFeatureAccess = vi.fn();

vi.mock("@/lib/auth/feature-gate", () => ({
  checkFeatureAccess: (...args: unknown[]) => mockCheckFeatureAccess(...args),
}));

// -- Mock transcription orchestrator -------------------------------------------

const mockCheckSttBudget = vi.fn();
const mockProcessTranscription = vi.fn();

vi.mock("@/lib/transcription/orchestrator", () => ({
  checkSttBudget: (...args: unknown[]) => mockCheckSttBudget(...args),
  processTranscription: (...args: unknown[]) =>
    mockProcessTranscription(...args),
}));

import { autoTranscribeNewEpisodes } from "@/lib/feeds/auto-transcribe";

// -- Helpers ------------------------------------------------------------------

/** Mock the feed lookup: from("podcast_feeds").select().eq().single() */
function mockFeedLookup(autoTranscribe: boolean, error: unknown = null) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.single.mockResolvedValue({
      data: error ? null : { auto_transcribe: autoTranscribe },
      error,
    });
    return chain;
  });
}

/**
 * Mock the episodes fetch:
 * from("feed_episodes").select().in().eq().not().limit()
 */
function mockEpisodesFetch(
  episodes: Array<{
    id: string;
    audio_url: string | null;
    duration_seconds: number | null;
  }>,
  error: unknown = null,
) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.limit.mockResolvedValue({ data: error ? null : episodes, error });
    return chain;
  });
}

/**
 * Mock the atomic claim:
 * from("feed_episodes").update().eq().eq().select().single()
 */
function mockClaimEpisode(
  claimed: { id: string } | null,
  error: unknown = null,
) {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    chain.single.mockResolvedValue({ data: claimed, error });
    return chain;
  });
}

/** Mock the failure status update: from("feed_episodes").update().eq() */
function mockFailureUpdate() {
  mockFrom.mockImplementationOnce(() => {
    const chain = createChain();
    // .update().eq() returns resolved chain (terminal)
    return chain;
  });
}

// -- Tests --------------------------------------------------------------------

describe("autoTranscribeNewEpisodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
    mockCheckFeatureAccess.mockReset();
    mockCheckSttBudget.mockReset();
    mockProcessTranscription.mockReset();
  });

  it("returns immediately when episode IDs array is empty", async () => {
    await autoTranscribeNewEpisodes("feed-1", "user-1", []);

    // No DB calls should have been made
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCheckFeatureAccess).not.toHaveBeenCalled();
    expect(mockCheckSttBudget).not.toHaveBeenCalled();
  });

  it("returns without processing when feed has auto_transcribe disabled", async () => {
    mockFeedLookup(false);

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    // Should have checked the feed but nothing else
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockCheckFeatureAccess).not.toHaveBeenCalled();
    expect(mockCheckSttBudget).not.toHaveBeenCalled();
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("returns without processing when user lacks premium access", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: false,
      requiredTier: "premium",
      currentTier: "free",
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockCheckFeatureAccess).toHaveBeenCalledWith(
      "user-1",
      "auto_transcribe",
    );
    expect(mockCheckSttBudget).not.toHaveBeenCalled();
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("returns without processing when STT budget is exhausted", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    mockCheckSttBudget.mockResolvedValue({
      allowed: false,
      usedMinutes: 120,
      limitMinutes: 120,
      remainingMinutes: 0,
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockCheckSttBudget).toHaveBeenCalledWith("user-1");
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("returns without processing when no episodes have audio_url", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    mockCheckSttBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 0,
      limitMinutes: 120,
      remainingMinutes: 120,
    });
    // Episodes query returns empty (filtered by .not("audio_url", "is", null))
    mockEpisodesFetch([]);

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("claims episode, calls processTranscription on happy path", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    mockCheckSttBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 10,
      limitMinutes: 120,
      remainingMinutes: 110,
    });
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 600 },
    ]);
    // Claim succeeds
    mockClaimEpisode({ id: "ep-1" });
    mockProcessTranscription.mockResolvedValue({
      success: true,
      transcript: "Hello world",
      costCents: 6.7,
      error: null,
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).toHaveBeenCalledWith({
      feedEpisodeId: "ep-1",
      userId: "user-1",
      audioUrl: "https://example.com/ep1.mp3",
      durationSeconds: 600,
    });
  });

  it("skips episode when another process already claimed it (claim race)", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    mockCheckSttBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 0,
      limitMinutes: 120,
      remainingMinutes: 120,
    });
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 300 },
    ]);
    // Claim fails (another process took it)
    mockClaimEpisode(null, { message: "No rows returned" });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    // processTranscription should NOT be called
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("marks episode as failed and continues loop when processTranscription throws", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    mockCheckSttBudget.mockResolvedValue({
      allowed: true,
      usedMinutes: 0,
      limitMinutes: 120,
      remainingMinutes: 120,
    });
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 300 },
      { id: "ep-2", audio_url: "https://example.com/ep2.mp3", duration_seconds: 600 },
    ]);

    // First episode: claim succeeds, processTranscription throws
    mockClaimEpisode({ id: "ep-1" });
    mockProcessTranscription.mockRejectedValueOnce(
      new Error("ElevenLabs API error: 500"),
    );
    // Failure update for ep-1
    mockFailureUpdate();

    // Second episode: claim succeeds, processTranscription succeeds
    mockClaimEpisode({ id: "ep-2" });
    mockProcessTranscription.mockResolvedValueOnce({
      success: true,
      transcript: "Second episode text",
      costCents: 4.0,
      error: null,
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1", "ep-2"]);

    // Both episodes should have been attempted
    expect(mockProcessTranscription).toHaveBeenCalledTimes(2);

    // Second episode should still have been processed despite first failure
    expect(mockProcessTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ feedEpisodeId: "ep-2" }),
    );
  });
});
