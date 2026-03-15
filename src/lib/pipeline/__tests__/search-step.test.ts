import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchStep } from "../search-step";

vi.mock("@/lib/search/gatherer", () => ({
  gatherNews: vi.fn(),
}));

import { gatherNews } from "@/lib/search/gatherer";
const mockGatherNews = vi.mocked(gatherNews);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchStep", () => {
  it("calls gatherNews with correct queries and returns sources", async () => {
    const fakeSources = [
      {
        title: "AI Breakthrough",
        url: "https://example.com/ai",
        content: "New AI model released...",
        score: 0.95,
      },
      {
        title: "Tech Roundup",
        url: "https://example.com/tech",
        content: "This week in tech...",
        score: 0.85,
      },
    ];
    mockGatherNews.mockResolvedValue(fakeSources);

    const result = await searchStep("artificial intelligence");

    expect(mockGatherNews).toHaveBeenCalledOnce();
    expect(mockGatherNews).toHaveBeenCalledWith({
      queries: ["artificial intelligence", "artificial intelligence latest news"],
      maxResults: 10,
      maxTotal: 15,
      searchDepth: "basic",
      topic: "news",
    });
    expect(result.sources).toEqual(fakeSources);
    expect(result.sources).toHaveLength(2);
  });

  it("throws on empty topic query", async () => {
    await expect(searchStep("")).rejects.toThrow("Topic query cannot be empty");
    expect(mockGatherNews).not.toHaveBeenCalled();
  });

  it("throws on whitespace-only topic query", async () => {
    await expect(searchStep("   ")).rejects.toThrow(
      "Topic query cannot be empty",
    );
    expect(mockGatherNews).not.toHaveBeenCalled();
  });

  it("throws when gatherNews returns zero results", async () => {
    mockGatherNews.mockResolvedValue([]);

    await expect(searchStep("obscure niche topic")).rejects.toThrow(
      'No search results found for topic: "obscure niche topic"',
    );
  });

  it("propagates gatherNews errors", async () => {
    mockGatherNews.mockRejectedValue(new Error("Tavily API unavailable"));

    await expect(searchStep("test")).rejects.toThrow("Tavily API unavailable");
  });

  it("returns all sources when multiple are found", async () => {
    const manySources = Array.from({ length: 8 }, (_, i) => ({
      title: `Article ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      content: `Content for article ${i + 1}`,
      score: 0.9 - i * 0.05,
    }));
    mockGatherNews.mockResolvedValue(manySources);

    const result = await searchStep("breaking news");
    expect(result.sources).toHaveLength(8);
  });
});
