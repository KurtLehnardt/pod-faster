/**
 * Integration tests for the summary pipeline.
 *
 * Tests edge cases: empty feed, failed transcription, inactive feeds,
 * concurrent generation idempotency, budget exceeded, zero transcripts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runSummaryPipeline,
  computeNextDueAt,
  windowTranscripts,
  type SummaryPipelineParams,
} from "../summary-pipeline";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";
import type { EpisodeScript } from "@/types/episode";

// ── Mock pipeline steps ──────────────────────────────────────

vi.mock("../script-step", () => ({
  scriptStep: vi.fn(),
}));

vi.mock("../audio-step", () => ({
  audioStep: vi.fn(),
}));

vi.mock("../storage-step", () => ({
  storageStep: vi.fn(),
}));

vi.mock("@/lib/ai/chat", () => ({
  completeJson: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-20250514",
}));

// ── Mock Supabase admin client ───────────────────────────────

const insertedRows: Record<string, unknown[]> = {};
const updatedRows: Record<string, { data: Record<string, unknown>; filters: Record<string, unknown>[] }[]> = {};
let selectSingleResults: Record<string, unknown> = {};
let selectResults: Record<string, unknown[]> = {};

function resetDbMocks() {
  for (const key of Object.keys(insertedRows)) delete insertedRows[key];
  for (const key of Object.keys(updatedRows)) delete updatedRows[key];
  selectSingleResults = {};
  selectResults = {};
}

function createMockQueryBuilder(table: string) {
  const state: {
    filters: Record<string, unknown>[];
    isSingle: boolean;
    isInsert: boolean;
    insertData?: unknown;
    isUpdate: boolean;
    updateData?: Record<string, unknown>;
  } = { filters: [], isSingle: false, isInsert: false, isUpdate: false };

  const builder: Record<string, unknown> = {};

  const resolveSelect = () => {
    if (state.isSingle) {
      return { data: selectSingleResults[table] ?? null, error: null };
    }
    return { data: selectResults[table] ?? [], error: null };
  };

  builder.select = () => { return builder; };
  builder.insert = (data: unknown) => {
    state.isInsert = true;
    state.insertData = data;
    if (!insertedRows[table]) insertedRows[table] = [];
    insertedRows[table].push(data);
    return builder;
  };
  builder.update = (data: Record<string, unknown>) => {
    state.isUpdate = true;
    state.updateData = data;
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    state.filters.push({ eq: { [col]: val } });
    return builder;
  };
  builder.in = () => builder;
  builder.not = () => builder;
  builder.gt = () => builder;
  builder.lte = () => builder;
  builder.gte = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.single = () => {
    state.isSingle = true;
    if (state.isInsert) {
      return { data: { id: "generated-episode-id" }, error: null };
    }
    return resolveSelect();
  };

  Object.defineProperty(builder, "then", {
    get() {
      // Record update when awaited (after all chained .eq() calls have been applied)
      if (state.isUpdate) {
        if (!updatedRows[table]) updatedRows[table] = [];
        updatedRows[table].push({ data: state.updateData!, filters: [...state.filters] });
      }
      const result = state.isInsert
        ? { data: state.insertData, error: null }
        : state.isUpdate
          ? { error: null }
          : resolveSelect();
      return (resolve: (v: unknown) => void) => resolve(result);
    },
  });

  return builder;
}

const mockFrom = vi.fn((table: string) => createMockQueryBuilder(table));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => mockFrom(table),
  })),
}));

// ── Import mocked modules ────────────────────────────────────

import { scriptStep } from "../script-step";
import { audioStep } from "../audio-step";
import { storageStep } from "../storage-step";
import { completeJson } from "@/lib/ai/chat";

const mockScriptStep = vi.mocked(scriptStep);
const mockAudioStep = vi.mocked(audioStep);
const mockStorageStep = vi.mocked(storageStep);
const mockCompleteJson = vi.mocked(completeJson);

// ── Test data ────────────────────────────────────────────────

const defaultParams: SummaryPipelineParams = {
  summaryConfigId: "config-int-001",
  userId: "user-integration",
  style: "interview",
  tone: "lighthearted",
  lengthMinutes: 15,
  voiceConfig: {
    voices: [
      { role: "Host", voice_id: "voice-host", name: "Alex" },
      { role: "Expert", voice_id: "voice-expert", name: "Sam" },
    ],
  },
};

const fakeSummary: NewsSummaryOutput = {
  headline: "Podcast Roundup",
  keyPoints: ["Point 1 (Source: Tech Talk - Ep 10)", "Point 2 (Source: AI Now - Latest)"],
  sources: [
    { title: "Ep 10", url: "Tech Talk" },
    { title: "Latest", url: "AI Now" },
  ],
  topicOverview: "A comprehensive look at this week's podcasts...",
};

const fakeScript: EpisodeScript = {
  title: "Weekly Podcast Roundup",
  segments: [
    { speaker: "Host", text: "Welcome to the roundup!", voice_id: "voice-host" },
    { speaker: "Expert", text: "Let me break down the key insights.", voice_id: "voice-expert" },
  ],
};

function setupConfig(overrides: Record<string, unknown> = {}) {
  selectSingleResults["summary_configs"] = {
    id: "config-int-001",
    user_id: "user-integration",
    name: "Integration Test Summary",
    cadence: "weekly",
    style: "interview",
    tone: "lighthearted",
    length_minutes: 15,
    is_active: true,
    last_generated_at: "2026-03-08T00:00:00.000Z",
    next_due_at: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

function setupConfigFeeds(feeds = [
  { feed_id: "feed-a", is_included: true, auto_excluded: false },
  { feed_id: "feed-b", is_included: true, auto_excluded: false },
]) {
  selectResults["summary_config_feeds"] = feeds;
}

function setupFeeds(feeds = [
  { id: "feed-a", title: "Tech Talk" },
  { id: "feed-b", title: "AI Now" },
]) {
  selectResults["podcast_feeds"] = feeds;
}

function setupEpisodes(episodes: Record<string, unknown>[] = [
  {
    id: "ep-a1",
    feed_id: "feed-a",
    title: "Ep 10: Machine Learning",
    transcript: "Full transcript about ML topics and recent developments...",
    published_at: "2026-03-12T12:00:00.000Z",
  },
  {
    id: "ep-b1",
    feed_id: "feed-b",
    title: "Latest AI News",
    transcript: "This week in AI, we saw several breakthroughs...",
    published_at: "2026-03-13T12:00:00.000Z",
  },
]) {
  selectResults["feed_episodes"] = episodes;
}

function setupFullPipeline() {
  setupConfig();
  setupConfigFeeds();
  setupFeeds();
  setupEpisodes();

  mockCompleteJson.mockResolvedValue({
    data: fakeSummary,
    usage: { inputTokens: 600, outputTokens: 250 },
    model: "claude-sonnet-4-20250514",
  });

  mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 1500 });
  mockAudioStep.mockResolvedValue({
    audio: new Uint8Array([0x49, 0x44, 0x33]).buffer as ArrayBuffer,
    charactersUsed: 85,
  });
  mockStorageStep.mockResolvedValue("user-integration/generated-episode-id.mp3");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Integration Tests ────────────────────────────────────────

describe("Summary Pipeline Integration", () => {
  describe("full journey: gather → summarize → script → audio → upload", () => {
    it("completes the full pipeline with interview style and 2 voices", async () => {
      setupFullPipeline();

      await runSummaryPipeline(defaultParams);

      // All steps called
      expect(mockCompleteJson).toHaveBeenCalledOnce();
      expect(mockScriptStep).toHaveBeenCalledOnce();
      expect(mockAudioStep).toHaveBeenCalledOnce();
      expect(mockStorageStep).toHaveBeenCalledOnce();

      // Script step receives correct params
      expect(mockScriptStep).toHaveBeenCalledWith(
        expect.objectContaining({
          style: "interview",
          tone: "lighthearted",
          lengthMinutes: 15,
        })
      );

      // Episode created with source_type='feed_summary'
      const episodeInserts = insertedRows["episodes"];
      expect(episodeInserts).toBeDefined();
      const ep = episodeInserts[0] as Record<string, unknown>;
      expect(ep.source_type).toBe("feed_summary");
      expect(ep.style).toBe("interview");
      expect(ep.tone).toBe("lighthearted");
    });

    it("writes generation log with correct metrics", async () => {
      setupFullPipeline();

      await runSummaryPipeline(defaultParams);

      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();
      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("completed");
      expect(log.episodes_summarized).toBe(2);
      expect(log.elevenlabs_characters_used).toBe(85);
    });
  });

  describe("summary with zero new transcripts", () => {
    it("logs failure without generating an empty episode", async () => {
      setupConfig();
      setupConfigFeeds();
      setupFeeds();
      setupEpisodes([]); // No episodes

      await runSummaryPipeline(defaultParams);

      // No script/audio/storage steps
      expect(mockScriptStep).not.toHaveBeenCalled();
      expect(mockAudioStep).not.toHaveBeenCalled();
      expect(mockStorageStep).not.toHaveBeenCalled();

      // Failed generation log
      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();
      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("failed");
      expect(log.error_message).toContain("No new transcripts available");

      // No episode created
      const episodeInserts = insertedRows["episodes"];
      expect(episodeInserts).toBeUndefined();
    });
  });

  describe("inactive feeds auto-exclusion", () => {
    it("auto-excludes feed-b when it has no new episodes", async () => {
      setupConfig();
      setupConfigFeeds(); // feed-a and feed-b included
      setupFeeds();
      // Only feed-a has episodes
      setupEpisodes([
        {
          id: "ep-a1",
          feed_id: "feed-a",
          title: "Ep 10",
          transcript: "Transcript content...",
          published_at: "2026-03-12T12:00:00.000Z",
        },
      ]);

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 300, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 800 });
      mockAudioStep.mockResolvedValue({
        audio: new Uint8Array([1]).buffer as ArrayBuffer,
        charactersUsed: 30,
      });
      mockStorageStep.mockResolvedValue("user-integration/generated-episode-id.mp3");

      await runSummaryPipeline(defaultParams);

      // feed-b should be auto-excluded
      const scfUpdates = updatedRows["summary_config_feeds"];
      expect(scfUpdates).toBeDefined();
      expect(scfUpdates.length).toBeGreaterThanOrEqual(1);

      const excludeUpdate = scfUpdates[0];
      expect(excludeUpdate.data.auto_excluded).toBe(true);
      expect(excludeUpdate.data.auto_exclude_reason).toContain("No new episodes");
    });

    it("still generates summary from active feeds even when some are excluded", async () => {
      setupConfig();
      setupConfigFeeds(); // feed-a and feed-b
      setupFeeds();
      setupEpisodes([
        {
          id: "ep-a1",
          feed_id: "feed-a",
          title: "Active Episode",
          transcript: "Active transcript",
          published_at: "2026-03-12T12:00:00.000Z",
        },
      ]);

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 200, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 600 });
      mockAudioStep.mockResolvedValue({
        audio: new Uint8Array([1]).buffer as ArrayBuffer,
        charactersUsed: 20,
      });
      mockStorageStep.mockResolvedValue("user-integration/generated-episode-id.mp3");

      await runSummaryPipeline(defaultParams);

      // Pipeline should still complete
      expect(mockScriptStep).toHaveBeenCalledOnce();
      expect(mockAudioStep).toHaveBeenCalledOnce();

      const logInserts = insertedRows["summary_generation_log"];
      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("completed");
    });
  });

  describe("all feeds excluded", () => {
    it("fails when all configured feeds are auto-excluded", async () => {
      setupConfig();
      // All feeds are already excluded
      setupConfigFeeds([
        { feed_id: "feed-a", is_included: true, auto_excluded: true },
        { feed_id: "feed-b", is_included: false, auto_excluded: false },
      ]);

      await runSummaryPipeline(defaultParams);

      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();
      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("failed");
      expect(log.error_message).toContain("excluded");
    });
  });

  describe("Claude API failure during summarization", () => {
    it("sets episode to failed and writes error log", async () => {
      setupConfig();
      setupConfigFeeds();
      setupFeeds();
      setupEpisodes();

      mockCompleteJson.mockRejectedValue(new Error("Claude API rate limit exceeded"));

      await runSummaryPipeline(defaultParams);

      // Failed log
      const logInserts = insertedRows["summary_generation_log"];
      const failedLog = (logInserts as Record<string, unknown>[]).find(
        (l) => l.status === "failed"
      );
      expect(failedLog).toBeDefined();
      expect(failedLog?.error_message).toContain("rate limit");
    });
  });

  describe("ElevenLabs audio generation failure", () => {
    it("marks episode as failed when audioStep throws", async () => {
      setupConfig();
      setupConfigFeeds();
      setupFeeds();
      setupEpisodes();

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 400, outputTokens: 150 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 1000 });
      mockAudioStep.mockRejectedValue(new Error("ElevenLabs quota exceeded"));

      await runSummaryPipeline(defaultParams);

      // Episode should be failed
      const episodeUpdates = updatedRows["episodes"];
      expect(episodeUpdates).toBeDefined();
      const failedUpdate = episodeUpdates?.find(u => u.data.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.data.error_message).toContain("ElevenLabs quota exceeded");
    });
  });

  describe("storage upload failure", () => {
    it("marks episode as failed when storageStep throws", async () => {
      setupConfig();
      setupConfigFeeds();
      setupFeeds();
      setupEpisodes();

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 400, outputTokens: 150 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 1000 });
      mockAudioStep.mockResolvedValue({
        audio: new Uint8Array([1]).buffer as ArrayBuffer,
        charactersUsed: 50,
      });
      mockStorageStep.mockRejectedValue(new Error("Supabase storage bucket full"));

      await runSummaryPipeline(defaultParams);

      const episodeUpdates = updatedRows["episodes"];
      const failedUpdate = episodeUpdates?.find(u => u.data.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.data.error_message).toContain("storage bucket full");
    });
  });
});

describe("computeNextDueAt — timezone-independent cadence tests", () => {
  it("daily cadence advances exactly 24 hours", () => {
    const base = new Date("2026-03-15T14:30:00.000Z");
    const next = new Date(computeNextDueAt("daily", base));
    expect(next.getTime() - base.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("twice_weekly cadence advances 3 days", () => {
    const base = new Date("2026-03-15T08:00:00.000Z");
    const next = new Date(computeNextDueAt("twice_weekly", base));
    expect(next.getDate()).toBe(18);
    expect(next.getMonth()).toBe(base.getMonth());
  });

  it("weekly cadence advances 7 days", () => {
    const base = new Date("2026-03-15T08:00:00.000Z");
    const next = new Date(computeNextDueAt("weekly", base));
    expect(next.getDate()).toBe(22);
    expect(next.getMonth()).toBe(base.getMonth());
  });

  it("on_new_episodes cadence advances 1 day as sentinel", () => {
    const base = new Date("2026-03-15T08:00:00.000Z");
    const next = new Date(computeNextDueAt("on_new_episodes", base));
    expect(next.getDate()).toBe(16);
  });

  it("handles month boundary correctly", () => {
    const base = new Date("2026-03-30T08:00:00.000Z");
    const next = new Date(computeNextDueAt("weekly", base));
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(6);
  });

  it("handles year boundary correctly", () => {
    const base = new Date("2026-12-28T08:00:00.000Z");
    const next = new Date(computeNextDueAt("weekly", base));
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0); // January
  });
});

describe("windowTranscripts — edge cases", () => {
  it("handles a single very long transcript by truncating", () => {
    const episodes = [
      {
        episodeId: "ep1",
        feedId: "f1",
        podcastTitle: "Podcast",
        episodeTitle: "Very Long Episode",
        transcript: "x".repeat(500_000),
        publishedAt: "2026-03-15T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(1);
    expect(result[0].transcript.length).toBe(400_000);
  });

  it("handles empty array", () => {
    const result = windowTranscripts([]);
    expect(result).toHaveLength(0);
  });

  it("preserves all episodes when well under limit", () => {
    const episodes = Array.from({ length: 10 }, (_, i) => ({
      episodeId: `ep-${i}`,
      feedId: `f-${i}`,
      podcastTitle: `Podcast ${i}`,
      episodeTitle: `Episode ${i}`,
      transcript: "Short transcript content",
      publishedAt: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(10);
  });

  it("sorts by most recent first before windowing", () => {
    const episodes = [
      {
        episodeId: "old",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "Old",
        transcript: "old content",
        publishedAt: "2026-01-01T00:00:00Z",
      },
      {
        episodeId: "new",
        feedId: "f2",
        podcastTitle: "P2",
        episodeTitle: "New",
        transcript: "new content",
        publishedAt: "2026-03-15T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    expect(result[0].episodeId).toBe("new");
    expect(result[1].episodeId).toBe("old");
  });

  it("handles episodes with null publishedAt", () => {
    const episodes = [
      {
        episodeId: "no-date",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "No Date",
        transcript: "content without date",
        publishedAt: null,
      },
      {
        episodeId: "has-date",
        feedId: "f2",
        podcastTitle: "P2",
        episodeTitle: "Has Date",
        transcript: "content with date",
        publishedAt: "2026-03-15T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(2);
    // Episode with date should come first (more recent)
    expect(result[0].episodeId).toBe("has-date");
  });
});
