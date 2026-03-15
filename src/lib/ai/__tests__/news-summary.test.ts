import { describe, it, expect } from "vitest";
import {
  newsSummarySystemPrompt,
  newsSummaryUserPrompt,
  parseNewsSummaryResponse,
} from "../prompts/news-summary";

describe("news-summary prompt", () => {
  describe("newsSummarySystemPrompt", () => {
    it("returns a non-empty system prompt", () => {
      const prompt = newsSummarySystemPrompt();
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain("podcast");
      expect(prompt).toContain("JSON");
    });
  });

  describe("newsSummaryUserPrompt", () => {
    it("includes all article titles and content", () => {
      const prompt = newsSummaryUserPrompt({
        articles: [
          {
            title: "Article One",
            url: "https://example.com/1",
            content: "Content of article one.",
          },
          {
            title: "Article Two",
            url: "https://example.com/2",
            content: "Content of article two.",
          },
        ],
      });
      expect(prompt).toContain("Article One");
      expect(prompt).toContain("Article Two");
      expect(prompt).toContain("Content of article one.");
      expect(prompt).toContain("2 news articles");
    });
  });

  describe("parseNewsSummaryResponse", () => {
    const validResponse = {
      headline: "Big News Headline",
      keyPoints: ["Point 1 (Source: Article)", "Point 2 (Source: Article)"],
      sources: [{ title: "Article", url: "https://example.com" }],
      topicOverview: "Overview paragraph here.",
    };

    it("parses a valid response", () => {
      const result = parseNewsSummaryResponse(JSON.stringify(validResponse));
      expect(result.headline).toBe("Big News Headline");
      expect(result.keyPoints).toHaveLength(2);
      expect(result.sources).toHaveLength(1);
      expect(result.topicOverview).toContain("Overview");
    });

    it("strips markdown fences", () => {
      const raw = "```json\n" + JSON.stringify(validResponse) + "\n```";
      const result = parseNewsSummaryResponse(raw);
      expect(result.headline).toBe("Big News Headline");
    });

    it("filters invalid keyPoints", () => {
      const response = { ...validResponse, keyPoints: ["valid", 123, null] };
      const result = parseNewsSummaryResponse(JSON.stringify(response));
      expect(result.keyPoints).toEqual(["valid"]);
    });

    it("filters invalid sources", () => {
      const response = {
        ...validResponse,
        sources: [
          { title: "Good", url: "https://ok.com" },
          { title: 123, url: "bad" },
          { title: "Missing URL" },
        ],
      };
      const result = parseNewsSummaryResponse(JSON.stringify(response));
      expect(result.sources).toEqual([
        { title: "Good", url: "https://ok.com" },
      ]);
    });

    it("throws on missing headline", () => {
      const response = { ...validResponse, headline: undefined };
      expect(() =>
        parseNewsSummaryResponse(JSON.stringify(response)),
      ).toThrow("missing headline");
    });

    it("throws on missing keyPoints", () => {
      const response = { ...validResponse, keyPoints: undefined };
      expect(() =>
        parseNewsSummaryResponse(JSON.stringify(response)),
      ).toThrow("missing keyPoints");
    });

    it("throws on missing sources", () => {
      const response = { ...validResponse, sources: undefined };
      expect(() =>
        parseNewsSummaryResponse(JSON.stringify(response)),
      ).toThrow("missing sources");
    });

    it("throws on missing topicOverview", () => {
      const response = { ...validResponse, topicOverview: undefined };
      expect(() =>
        parseNewsSummaryResponse(JSON.stringify(response)),
      ).toThrow("missing topicOverview");
    });
  });
});
