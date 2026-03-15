import { describe, it, expect } from "vitest";
import {
  topicExtractionSystemPrompt,
  topicExtractionUserPrompt,
  parseTopicExtractionResponse,
} from "../prompts/topic-extraction";

describe("topic-extraction prompt", () => {
  describe("topicExtractionSystemPrompt", () => {
    it("returns a non-empty system prompt string", () => {
      const prompt = topicExtractionSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain("topics");
      expect(prompt).toContain("JSON");
    });
  });

  describe("topicExtractionUserPrompt", () => {
    it("includes the user message", () => {
      const prompt = topicExtractionUserPrompt({
        userMessage: "What's happening with AI regulation?",
      });
      expect(prompt).toContain("AI regulation");
    });
  });

  describe("parseTopicExtractionResponse", () => {
    it("parses a valid JSON response", () => {
      const raw = JSON.stringify({
        topics: ["AI regulation", "EU AI Act"],
        suggestedQuery: "AI regulation EU Act 2026",
      });
      const result = parseTopicExtractionResponse(raw);
      expect(result.topics).toEqual(["AI regulation", "EU AI Act"]);
      expect(result.suggestedQuery).toBe("AI regulation EU Act 2026");
    });

    it("strips markdown code fences", () => {
      const raw =
        '```json\n{"topics":["topic1"],"suggestedQuery":"query"}\n```';
      const result = parseTopicExtractionResponse(raw);
      expect(result.topics).toEqual(["topic1"]);
    });

    it("filters out empty and non-string topics", () => {
      const raw = JSON.stringify({
        topics: ["valid", "", 123, "also valid"],
        suggestedQuery: "query",
      });
      const result = parseTopicExtractionResponse(raw);
      expect(result.topics).toEqual(["valid", "also valid"]);
    });

    it("throws on missing topics array", () => {
      const raw = JSON.stringify({ suggestedQuery: "query" });
      expect(() => parseTopicExtractionResponse(raw)).toThrow(
        "Invalid topic extraction response",
      );
    });

    it("throws on missing suggestedQuery", () => {
      const raw = JSON.stringify({ topics: ["a"] });
      expect(() => parseTopicExtractionResponse(raw)).toThrow(
        "Invalid topic extraction response",
      );
    });

    it("throws on invalid JSON", () => {
      expect(() => parseTopicExtractionResponse("not json")).toThrow();
    });
  });
});
