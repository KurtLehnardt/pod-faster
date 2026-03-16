import { describe, expect, it, vi, beforeEach } from "vitest";
import { pollFeed } from "../poller";
import * as parserModule from "../parser";
import type { ParsedFeed, ParsedEpisode } from "../parser";

// Mock parseFeed so we don't make real HTTP requests
vi.mock("../parser", async () => {
  const actual = await vi.importActual<typeof parserModule>("../parser");
  return {
    ...actual,
    parseFeed: vi.fn(),
  };
});

const mockParseFeed = vi.mocked(parserModule.parseFeed);

function makeEpisode(overrides: Partial<ParsedEpisode>): ParsedEpisode {
  return {
    guid: "default-guid",
    title: "Default Title",
    description: null,
    audioUrl: null,
    publishedAt: null,
    durationSeconds: null,
    transcriptUrl: null,
    ...overrides,
  };
}

const baseFeed: ParsedFeed = {
  title: "Test Podcast",
  description: "A test podcast feed.",
  imageUrl: "https://example.com/art.jpg",
  episodes: [
    makeEpisode({
      guid: "ep-1",
      title: "Episode 1",
      publishedAt: new Date("2026-03-14T00:00:00Z"),
    }),
    makeEpisode({
      guid: "ep-2",
      title: "Episode 2",
      publishedAt: new Date("2026-03-13T00:00:00Z"),
    }),
    makeEpisode({
      guid: "ep-3",
      title: "Episode 3",
      publishedAt: new Date("2026-03-12T00:00:00Z"),
    }),
    makeEpisode({
      guid: "ep-4",
      title: "Episode 4",
      publishedAt: new Date("2026-03-10T00:00:00Z"),
    }),
  ],
};

beforeEach(() => {
  mockParseFeed.mockReset();
  mockParseFeed.mockResolvedValue(baseFeed);
});

describe("pollFeed", () => {
  it("returns all episodes when no existing guids", async () => {
    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: null,
      existingGuids: [],
    });

    expect(result.newEpisodes).toHaveLength(4);
    expect(result.totalEpisodes).toBe(4);
    expect(result.feed.title).toBe("Test Podcast");
  });

  it("filters out episodes with existing guids", async () => {
    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: null,
      existingGuids: ["ep-1", "ep-3"],
    });

    expect(result.newEpisodes).toHaveLength(2);
    const guids = result.newEpisodes.map((e) => e.guid);
    expect(guids).toContain("ep-2");
    expect(guids).toContain("ep-4");
    expect(guids).not.toContain("ep-1");
    expect(guids).not.toContain("ep-3");
  });

  it("filters by lastPolledAt date", async () => {
    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: new Date("2026-03-12T12:00:00Z"),
      existingGuids: [],
    });

    // ep-1 (Mar 14) and ep-2 (Mar 13) are after Mar 12 12:00
    // ep-3 (Mar 12 00:00) is before, ep-4 (Mar 10) is before
    expect(result.newEpisodes).toHaveLength(2);
    const guids = result.newEpisodes.map((e) => e.guid);
    expect(guids).toContain("ep-1");
    expect(guids).toContain("ep-2");
  });

  it("combines guid and date filtering", async () => {
    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: new Date("2026-03-12T12:00:00Z"),
      existingGuids: ["ep-1"],
    });

    // ep-2 is the only one: after the date AND not in existing guids
    expect(result.newEpisodes).toHaveLength(1);
    expect(result.newEpisodes[0].guid).toBe("ep-2");
  });

  it("returns updated feed metadata", async () => {
    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: null,
      existingGuids: [],
    });

    expect(result.feed).toEqual({
      title: "Test Podcast",
      description: "A test podcast feed.",
      imageUrl: "https://example.com/art.jpg",
    });
  });

  it("includes episodes with null publishedAt when lastPolledAt is set", async () => {
    mockParseFeed.mockResolvedValue({
      ...baseFeed,
      episodes: [
        makeEpisode({ guid: "no-date", title: "No Date Episode", publishedAt: null }),
        makeEpisode({
          guid: "old",
          title: "Old Episode",
          publishedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
    });

    const result = await pollFeed({
      feedUrl: "https://feeds.example.com/test.xml",
      lastPolledAt: new Date("2026-03-01T00:00:00Z"),
      existingGuids: [],
    });

    // no-date should be included (unknown date = include), old should not
    expect(result.newEpisodes).toHaveLength(1);
    expect(result.newEpisodes[0].guid).toBe("no-date");
  });
});
