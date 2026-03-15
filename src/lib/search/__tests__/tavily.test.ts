import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchTavily, TavilyError } from "@/lib/search/tavily";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("TAVILY_API_KEY", "test-key-123");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function tavilyResponse(results: unknown[]) {
  return {
    ok: true,
    json: () => Promise.resolve({ query: "test", results }),
    text: () => Promise.resolve(""),
  };
}

describe("searchTavily", () => {
  it("sends correct request to Tavily API", async () => {
    mockFetch.mockResolvedValueOnce(tavilyResponse([]));

    await searchTavily({ query: "AI news" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      api_key: "test-key-123",
      query: "AI news",
      search_depth: "basic",
      max_results: 5,
      topic: "news",
      include_answer: false,
      include_raw_content: false,
    });
  });

  it("returns parsed results", async () => {
    mockFetch.mockResolvedValueOnce(
      tavilyResponse([
        {
          title: "Article 1",
          url: "https://example.com/1",
          content: "Content 1",
          score: 0.95,
          published_date: "2026-03-14",
        },
      ]),
    );

    const results = await searchTavily({ query: "test" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Article 1",
      url: "https://example.com/1",
      content: "Content 1",
      score: 0.95,
      published_date: "2026-03-14",
    });
  });

  it("truncates content to 2000 chars", async () => {
    const longContent = "x".repeat(3000);
    mockFetch.mockResolvedValueOnce(
      tavilyResponse([
        {
          title: "Long",
          url: "https://example.com",
          content: longContent,
          score: 0.9,
        },
      ]),
    );

    const results = await searchTavily({ query: "test" });
    expect(results[0].content).toHaveLength(2000);
  });

  it("truncates raw_content to 2000 chars", async () => {
    const longRaw = "y".repeat(3000);
    mockFetch.mockResolvedValueOnce(
      tavilyResponse([
        {
          title: "Long raw",
          url: "https://example.com",
          content: "short",
          score: 0.9,
          raw_content: longRaw,
        },
      ]),
    );

    const results = await searchTavily({
      query: "test",
      includeRawContent: true,
    });
    expect(results[0].raw_content).toHaveLength(2000);
  });

  it("throws TavilyError when API key is missing", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");

    // Need to delete the env var entirely since empty string is still truthy check
    delete process.env.TAVILY_API_KEY;

    await expect(searchTavily({ query: "test" })).rejects.toThrow(TavilyError);
    await expect(searchTavily({ query: "test" })).rejects.toThrow(
      "TAVILY_API_KEY",
    );
  });

  it("throws TavilyError on empty query", async () => {
    await expect(searchTavily({ query: "   " })).rejects.toThrow(TavilyError);
    await expect(searchTavily({ query: "" })).rejects.toThrow(
      "query cannot be empty",
    );
  });

  it("throws TavilyError on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limited"),
    });

    await expect(searchTavily({ query: "test" })).rejects.toThrow(TavilyError);
    await expect(
      searchTavily({ query: "test" }).catch((e: TavilyError) => {
        expect(e.status).toBe(429);
        throw e;
      }),
    ).rejects.toThrow();
  });

  it("uses custom params when provided", async () => {
    mockFetch.mockResolvedValueOnce(tavilyResponse([]));

    await searchTavily({
      query: "deep topic",
      searchDepth: "advanced",
      maxResults: 10,
      topic: "general",
      includeAnswer: true,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.search_depth).toBe("advanced");
    expect(body.max_results).toBe(10);
    expect(body.topic).toBe("general");
    expect(body.include_answer).toBe(true);
  });
});
