import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline, type PipelineParams } from "../orchestrator";
import type { EpisodeScript } from "@/types/episode";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";

// ---- Mock all pipeline steps ----

vi.mock("../search-step", () => ({
  searchStep: vi.fn(),
}));

vi.mock("../summarize-step", () => ({
  summarizeStep: vi.fn(),
}));

vi.mock("../script-step", () => ({
  scriptStep: vi.fn(),
}));

vi.mock("../audio-step", () => ({
  audioStep: vi.fn(),
}));

vi.mock("../storage-step", () => ({
  storageStep: vi.fn(),
}));

// ---- Mock Supabase admin client ----

const mockUpdate = vi.fn().mockReturnValue({ error: null });
const mockEq = vi.fn().mockReturnValue({ error: null });
const mockFrom = vi.fn(() => ({
  update: (...args: unknown[]) => {
    mockUpdate(...args);
    return { eq: (...eqArgs: unknown[]) => { mockEq(...eqArgs); return { error: null }; } };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { searchStep } from "../search-step";
import { summarizeStep } from "../summarize-step";
import { scriptStep } from "../script-step";
import { audioStep } from "../audio-step";
import { storageStep } from "../storage-step";

const mockSearchStep = vi.mocked(searchStep);
const mockSummarizeStep = vi.mocked(summarizeStep);
const mockScriptStep = vi.mocked(scriptStep);
const mockAudioStep = vi.mocked(audioStep);
const mockStorageStep = vi.mocked(storageStep);

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress console.error in tests
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const defaultParams: PipelineParams = {
  episodeId: "ep-123",
  userId: "user-456",
  topicQuery: "artificial intelligence news",
  style: "monologue",
  tone: "serious",
  lengthMinutes: 5,
  voiceConfig: {
    voices: [{ role: "Host", voice_id: "voice-host", name: "Alex" }],
  },
  language: "en",
};

const fakeSources = [
  {
    title: "AI Article",
    url: "https://example.com/ai",
    content: "AI news content",
    score: 0.95,
  },
];

const fakeSummary: NewsSummaryOutput = {
  headline: "AI Advances This Week",
  keyPoints: ["Point 1"],
  sources: [{ title: "AI Article", url: "https://example.com/ai" }],
  topicOverview: "Overview of AI developments...",
};

const fakeScript: EpisodeScript = {
  title: "The AI Revolution",
  segments: [
    { speaker: "Host", text: "Hello world", voice_id: "voice-host" },
  ],
};

function setupSuccessfulPipeline() {
  mockSearchStep.mockResolvedValue({ sources: fakeSources });
  mockSummarizeStep.mockResolvedValue({
    summary: fakeSummary,
    tokensUsed: 700,
  });
  mockScriptStep.mockResolvedValue({
    script: fakeScript,
    tokensUsed: 1400,
  });
  mockAudioStep.mockResolvedValue({
    audio: new Uint8Array([0x49, 0x44, 0x33]).buffer as ArrayBuffer,
    charactersUsed: 11,
  });
  mockStorageStep.mockResolvedValue("user-456/ep-123.mp3");
}

describe("runPipeline", () => {
  describe("successful pipeline execution", () => {
    it("runs all 5 steps in order", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      expect(mockSearchStep).toHaveBeenCalledOnce();
      expect(mockSummarizeStep).toHaveBeenCalledOnce();
      expect(mockScriptStep).toHaveBeenCalledOnce();
      expect(mockAudioStep).toHaveBeenCalledOnce();
      expect(mockStorageStep).toHaveBeenCalledOnce();
    });

    it("passes correct arguments to each step", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      // Step 1: search
      expect(mockSearchStep).toHaveBeenCalledWith("artificial intelligence news");

      // Step 2: summarize receives the sources from search
      expect(mockSummarizeStep).toHaveBeenCalledWith(fakeSources);

      // Step 3: script receives summary + config + language
      expect(mockScriptStep).toHaveBeenCalledWith({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 5,
        voiceConfig: defaultParams.voiceConfig,
        language: "en",
      });

      // Step 4: audio receives the script + language
      expect(mockAudioStep).toHaveBeenCalledWith({
        script: fakeScript,
        style: "monologue",
        language: "en",
      });

      // Step 5: storage receives the audio buffer + IDs
      expect(mockStorageStep).toHaveBeenCalledWith({
        audio: expect.any(ArrayBuffer),
        userId: "user-456",
        episodeId: "ep-123",
      });
    });

    it("updates status through the full transition sequence", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      // Extract all update calls in order
      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);

      // Check status transitions are present and in order
      const statusUpdates = updateCalls.filter(
        (data) => data.status !== undefined,
      );
      const statuses = statusUpdates.map((data) => data.status);

      expect(statuses).toEqual([
        "searching",
        "summarizing",
        "scripting",
        "generating_audio",
        "uploading",
        "completed",
      ]);
    });

    it("accumulates token usage across summarize and script steps", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);

      // After summarize step, claude_tokens_used should be 700
      const afterSummarize = updateCalls.find(
        (d) => d.claude_tokens_used === 700,
      );
      expect(afterSummarize).toBeDefined();

      // After script step, claude_tokens_used should be 2100 (700 + 1400)
      const afterScript = updateCalls.find(
        (d) => d.claude_tokens_used === 2100,
      );
      expect(afterScript).toBeDefined();
    });

    it("stores the audio path and completed_at on completion", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const completedUpdate = updateCalls.find(
        (d) => d.status === "completed",
      );

      expect(completedUpdate).toMatchObject({
        status: "completed",
        audio_path: "user-456/ep-123.mp3",
      });
      expect(completedUpdate?.completed_at).toBeDefined();
    });

    it("stores sources after search step", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const sourcesUpdate = updateCalls.find(
        (d) => d.sources !== undefined,
      );
      expect(sourcesUpdate?.sources).toEqual(fakeSources);
    });

    it("stores script title and content after script step", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const scriptUpdate = updateCalls.find(
        (d) => d.title !== undefined,
      );
      expect(scriptUpdate?.title).toBe("The AI Revolution");
      expect(scriptUpdate?.script).toBeDefined();
    });

    it("stores ElevenLabs character count after audio step", async () => {
      setupSuccessfulPipeline();

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const audioUpdate = updateCalls.find(
        (d) => d.elevenlabs_characters_used !== undefined,
      );
      expect(audioUpdate?.elevenlabs_characters_used).toBe(11);
    });
  });

  describe("error handling", () => {
    it("sets status to failed when search step throws", async () => {
      mockSearchStep.mockRejectedValue(new Error("Tavily API down"));

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.error_message).toBe("Tavily API down");

      // Subsequent steps should not have been called
      expect(mockSummarizeStep).not.toHaveBeenCalled();
      expect(mockScriptStep).not.toHaveBeenCalled();
      expect(mockAudioStep).not.toHaveBeenCalled();
      expect(mockStorageStep).not.toHaveBeenCalled();
    });

    it("sets status to failed when summarize step throws", async () => {
      mockSearchStep.mockResolvedValue({ sources: fakeSources });
      mockSummarizeStep.mockRejectedValue(new Error("Claude rate limit"));

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toBe("Claude rate limit");
      expect(mockScriptStep).not.toHaveBeenCalled();
    });

    it("sets status to failed when script step throws", async () => {
      mockSearchStep.mockResolvedValue({ sources: fakeSources });
      mockSummarizeStep.mockResolvedValue({
        summary: fakeSummary,
        tokensUsed: 700,
      });
      mockScriptStep.mockRejectedValue(new Error("Invalid JSON response"));

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toBe("Invalid JSON response");
      expect(mockAudioStep).not.toHaveBeenCalled();
    });

    it("sets status to failed when audio step throws", async () => {
      mockSearchStep.mockResolvedValue({ sources: fakeSources });
      mockSummarizeStep.mockResolvedValue({
        summary: fakeSummary,
        tokensUsed: 700,
      });
      mockScriptStep.mockResolvedValue({
        script: fakeScript,
        tokensUsed: 1400,
      });
      mockAudioStep.mockRejectedValue(
        new Error("ElevenLabs character limit exceeded"),
      );

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toBe(
        "ElevenLabs character limit exceeded",
      );
      expect(mockStorageStep).not.toHaveBeenCalled();
    });

    it("sets status to failed when storage step throws", async () => {
      mockSearchStep.mockResolvedValue({ sources: fakeSources });
      mockSummarizeStep.mockResolvedValue({
        summary: fakeSummary,
        tokensUsed: 700,
      });
      mockScriptStep.mockResolvedValue({
        script: fakeScript,
        tokensUsed: 1400,
      });
      mockAudioStep.mockResolvedValue({
        audio: new Uint8Array([1]).buffer as ArrayBuffer,
        charactersUsed: 11,
      });
      mockStorageStep.mockRejectedValue(
        new Error("Storage upload failed: bucket not found"),
      );

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toBe(
        "Storage upload failed: bucket not found",
      );
    });

    it("truncates error messages to 1000 characters", async () => {
      const longMessage = "x".repeat(2000);
      mockSearchStep.mockRejectedValue(new Error(longMessage));

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toHaveLength(1000);
    });

    it("handles non-Error thrown values", async () => {
      mockSearchStep.mockRejectedValue("string error");

      await runPipeline(defaultParams);

      const updateCalls = mockUpdate.mock.calls.map((call) => call[0]);
      const failedUpdate = updateCalls.find((d) => d.status === "failed");

      expect(failedUpdate?.error_message).toBe("string error");
    });

    it("does not throw — errors are caught and recorded", async () => {
      mockSearchStep.mockRejectedValue(new Error("Catastrophic failure"));

      // runPipeline should not throw
      await expect(runPipeline(defaultParams)).resolves.toBeUndefined();
    });
  });

  describe("step execution order", () => {
    it("executes steps sequentially, not in parallel", async () => {
      const callOrder: string[] = [];

      mockSearchStep.mockImplementation(async () => {
        callOrder.push("search");
        return { sources: fakeSources };
      });
      mockSummarizeStep.mockImplementation(async () => {
        callOrder.push("summarize");
        return { summary: fakeSummary, tokensUsed: 700 };
      });
      mockScriptStep.mockImplementation(async () => {
        callOrder.push("script");
        return { script: fakeScript, tokensUsed: 1400 };
      });
      mockAudioStep.mockImplementation(async () => {
        callOrder.push("audio");
        return {
          audio: new Uint8Array([1]).buffer as ArrayBuffer,
          charactersUsed: 11,
        };
      });
      mockStorageStep.mockImplementation(async () => {
        callOrder.push("storage");
        return "user-456/ep-123.mp3";
      });

      await runPipeline(defaultParams);

      expect(callOrder).toEqual([
        "search",
        "summarize",
        "script",
        "audio",
        "storage",
      ]);
    });
  });
});
