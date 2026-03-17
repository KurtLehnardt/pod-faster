import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runSummaryPipeline,
  computeNextDueAt,
  windowTranscripts,
  type SummaryPipelineParams,
} from "../summary-pipeline";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";
import type { EpisodeScript } from "@/types/episode";

// ---- Mock pipeline steps ----

vi.mock("../script-step", () => ({
  scriptStep: vi.fn(),
}));

vi.mock("../audio-step", () => ({
  audioStep: vi.fn(),
}));

vi.mock("../storage-step", () => ({
  storageStep: vi.fn(),
}));

// ---- Mock AI chat ----

vi.mock("@/lib/ai/chat", () => ({
  completeJson: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-20250514",
}));

// ---- Mock Supabase admin client ----

// Build a chainable mock that records calls for assertions
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
    selectedCols?: string;
    isSingle: boolean;
    isInsert: boolean;
    insertData?: unknown;
    isUpdate: boolean;
    updateData?: Record<string, unknown>;
    orderCol?: string;
    orderAsc?: boolean;
  } = { filters: [], isSingle: false, isInsert: false, isUpdate: false };

  const builder: Record<string, unknown> = {};

  const resolveSelect = () => {
    if (state.isSingle) {
      return { data: selectSingleResults[table] ?? null, error: null };
    }
    return { data: selectResults[table] ?? [], error: null };
  };

  builder.select = (cols?: string) => {
    state.selectedCols = cols;
    return builder;
  };
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
    if (state.isUpdate) {
      if (!updatedRows[table]) updatedRows[table] = [];
      updatedRows[table].push({ data: state.updateData!, filters: [...state.filters] });
      return { error: null };
    }
    return builder;
  };
  builder.in = (_col: string, _vals: unknown[]) => {
    return builder;
  };
  builder.not = (_col: string, _op: string, _val: unknown) => {
    return builder;
  };
  builder.gt = (_col: string, _val: unknown) => {
    return builder;
  };
  builder.order = (_col: string, _opts?: { ascending?: boolean }) => {
    return builder;
  };
  builder.single = () => {
    state.isSingle = true;
    if (state.isInsert) {
      // Return the inserted row with an id
      return { data: { id: "generated-episode-id" }, error: null };
    }
    return resolveSelect();
  };

  // Terminal — resolve pending query
  builder.then = undefined; // not a thenable

  // Provide a way to resolve
  Object.defineProperty(builder, "then", {
    get() {
      // When awaited, resolve the query
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

// ---- Import mocked modules ----

import { scriptStep } from "../script-step";
import { audioStep } from "../audio-step";
import { storageStep } from "../storage-step";
import { completeJson } from "@/lib/ai/chat";

const mockScriptStep = vi.mocked(scriptStep);
const mockAudioStep = vi.mocked(audioStep);
const mockStorageStep = vi.mocked(storageStep);
const mockCompleteJson = vi.mocked(completeJson);

// ---- Test data ----

const defaultParams: SummaryPipelineParams = {
  summaryConfigId: "config-001",
  userId: "user-123",
  style: "monologue",
  tone: "serious",
  lengthMinutes: 10,
  voiceConfig: {
    voices: [{ role: "Host", voice_id: "voice-host", name: "Alex" }],
  },
};

const fakeSummary: NewsSummaryOutput = {
  headline: "AI Podcasts This Week",
  keyPoints: [
    "Key insight about AI (Source: Tech Talk - Episode 42)",
    "New framework released (Source: Dev Digest - Latest Updates)",
  ],
  sources: [
    { title: "Episode 42", url: "Tech Talk" },
    { title: "Latest Updates", url: "Dev Digest" },
  ],
  topicOverview: "This week in AI podcasts, several hosts discussed...",
};

const fakeScript: EpisodeScript = {
  title: "Your Weekly Podcast Summary",
  segments: [
    { speaker: "Host", text: "Welcome to your weekly summary...", voice_id: "voice-host" },
  ],
};

function setupSummaryConfig() {
  selectSingleResults["summary_configs"] = {
    id: "config-001",
    user_id: "user-123",
    name: "My Tech Summary",
    cadence: "weekly",
    style: "monologue",
    tone: "serious",
    length_minutes: 10,
    is_active: true,
    last_generated_at: "2026-03-01T00:00:00.000Z",
    next_due_at: "2026-03-08T00:00:00.000Z",
  };
}

function setupConfigFeeds() {
  selectResults["summary_config_feeds"] = [
    { feed_id: "feed-1", is_included: true, auto_excluded: false },
    { feed_id: "feed-2", is_included: true, auto_excluded: false },
  ];
}

function setupFeeds() {
  selectResults["podcast_feeds"] = [
    { id: "feed-1", title: "Tech Talk" },
    { id: "feed-2", title: "Dev Digest" },
  ];
}

function setupFeedEpisodes() {
  selectResults["feed_episodes"] = [
    {
      id: "ep-1",
      feed_id: "feed-1",
      title: "Episode 42",
      transcript: "Today we discuss AI advancements...",
      published_at: "2026-03-05T12:00:00.000Z",
    },
    {
      id: "ep-2",
      feed_id: "feed-2",
      title: "Latest Updates",
      transcript: "A new framework was released this week...",
      published_at: "2026-03-06T12:00:00.000Z",
    },
  ];
}

function setupSuccessfulPipeline() {
  setupSummaryConfig();
  setupConfigFeeds();
  setupFeeds();
  setupFeedEpisodes();

  mockCompleteJson.mockResolvedValue({
    data: fakeSummary,
    usage: { inputTokens: 500, outputTokens: 200 },
    model: "claude-sonnet-4-20250514",
  });

  mockScriptStep.mockResolvedValue({
    script: fakeScript,
    tokensUsed: 1400,
  });

  mockAudioStep.mockResolvedValue({
    audio: new Uint8Array([0x49, 0x44, 0x33]).buffer as ArrayBuffer,
    charactersUsed: 42,
  });

  mockStorageStep.mockResolvedValue("user-123/generated-episode-id.mp3");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---- Tests ----

describe("runSummaryPipeline", () => {
  describe("successful pipeline execution", () => {
    it("runs all steps: gather, summarize, script, audio, upload", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      // Claude summarization was called
      expect(mockCompleteJson).toHaveBeenCalledOnce();

      // Downstream pipeline steps were called
      expect(mockScriptStep).toHaveBeenCalledOnce();
      expect(mockAudioStep).toHaveBeenCalledOnce();
      expect(mockStorageStep).toHaveBeenCalledOnce();
    });

    it("creates an episode with source_type='feed_summary'", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      const episodeInserts = insertedRows["episodes"];
      expect(episodeInserts).toBeDefined();
      expect(episodeInserts.length).toBeGreaterThanOrEqual(1);

      const inserted = episodeInserts[0] as Record<string, unknown>;
      expect(inserted.source_type).toBe("feed_summary");
      expect(inserted.summary_config_id).toBe("config-001");
      expect(inserted.user_id).toBe("user-123");
      expect(inserted.style).toBe("monologue");
      expect(inserted.tone).toBe("serious");
    });

    it("passes summary output to scriptStep", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      expect(mockScriptStep).toHaveBeenCalledWith({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 10,
        voiceConfig: defaultParams.voiceConfig,
      });
    });

    it("passes script to audioStep", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      expect(mockAudioStep).toHaveBeenCalledWith({
        script: fakeScript,
        style: "monologue",
      });
    });

    it("writes to summary_generation_log on success", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();
      expect(logInserts.length).toBeGreaterThanOrEqual(1);

      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("completed");
      expect(log.summary_config_id).toBe("config-001");
      expect(log.user_id).toBe("user-123");
      expect(log.episode_id).toBe("generated-episode-id");
      expect(log.episodes_summarized).toBe(2);
    });

    it("updates summary_config with last_generated_at and next_due_at", async () => {
      setupSuccessfulPipeline();

      await runSummaryPipeline(defaultParams);

      const configUpdates = updatedRows["summary_configs"];
      expect(configUpdates).toBeDefined();
      expect(configUpdates.length).toBeGreaterThanOrEqual(1);

      const update = configUpdates[configUpdates.length - 1];
      expect(update.data.last_generated_at).toBeDefined();
      expect(update.data.next_due_at).toBeDefined();
    });
  });

  describe("no transcripts available", () => {
    it("writes a failed generation log when no transcripts found", async () => {
      setupSummaryConfig();
      setupConfigFeeds();
      setupFeeds();
      // No feed episodes
      selectResults["feed_episodes"] = [];

      await runSummaryPipeline(defaultParams);

      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();
      expect(logInserts.length).toBeGreaterThanOrEqual(1);

      const log = logInserts[0] as Record<string, unknown>;
      expect(log.status).toBe("failed");
      expect(log.error_message).toContain("No new transcripts available");
    });

    it("does not call script, audio, or storage steps", async () => {
      setupSummaryConfig();
      setupConfigFeeds();
      setupFeeds();
      selectResults["feed_episodes"] = [];

      await runSummaryPipeline(defaultParams);

      expect(mockScriptStep).not.toHaveBeenCalled();
      expect(mockAudioStep).not.toHaveBeenCalled();
      expect(mockStorageStep).not.toHaveBeenCalled();
    });
  });

  describe("inactivity detection", () => {
    it("auto-excludes feeds with no new episodes", async () => {
      setupSummaryConfig();
      setupConfigFeeds(); // feed-1 and feed-2 included
      setupFeeds();
      // Only feed-1 has episodes — feed-2 is inactive
      selectResults["feed_episodes"] = [
        {
          id: "ep-1",
          feed_id: "feed-1",
          title: "Episode 42",
          transcript: "Transcript content here...",
          published_at: "2026-03-05T12:00:00.000Z",
        },
      ];

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 300, outputTokens: 100 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 800 });
      mockAudioStep.mockResolvedValue({
        audio: new Uint8Array([1]).buffer as ArrayBuffer,
        charactersUsed: 20,
      });
      mockStorageStep.mockResolvedValue("user-123/generated-episode-id.mp3");

      await runSummaryPipeline(defaultParams);

      // summary_config_feeds should have been updated for feed-2
      const scfUpdates = updatedRows["summary_config_feeds"];
      expect(scfUpdates).toBeDefined();
      expect(scfUpdates.length).toBeGreaterThanOrEqual(1);

      const excludeUpdate = scfUpdates[0];
      expect(excludeUpdate.data.auto_excluded).toBe(true);
      expect(excludeUpdate.data.auto_exclude_reason).toContain("No new episodes");
    });
  });

  describe("error handling", () => {
    it("does not throw — errors are caught and recorded", async () => {
      setupSummaryConfig();
      setupConfigFeeds();
      setupFeeds();
      setupFeedEpisodes();

      mockCompleteJson.mockRejectedValue(new Error("Claude API error"));

      await expect(runSummaryPipeline(defaultParams)).resolves.toBeUndefined();
    });

    it("logs failure when summarize step fails", async () => {
      setupSummaryConfig();
      setupConfigFeeds();
      setupFeeds();
      setupFeedEpisodes();

      mockCompleteJson.mockRejectedValue(new Error("Rate limit exceeded"));

      await runSummaryPipeline(defaultParams);

      const logInserts = insertedRows["summary_generation_log"];
      expect(logInserts).toBeDefined();

      const failedLog = (logInserts as Record<string, unknown>[]).find(
        (l) => l.status === "failed",
      );
      expect(failedLog).toBeDefined();
      expect(failedLog?.error_message).toContain("Rate limit exceeded");
    });

    it("sets episode to failed when audio step fails", async () => {
      setupSummaryConfig();
      setupConfigFeeds();
      setupFeeds();
      setupFeedEpisodes();

      mockCompleteJson.mockResolvedValue({
        data: fakeSummary,
        usage: { inputTokens: 500, outputTokens: 200 },
        model: "claude-sonnet-4-20250514",
      });
      mockScriptStep.mockResolvedValue({ script: fakeScript, tokensUsed: 1000 });
      mockAudioStep.mockRejectedValue(new Error("ElevenLabs quota exceeded"));

      await runSummaryPipeline(defaultParams);

      // Episode should have been set to failed via update
      const episodeUpdates = updatedRows["episodes"];
      expect(episodeUpdates).toBeDefined();

      const failedUpdate = episodeUpdates?.find(
        (u) => u.data.status === "failed",
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.data.error_message).toContain("ElevenLabs quota exceeded");
    });
  });
});

