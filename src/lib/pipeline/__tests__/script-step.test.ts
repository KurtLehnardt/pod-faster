import { describe, it, expect, vi, beforeEach } from "vitest";
import { scriptStep } from "../script-step";
import type { EpisodeStyle, EpisodeTone, VoiceConfig } from "@/types/episode";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";

vi.mock("@/lib/ai/chat", () => ({
  completeJson: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-20250514",
}));

import { completeJson } from "@/lib/ai/chat";
const mockCompleteJson = vi.mocked(completeJson);

beforeEach(() => {
  vi.clearAllMocks();
});

const fakeSummary: NewsSummaryOutput = {
  headline: "AI Revolution in 2025",
  keyPoints: ["Point 1", "Point 2"],
  sources: [{ title: "Source 1", url: "https://example.com/1" }],
  topicOverview: "Overview of the AI revolution...",
};

const singleVoiceConfig: VoiceConfig = {
  voices: [{ role: "Host", voice_id: "voice-host-1", name: "Alex" }],
};

const twoVoiceConfig: VoiceConfig = {
  voices: [
    { role: "Host", voice_id: "voice-host-1", name: "Alex" },
    { role: "Expert", voice_id: "voice-expert-1", name: "Jordan" },
  ],
};

const threeVoiceConfig: VoiceConfig = {
  voices: [
    { role: "Speaker 1", voice_id: "voice-1", name: "Alex" },
    { role: "Speaker 2", voice_id: "voice-2", name: "Jordan" },
    { role: "Speaker 3", voice_id: "voice-3", name: "Sam" },
  ],
};

function makeMonologueScript() {
  return {
    title: "The AI Revolution: What You Need to Know",
    segments: [
      {
        speaker: "Alex",
        text: "Welcome to today's episode about AI...",
        voice_id: "voice-host-1",
      },
      {
        speaker: "Alex",
        text: "The key developments this week...",
        voice_id: "voice-host-1",
      },
    ],
  };
}

function makeInterviewScript() {
  return {
    title: "Inside the AI Arms Race",
    segments: [
      {
        speaker: "Host",
        text: "Welcome. Today we're joined by an expert...",
        voice_id: "voice-host-1",
      },
      {
        speaker: "Expert",
        text: "Thanks for having me. The situation is...",
        voice_id: "voice-expert-1",
      },
      {
        speaker: "Host",
        text: "That's fascinating. Can you elaborate?",
        voice_id: "voice-host-1",
      },
    ],
  };
}

function makeGroupChatScript() {
  return {
    title: "AI Roundtable Discussion",
    segments: [
      {
        speaker: "Alex",
        text: "Let's dive into this week's AI news.",
        voice_id: "voice-1",
      },
      {
        speaker: "Jordan",
        text: "I think the most interesting part is...",
        voice_id: "voice-2",
      },
      {
        speaker: "Sam",
        text: "I agree, but there's another angle...",
        voice_id: "voice-3",
      },
    ],
  };
}

