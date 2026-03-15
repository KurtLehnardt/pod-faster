import { describe, it, expect, vi, beforeEach } from "vitest";
import { summarizeStep } from "../summarize-step";
import type { SearchResult } from "@/types/search";

vi.mock("@/lib/ai/chat", () => ({
  completeJson: vi.fn(),
  MODEL_SONNET: "claude-sonnet-4-20250514",
}));

import { completeJson } from "@/lib/ai/chat";
const mockCompleteJson = vi.mocked(completeJson);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeSources(count = 2): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Article ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    content: `Content of article ${i + 1} with details about the topic.`,
    score: 0.9 - i * 0.1,
  }));
}

const fakeSummary = {
  headline: "Major AI Developments This Week",
  keyPoints: [
    "Point 1 (Source: Article 1)",
    "Point 2 (Source: Article 2)",
  ],
  sources: [
    { title: "Article 1", url: "https://example.com/1" },
    { title: "Article 2", url: "https://example.com/2" },
  ],
  topicOverview: "This week saw significant developments in AI...",
};

describe("summarizeStep", () => {
  it("generates a summary from search results and returns token usage", async () => {
    mockCompleteJson.mockResolvedValue({
      data: fakeSummary,
      usage: { inputTokens: 500, outputTokens: 200 },
      model: "claude-sonnet-4-20250514",
    });

    const sources = makeSources(2);
    const result = await summarizeStep(sources);

    expect(result.summary).toEqual(fakeSummary);
    expect(result.tokensUsed).toBe(700); // 500 + 200
    expect(mockCompleteJson).toHaveBeenCalledOnce();
  });

  it("passes correct options to completeJson", async () => {
    mockCompleteJson.mockResolvedValue({
      data: fakeSummary,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
    });

    const sources = makeSources(1);
    await summarizeStep(sources);

    const callArgs = mockCompleteJson.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-20250514");
    expect(callArgs.maxTokens).toBe(4096);
    expect(callArgs.temperature).toBe(0);
    expect(typeof callArgs.system).toBe("string");
    expect(typeof callArgs.userPrompt).toBe("string");
    expect(callArgs.userPrompt).toContain("Article 1");
  });

  it("throws when no sources are provided", async () => {
    await expect(summarizeStep([])).rejects.toThrow(
      "Cannot summarize: no sources provided",
    );
    expect(mockCompleteJson).not.toHaveBeenCalled();
  });

  it("propagates completeJson errors", async () => {
    mockCompleteJson.mockRejectedValue(new Error("Claude API rate limit"));

    await expect(summarizeStep(makeSources())).rejects.toThrow(
      "Claude API rate limit",
    );
  });

  it("correctly sums input and output tokens", async () => {
    mockCompleteJson.mockResolvedValue({
      data: fakeSummary,
      usage: { inputTokens: 1234, outputTokens: 5678 },
      model: "claude-sonnet-4-20250514",
    });

    const result = await summarizeStep(makeSources());
    expect(result.tokensUsed).toBe(6912);
  });

  it("passes the parser function as second argument", async () => {
    mockCompleteJson.mockResolvedValue({
      data: fakeSummary,
      usage: { inputTokens: 100, outputTokens: 50 },
      model: "claude-sonnet-4-20250514",
    });

    await summarizeStep(makeSources());

    const parserFn = mockCompleteJson.mock.calls[0][1];
    expect(typeof parserFn).toBe("function");
  });
});
