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

// -- Mock tier-budget ----------------------------------------------------------

const mockCheckTierBudget = vi.fn();

vi.mock("@/lib/transcription/tier-budget", () => ({
  checkTierBudget: (...args: unknown[]) => mockCheckTierBudget(...args),
}));

// -- Mock transcription orchestrator -------------------------------------------

const mockProcessTranscription = vi.fn();

vi.mock("@/lib/transcription/orchestrator", () => ({
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
    return chain;
  });
}

/** Helper: mock tier budget as allowed. */
function tierBudgetAllowed() {
  mockCheckTierBudget.mockResolvedValue({
    allowed: true,
    reason: null,
    usedCentsThisMonth: 50,
    remainingCents: 4950,
    weeklyClipsUsed: 0,
  });
}

/** Helper: mock tier budget as denied. */
function tierBudgetDenied() {
  mockCheckTierBudget.mockResolvedValue({
    allowed: false,
    reason: "Monthly budget exhausted",
    usedCentsThisMonth: 5000,
    remainingCents: 0,
    weeklyClipsUsed: 0,
  });
}

// -- Tests --------------------------------------------------------------------

describe("autoTranscribeNewEpisodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChain());
    mockCheckFeatureAccess.mockReset();
    mockCheckTierBudget.mockReset();
    mockProcessTranscription.mockReset();
  });

  it("returns immediately when episode IDs array is empty", async () => {
    await autoTranscribeNewEpisodes("feed-1", "user-1", []);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCheckFeatureAccess).not.toHaveBeenCalled();
    expect(mockCheckTierBudget).not.toHaveBeenCalled();
  });

  it("returns without processing when feed has auto_transcribe disabled", async () => {
    mockFeedLookup(false);

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockCheckFeatureAccess).not.toHaveBeenCalled();
    expect(mockCheckTierBudget).not.toHaveBeenCalled();
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
    expect(mockCheckTierBudget).not.toHaveBeenCalled();
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("returns without processing when tier budget is exhausted", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetDenied();

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockCheckTierBudget).toHaveBeenCalledWith("user-1", "premium");
    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("returns without processing when no episodes have audio_url", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetAllowed();
    mockEpisodesFetch([]);

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("claims episode, calls processTranscription with tier:'premium'", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetAllowed();
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 600 },
    ]);
    mockClaimEpisode({ id: "ep-1" });
    mockProcessTranscription.mockResolvedValue({
      success: true,
      transcript: "Hello world",
      costCents: 6.7,
      error: null,
      isPartial: false,
      clipRange: null,
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).toHaveBeenCalledWith({
      feedEpisodeId: "ep-1",
      userId: "user-1",
      audioUrl: "https://example.com/ep1.mp3",
      durationSeconds: 600,
      tier: "premium",
    });
  });

  it("skips episode when another process already claimed it (claim race)", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetAllowed();
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 300 },
    ]);
    mockClaimEpisode(null, { message: "No rows returned" });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).not.toHaveBeenCalled();
  });

  it("marks episode as failed when processTranscription returns success:false", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetAllowed();
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 600 },
    ]);
    mockClaimEpisode({ id: "ep-1" });
    mockProcessTranscription.mockResolvedValue({
      success: false,
      transcript: null,
      costCents: 0,
      error: "Budget exhausted",
      isPartial: false,
      clipRange: null,
    });
    mockFailureUpdate();

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1"]);

    expect(mockProcessTranscription).toHaveBeenCalledTimes(1);

    // calls: feed lookup, episodes fetch, claim, failure update = 4 total
    expect(mockFrom).toHaveBeenCalledTimes(4);
    const failureChain = mockFrom.mock.results[3].value;
    expect(failureChain.update).toHaveBeenCalledWith({
      transcription_status: "failed",
      transcription_error: "Budget exhausted",
    });
    expect(failureChain.eq).toHaveBeenCalledWith("id", "ep-1");
  });

  it("marks episode as failed and continues loop when processTranscription throws", async () => {
    mockFeedLookup(true);
    mockCheckFeatureAccess.mockResolvedValue({
      allowed: true,
      requiredTier: "premium",
      currentTier: "premium",
    });
    tierBudgetAllowed();
    mockEpisodesFetch([
      { id: "ep-1", audio_url: "https://example.com/ep1.mp3", duration_seconds: 300 },
      { id: "ep-2", audio_url: "https://example.com/ep2.mp3", duration_seconds: 600 },
    ]);

    // First episode: claim succeeds, processTranscription throws
    mockClaimEpisode({ id: "ep-1" });
    mockProcessTranscription.mockRejectedValueOnce(
      new Error("ElevenLabs API error: 500"),
    );
    mockFailureUpdate();

    // Second episode: claim succeeds, processTranscription succeeds
    mockClaimEpisode({ id: "ep-2" });
    mockProcessTranscription.mockResolvedValueOnce({
      success: true,
      transcript: "Second episode text",
      costCents: 4.0,
      error: null,
      isPartial: false,
      clipRange: null,
    });

    await autoTranscribeNewEpisodes("feed-1", "user-1", ["ep-1", "ep-2"]);

    expect(mockProcessTranscription).toHaveBeenCalledTimes(2);
    expect(mockProcessTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ feedEpisodeId: "ep-2", tier: "premium" }),
    );
  });
});
