import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gatherNews, normalizeUrl } from "@/lib/search/gatherer";
import type { TavilyResult } from "@/types/search";

// Mock the tavily module
vi.mock("@/lib/search/tavily", () => ({
  searchTavily: vi.fn(),
}));

import { searchTavily } from "@/lib/search/tavily";
const mockSearchTavily = vi.mocked(searchTavily);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeResult(overrides: Partial<TavilyResult> = {}): TavilyResult {
  return {
    title: "Test Article",
    url: "https://example.com/article",
    content: "Test content",
    score: 0.9,
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("strips query params and fragments", () => {
    expect(normalizeUrl("https://example.com/page?ref=tw#section")).toBe(
      "example.com/page",
    );
  });

  it("strips www prefix", () => {
    expect(normalizeUrl("https://www.example.com/page")).toBe(
      "example.com/page",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe(
      "example.com/page",
    );
  });

  it("returns root path for domain-only URLs", () => {
    expect(normalizeUrl("https://example.com")).toBe("example.com/");
    expect(normalizeUrl("https://example.com/")).toBe("example.com/");
  });

  it("returns raw string for invalid URLs", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("gatherNews", () => {
  it("returns empty array for empty queries", async () => {
    const results = await gatherNews({ queries: [] });
    expect(results).toEqual([]);
    expect(mockSearchTavily).not.toHaveBeenCalled();
  });

  it("runs searches in parallel for multiple queries", async () => {
    mockSearchTavily.mockResolvedValue([makeResult()]);

    await gatherNews({ queries: ["query1", "query2", "query3"] });

    expect(mockSearchTavily).toHaveBeenCalledTimes(3);
  });

  it("deduplicates results by normalized URL", async () => {
    mockSearchTavily
      .mockResolvedValueOnce([
        makeResult({
          url: "https://example.com/article?ref=tw",
          title: "First",
          score: 0.9,
        }),
      ])
      .mockResolvedValueOnce([
        makeResult({
          url: "https://www.example.com/article#top",
          title: "Duplicate",
          score: 0.8,
        }),
      ]);

    const results = await gatherNews({ queries: ["q1", "q2"] });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("First");
  });

  it("sorts results by score descending", async () => {
    mockSearchTavily
      .mockResolvedValueOnce([
        makeResult({ url: "https://a.com/1", score: 0.5 }),
      ])
      .mockResolvedValueOnce([
        makeResult({ url: "https://b.com/2", score: 0.95 }),
      ])
      .mockResolvedValueOnce([
        makeResult({ url: "https://c.com/3", score: 0.7 }),
      ]);

    const results = await gatherNews({ queries: ["q1", "q2", "q3"] });
    expect(results[0].score).toBe(0.95);
    expect(results[1].score).toBe(0.7);
    expect(results[2].score).toBe(0.5);
  });

  it("limits total results to maxTotal", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) =>
      makeResult({ url: `https://example.com/${i}`, score: 0.9 - i * 0.01 }),
    );
    mockSearchTavily.mockResolvedValue(manyResults);

    const results = await gatherNews({
      queries: ["q1"],
      maxTotal: 3,
    });
    expect(results).toHaveLength(3);
  });

  it("skips failed searches without throwing", async () => {
    mockSearchTavily
      .mockResolvedValueOnce([
        makeResult({ url: "https://a.com/1", score: 0.9 }),
      ])
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce([
        makeResult({ url: "https://b.com/2", score: 0.8 }),
      ]);

    const results = await gatherNews({ queries: ["q1", "q2", "q3"] });
    expect(results).toHaveLength(2);
  });

  it("passes search params through to tavily", async () => {
    mockSearchTavily.mockResolvedValue([]);

    await gatherNews({
      queries: ["test"],
      searchDepth: "advanced",
      topic: "general",
      maxResults: 10,
    });

    expect(mockSearchTavily).toHaveBeenCalledWith({
      query: "test",
      maxResults: 10,
      searchDepth: "advanced",
      topic: "general",
    });
  });

  it("maps TavilyResult to SearchResult (strips raw_content)", async () => {
    mockSearchTavily.mockResolvedValueOnce([
      makeResult({
        url: "https://a.com/1",
        raw_content: "should be stripped",
      }),
    ]);

    const results = await gatherNews({ queries: ["q1"] });
    expect(results[0]).not.toHaveProperty("raw_content");
    expect(results[0]).toEqual({
      title: "Test Article",
      url: "https://a.com/1",
      content: "Test content",
      score: 0.9,
      published_date: undefined,
    });
  });
});