describe("computeNextDueAt", () => {
  const base = new Date("2026-03-15T08:00:00.000Z");

  it("adds 1 day for daily cadence", () => {
    const next = computeNextDueAt("daily", base);
    expect(new Date(next).getDate()).toBe(16);
  });

  it("adds 3 days for twice_weekly cadence", () => {
    const next = computeNextDueAt("twice_weekly", base);
    expect(new Date(next).getDate()).toBe(18);
  });

  it("adds 7 days for weekly cadence", () => {
    const next = computeNextDueAt("weekly", base);
    expect(new Date(next).getDate()).toBe(22);
  });

  it("adds 1 day for on_new_episodes cadence", () => {
    const next = computeNextDueAt("on_new_episodes", base);
    expect(new Date(next).getDate()).toBe(16);
  });
});

describe("windowTranscripts", () => {
  it("returns all episodes when total is under the limit", () => {
    const episodes = [
      {
        episodeId: "1",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "E1",
        transcript: "Short transcript",
        publishedAt: "2026-03-05T00:00:00Z",
      },
      {
        episodeId: "2",
        feedId: "f2",
        podcastTitle: "P2",
        episodeTitle: "E2",
        transcript: "Another short one",
        publishedAt: "2026-03-06T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(2);
  });

  it("interleaves episodes from different feeds in round-robin order", () => {
    const longText = "x".repeat(300_000);
    const episodes = [
      {
        episodeId: "old",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "Old Episode",
        transcript: longText,
        publishedAt: "2026-03-01T00:00:00Z",
      },
      {
        episodeId: "new",
        feedId: "f2",
        podcastTitle: "P2",
        episodeTitle: "New Episode",
        transcript: "Recent content",
        publishedAt: "2026-03-10T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    // Round-robin: one from f1 then one from f2.
    // f1's episode (300K chars) fits, but adding f2's would still be under 400K.
    // Both should be included.
    const ids = result.map((r) => r.episodeId);
    expect(ids).toContain("old");
    expect(ids).toContain("new");
    expect(result).toHaveLength(2);
  });

  it("includes at least one episode even if it exceeds the limit", () => {
    const hugeText = "x".repeat(500_000);
    const episodes = [
      {
        episodeId: "huge",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "Huge Episode",
        transcript: hugeText,
        publishedAt: "2026-03-05T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(1);
    // Transcript should be truncated to the max
    expect(result[0].transcript.length).toBe(400_000);
  });

  it("stops adding episodes when budget is exhausted during round-robin", () => {
    const mediumText = "x".repeat(250_000);
    const episodes = [
      {
        episodeId: "a1",
        feedId: "f1",
        podcastTitle: "P1",
        episodeTitle: "Feed1 Episode",
        transcript: mediumText,
        publishedAt: "2026-03-01T00:00:00Z",
      },
      {
        episodeId: "b1",
        feedId: "f2",
        podcastTitle: "P2",
        episodeTitle: "Feed2 Episode",
        transcript: mediumText,
        publishedAt: "2026-03-05T00:00:00Z",
      },
      {
        episodeId: "c1",
        feedId: "f3",
        podcastTitle: "P3",
        episodeTitle: "Feed3 Episode",
        transcript: "Short recent",
        publishedAt: "2026-03-10T00:00:00Z",
      },
    ];

    const result = windowTranscripts(episodes);
    // Round-robin: f1 (250K) fits. f2 (250K) would exceed 400K → stop.
    // Only f1's episode is included.
    expect(result).toHaveLength(1);
    expect(result[0].episodeId).toBe("a1");
  });

  it("multi-feed round-robin: 3 feeds, 2 episodes each — all feeds represented", () => {
    const episodes = [
      { episodeId: "a1", feedId: "fA", podcastTitle: "PA", episodeTitle: "A1", transcript: "content-a1", publishedAt: "2026-03-10T00:00:00Z" },
      { episodeId: "a2", feedId: "fA", podcastTitle: "PA", episodeTitle: "A2", transcript: "content-a2", publishedAt: "2026-03-09T00:00:00Z" },
      { episodeId: "b1", feedId: "fB", podcastTitle: "PB", episodeTitle: "B1", transcript: "content-b1", publishedAt: "2026-03-08T00:00:00Z" },
      { episodeId: "b2", feedId: "fB", podcastTitle: "PB", episodeTitle: "B2", transcript: "content-b2", publishedAt: "2026-03-07T00:00:00Z" },
      { episodeId: "c1", feedId: "fC", podcastTitle: "PC", episodeTitle: "C1", transcript: "content-c1", publishedAt: "2026-03-06T00:00:00Z" },
      { episodeId: "c2", feedId: "fC", podcastTitle: "PC", episodeTitle: "C2", transcript: "content-c2", publishedAt: "2026-03-05T00:00:00Z" },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(6);

    // All three feeds should be represented
    const feedIds = new Set(result.map((r) => r.feedId));
    expect(feedIds.size).toBe(3);
    expect(feedIds).toContain("fA");
    expect(feedIds).toContain("fB");
    expect(feedIds).toContain("fC");

    // Round-robin order: newest from each feed per round
    // Round 1: a1, b1, c1  Round 2: a2, b2, c2
    expect(result[0].episodeId).toBe("a1");
    expect(result[1].episodeId).toBe("b1");
    expect(result[2].episodeId).toBe("c1");
    expect(result[3].episodeId).toBe("a2");
    expect(result[4].episodeId).toBe("b2");
    expect(result[5].episodeId).toBe("c2");
  });

  it("budget starvation prevention: small feed included despite large competitors", () => {
    const largeText = "x".repeat(200_000);
    const smallText = "y".repeat(10_000);
    const episodes = [
      { episodeId: "a1", feedId: "fA", podcastTitle: "PA", episodeTitle: "A1", transcript: largeText, publishedAt: "2026-03-10T00:00:00Z" },
      { episodeId: "a2", feedId: "fA", podcastTitle: "PA", episodeTitle: "A2", transcript: largeText, publishedAt: "2026-03-09T00:00:00Z" },
      { episodeId: "a3", feedId: "fA", podcastTitle: "PA", episodeTitle: "A3", transcript: largeText, publishedAt: "2026-03-08T00:00:00Z" },
      { episodeId: "b1", feedId: "fB", podcastTitle: "PB", episodeTitle: "B1", transcript: smallText, publishedAt: "2026-03-07T00:00:00Z" },
    ];

    const result = windowTranscripts(episodes);
    const ids = result.map((r) => r.episodeId);

    // Round-robin: a1 (200K), b1 (10K) = 210K. Round 2: a2 (200K) = 410K > 400K → stop.
    // Feed B's episode MUST be included.
    expect(ids).toContain("b1");
    expect(result).toHaveLength(2);
  });

  it("single feed fallback: all episodes from one feed → newest-first ordering", () => {
    const episodes = [
      { episodeId: "e1", feedId: "f1", podcastTitle: "P1", episodeTitle: "E1", transcript: "content-1", publishedAt: "2026-03-01T00:00:00Z" },
      { episodeId: "e2", feedId: "f1", podcastTitle: "P1", episodeTitle: "E2", transcript: "content-2", publishedAt: "2026-03-05T00:00:00Z" },
      { episodeId: "e3", feedId: "f1", podcastTitle: "P1", episodeTitle: "E3", transcript: "content-3", publishedAt: "2026-03-10T00:00:00Z" },
    ];

    const result = windowTranscripts(episodes);
    expect(result).toHaveLength(3);
    // Within a single feed, order is newest-first
    expect(result[0].episodeId).toBe("e3");
    expect(result[1].episodeId).toBe("e2");
    expect(result[2].episodeId).toBe("e1");
  });

  it("uneven feed sizes: Feed A has 10 episodes, Feed B has 1 — B is included", () => {
    const episodes = Array.from({ length: 10 }, (_, i) => ({
      episodeId: `a${i}`,
      feedId: "fA",
      podcastTitle: "PA",
      episodeTitle: `A${i}`,
      transcript: `content-a${i}`,
      publishedAt: `2026-03-${String(10 - i).padStart(2, "0")}T00:00:00Z`,
    }));
    episodes.push({
      episodeId: "b0",
      feedId: "fB",
      podcastTitle: "PB",
      episodeTitle: "B0",
      transcript: "content-b0",
      publishedAt: "2026-03-01T00:00:00Z",
    });

    const result = windowTranscripts(episodes);
    const ids = result.map((r) => r.episodeId);

    // Feed B's single episode must be included
    expect(ids).toContain("b0");
    // All 11 episodes should fit (all very short)
    expect(result).toHaveLength(11);
  });

  it("empty input returns empty", () => {
    const result = windowTranscripts([]);
    expect(result).toHaveLength(0);
  });
});