describe("scriptStep", () => {
  describe("monologue style", () => {
    it("generates a monologue script with single voice", async () => {
      const fakeScript = makeMonologueScript();
      mockCompleteJson.mockResolvedValue({
        data: fakeScript,
        usage: { inputTokens: 800, outputTokens: 600 },
        model: "claude-sonnet-4-20250514",
      });

      const result = await scriptStep({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 5,
        voiceConfig: singleVoiceConfig,
      });

      expect(result.script.title).toBe("The AI Revolution: What You Need to Know");
      expect(result.script.segments).toHaveLength(2);
      expect(result.script.segments[0].voice_id).toBe("voice-host-1");
      expect(result.tokensUsed).toBe(1400);
    });
  });

  describe("interview style", () => {
    it("generates an interview script with two voices", async () => {
      const fakeScript = makeInterviewScript();
      mockCompleteJson.mockResolvedValue({
        data: fakeScript,
        usage: { inputTokens: 900, outputTokens: 700 },
        model: "claude-sonnet-4-20250514",
      });

      const result = await scriptStep({
        summary: fakeSummary,
        style: "interview",
        tone: "lighthearted",
        lengthMinutes: 10,
        voiceConfig: twoVoiceConfig,
      });

      expect(result.script.segments).toHaveLength(3);
      const voiceIds = result.script.segments.map((s) => s.voice_id);
      expect(voiceIds).toContain("voice-host-1");
      expect(voiceIds).toContain("voice-expert-1");
      expect(result.tokensUsed).toBe(1600);
    });
  });

  describe("group_chat style", () => {
    it("generates a group chat script with multiple voices", async () => {
      const fakeScript = makeGroupChatScript();
      mockCompleteJson.mockResolvedValue({
        data: fakeScript,
        usage: { inputTokens: 1000, outputTokens: 800 },
        model: "claude-sonnet-4-20250514",
      });

      const result = await scriptStep({
        summary: fakeSummary,
        style: "group_chat",
        tone: "business_news",
        lengthMinutes: 15,
        voiceConfig: threeVoiceConfig,
      });

      expect(result.script.segments).toHaveLength(3);
      const speakers = new Set(result.script.segments.map((s) => s.speaker));
      expect(speakers.size).toBe(3);
      expect(result.tokensUsed).toBe(1800);
    });
  });

  describe("token budget", () => {
    it("uses at least 4096 max tokens for short episodes", async () => {
      mockCompleteJson.mockResolvedValue({
        data: makeMonologueScript(),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
      });

      await scriptStep({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 1,
        voiceConfig: singleVoiceConfig,
      });

      const callArgs = mockCompleteJson.mock.calls[0][0];
      // 1 min * 150 * 2 = 300, max(4096, 300) = 4096
      expect(callArgs.maxTokens).toBe(4096);
    });

    it("scales max tokens for longer episodes up to 8192", async () => {
      mockCompleteJson.mockResolvedValue({
        data: makeMonologueScript(),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
      });

      await scriptStep({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 30,
        voiceConfig: singleVoiceConfig,
      });

      const callArgs = mockCompleteJson.mock.calls[0][0];
      // 30 min * 150 * 2 = 9000, min(9000, 8192) = 8192
      expect(callArgs.maxTokens).toBe(8192);
    });
  });

  describe("prompt configuration", () => {
    it("uses temperature 0.7 for creative generation", async () => {
      mockCompleteJson.mockResolvedValue({
        data: makeMonologueScript(),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
      });

      await scriptStep({
        summary: fakeSummary,
        style: "monologue",
        tone: "serious",
        lengthMinutes: 5,
        voiceConfig: singleVoiceConfig,
      });

      const callArgs = mockCompleteJson.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
      expect(callArgs.model).toBe("claude-sonnet-4-20250514");
    });

    it("includes voice config in the system prompt", async () => {
      mockCompleteJson.mockResolvedValue({
        data: makeInterviewScript(),
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-sonnet-4-20250514",
      });

      await scriptStep({
        summary: fakeSummary,
        style: "interview",
        tone: "serious",
        lengthMinutes: 5,
        voiceConfig: twoVoiceConfig,
      });

      const callArgs = mockCompleteJson.mock.calls[0][0];
      expect(callArgs.system).toContain("voice-host-1");
      expect(callArgs.system).toContain("voice-expert-1");
      expect(callArgs.system).toContain("Alex");
      expect(callArgs.system).toContain("Jordan");
    });
  });

  describe("error handling", () => {
    it("propagates completeJson errors", async () => {
      mockCompleteJson.mockRejectedValue(new Error("Claude overloaded"));

      await expect(
        scriptStep({
          summary: fakeSummary,
          style: "monologue",
          tone: "serious",
          lengthMinutes: 5,
          voiceConfig: singleVoiceConfig,
        }),
      ).rejects.toThrow("Claude overloaded");
    });
  });

  describe("all tones", () => {
    const tones: EpisodeTone[] = [
      "serious",
      "lighthearted",
      "dark_mystery",
      "business_news",
    ];

    for (const tone of tones) {
      it(`generates script with tone: ${tone}`, async () => {
        mockCompleteJson.mockResolvedValue({
          data: makeMonologueScript(),
          usage: { inputTokens: 100, outputTokens: 50 },
          model: "claude-sonnet-4-20250514",
        });

        await scriptStep({
          summary: fakeSummary,
          style: "monologue",
          tone,
          lengthMinutes: 5,
          voiceConfig: singleVoiceConfig,
        });

        expect(mockCompleteJson).toHaveBeenCalledOnce();
      });
    }
  });
});
