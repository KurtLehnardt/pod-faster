import { describe, it, expect } from "vitest";
import {
  scriptGenerationSystemPrompt,
  scriptGenerationUserPrompt,
  parseScriptGenerationResponse,
} from "../prompts/script-generation";
import type { NewsSummaryOutput } from "../prompts/news-summary";
import type { ScriptGenerationInput } from "../prompts/script-generation";
import type { VoiceConfig } from "@/types/episode";

const mockSummary: NewsSummaryOutput = {
  headline: "Test Headline",
  keyPoints: ["Point 1", "Point 2"],
  sources: [{ title: "Source 1", url: "https://example.com" }],
  topicOverview: "A brief overview of the topic.",
};

const mockVoices: VoiceConfig = {
  voices: [
    { role: "host", voice_id: "voice-001", name: "Alex" },
    { role: "expert", voice_id: "voice-002", name: "Jordan" },
  ],
};

function makeInput(
  overrides?: Partial<ScriptGenerationInput>,
): ScriptGenerationInput {
  return {
    summary: mockSummary,
    style: "interview",
    tone: "serious",
    lengthMinutes: 5,
    voices: mockVoices,
    ...overrides,
  };
}

describe("script-generation prompt", () => {
  describe("scriptGenerationSystemPrompt", () => {
    it("includes style instructions for monologue", () => {
      const prompt = scriptGenerationSystemPrompt(
        makeInput({ style: "monologue" }),
      );
      expect(prompt).toContain("MONOLOGUE");
      expect(prompt).toContain("Single narrator");
    });

    it("includes style instructions for interview", () => {
      const prompt = scriptGenerationSystemPrompt(
        makeInput({ style: "interview" }),
      );
      expect(prompt).toContain("INTERVIEW");
      expect(prompt).toContain("Host");
    });

    it("includes style instructions for group_chat", () => {
      const prompt = scriptGenerationSystemPrompt(
        makeInput({ style: "group_chat" }),
      );
      expect(prompt).toContain("GROUP CHAT");
      expect(prompt).toContain("interjections");
    });

    it("includes tone instructions", () => {
      const prompt = scriptGenerationSystemPrompt(
        makeInput({ tone: "dark_mystery" }),
      );
      expect(prompt).toContain("DARK MYSTERY");
      expect(prompt).toContain("suspenseful");
    });

    it("calculates target word count from minutes", () => {
      const prompt = scriptGenerationSystemPrompt(
        makeInput({ lengthMinutes: 10 }),
      );
      expect(prompt).toContain("1500 words");
      expect(prompt).toContain("10 minutes");
    });

    it("lists available voice IDs", () => {
      const prompt = scriptGenerationSystemPrompt(makeInput());
      expect(prompt).toContain("voice-001");
      expect(prompt).toContain("voice-002");
      expect(prompt).toContain("Alex");
    });
  });

  describe("scriptGenerationUserPrompt", () => {
    it("includes headline and key points", () => {
      const prompt = scriptGenerationUserPrompt(makeInput());
      expect(prompt).toContain("Test Headline");
      expect(prompt).toContain("Point 1");
      expect(prompt).toContain("Point 2");
      expect(prompt).toContain("Source 1");
    });
  });

  describe("parseScriptGenerationResponse", () => {
    const validScript = {
      title: "Episode Title",
      segments: [
        { speaker: "Host", text: "Welcome.", voice_id: "voice-001" },
        { speaker: "Expert", text: "Thanks.", voice_id: "voice-002" },
      ],
    };

    it("parses a valid script response", () => {
      const result = parseScriptGenerationResponse(
        JSON.stringify(validScript),
      );
      expect(result.title).toBe("Episode Title");
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].speaker).toBe("Host");
      expect(result.segments[0].voice_id).toBe("voice-001");
    });

    it("strips markdown fences", () => {
      const raw = "```json\n" + JSON.stringify(validScript) + "\n```";
      const result = parseScriptGenerationResponse(raw);
      expect(result.title).toBe("Episode Title");
    });

    it("throws on missing title", () => {
      const bad = { segments: validScript.segments };
      expect(() =>
        parseScriptGenerationResponse(JSON.stringify(bad)),
      ).toThrow("missing or empty title");
    });

    it("throws on empty segments", () => {
      const bad = { title: "Title", segments: [] };
      expect(() =>
        parseScriptGenerationResponse(JSON.stringify(bad)),
      ).toThrow("missing or empty segments");
    });

    it("throws on segment missing speaker", () => {
      const bad = {
        title: "Title",
        segments: [{ text: "Hello", voice_id: "v1" }],
      };
      expect(() =>
        parseScriptGenerationResponse(JSON.stringify(bad)),
      ).toThrow("missing speaker");
    });

    it("throws on segment missing text", () => {
      const bad = {
        title: "Title",
        segments: [{ speaker: "Host", voice_id: "v1" }],
      };
      expect(() =>
        parseScriptGenerationResponse(JSON.stringify(bad)),
      ).toThrow("missing text");
    });

    it("throws on segment missing voice_id", () => {
      const bad = {
        title: "Title",
        segments: [{ speaker: "Host", text: "Hello" }],
      };
      expect(() =>
        parseScriptGenerationResponse(JSON.stringify(bad)),
      ).toThrow("missing voice_id");
    });
  });
});
