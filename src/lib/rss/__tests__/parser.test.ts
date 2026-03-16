import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFeedFromString, parseOpml, parseDuration } from "../parser";

const fixturesDir = join(__dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// ── parseFeedFromString: RSS 2.0 ─────────────────────────────

describe("parseFeedFromString — RSS 2.0", () => {
  it("parses feed metadata correctly", async () => {
    const xml = readFixture("sample-rss2.xml");
    const feed = await parseFeedFromString(xml);

    expect(feed.title).toBe("Tech Talk Daily");
    expect(feed.description).toBe(
      "A daily dive into the latest tech news and trends."
    );
    expect(feed.imageUrl).toBe(
      "https://techtalkdaily.example.com/artwork.jpg"
    );
  });

  it("parses all 5 episodes", async () => {
    const xml = readFixture("sample-rss2.xml");
    const feed = await parseFeedFromString(xml);

    expect(feed.episodes).toHaveLength(5);
  });

  it("parses episode fields correctly", async () => {
    const xml = readFixture("sample-rss2.xml");
    const feed = await parseFeedFromString(xml);

    const ep5 = feed.episodes.find((e) => e.guid === "ep-005");
    expect(ep5).toBeDefined();
    expect(ep5!.title).toBe("Episode 5: AI Regulation");
    expect(ep5!.audioUrl).toBe("https://cdn.example.com/ep005.mp3");
    expect(ep5!.publishedAt).toBeInstanceOf(Date);
    expect(ep5!.description).toContain("AI regulation");
  });

  it("parses episode guids", async () => {
    const xml = readFixture("sample-rss2.xml");
    const feed = await parseFeedFromString(xml);

    const guids = feed.episodes.map((e) => e.guid);
    expect(guids).toContain("ep-001");
    expect(guids).toContain("ep-005");
  });
});

// ── parseFeedFromString: Atom ─────────────────────────────────

describe("parseFeedFromString — Atom", () => {
  it("parses Atom feed metadata", async () => {
    const xml = readFixture("sample-atom.xml");
    const feed = await parseFeedFromString(xml);

    expect(feed.title).toBe("Science Weekly");
    expect(feed.description).toBe(
      "Weekly science news and discoveries."
    );
  });

  it("parses all 3 Atom entries", async () => {
    const xml = readFixture("sample-atom.xml");
    const feed = await parseFeedFromString(xml);

    expect(feed.episodes).toHaveLength(3);
  });

  it("parses Atom entry fields", async () => {
    const xml = readFixture("sample-atom.xml");
    const feed = await parseFeedFromString(xml);

    const ep1 = feed.episodes.find((e) => e.guid === "atom-entry-001");
    expect(ep1).toBeDefined();
    expect(ep1!.title).toBe("Dark Matter Breakthrough");
    expect(ep1!.publishedAt).toBeInstanceOf(Date);
  });
});

// ── parseFeedFromString: malformed XML ────────────────────────

describe("parseFeedFromString — malformed XML", () => {
  it("throws on malformed XML", async () => {
    const xml = readFixture("malformed-feed.xml");
    await expect(parseFeedFromString(xml)).rejects.toThrow();
  });
});

// ── parseFeedFromString: transcript tags ──────────────────────

describe("parseFeedFromString — transcript tags", () => {
  it("extracts transcript URL from podcast:transcript tag", async () => {
    const xml = readFixture("feed-with-transcript.xml");
    const feed = await parseFeedFromString(xml);

    const ep1 = feed.episodes.find((e) => e.guid === "transcript-001");
    expect(ep1).toBeDefined();
    expect(ep1!.transcriptUrl).toBe(
      "https://cdn.example.com/transcript001.srt"
    );
  });

  it("returns null transcriptUrl for episodes without the tag", async () => {
    const xml = readFixture("feed-with-transcript.xml");
    const feed = await parseFeedFromString(xml);

    const ep3 = feed.episodes.find((e) => e.guid === "transcript-003");
    expect(ep3).toBeDefined();
    expect(ep3!.transcriptUrl).toBeNull();
  });
});

// ── parseFeedFromString: guid fallback ────────────────────────

describe("parseFeedFromString — guid fallback", () => {
  it("generates a hash-based guid when guid element is missing", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>No GUID Feed</title>
    <item>
      <title>Episode Without GUID</title>
      <enclosure url="https://cdn.example.com/noguid.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

    const feed = await parseFeedFromString(xml);
    expect(feed.episodes).toHaveLength(1);
    // Should be a hex hash string, not empty
    expect(feed.episodes[0].guid).toMatch(/^[a-f0-9]{40}$/);
  });
});

// ── parseDuration ─────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses HH:MM:SS format", () => {
    expect(parseDuration("01:23:45")).toBe(5025);
  });

  it("parses MM:SS format", () => {
    expect(parseDuration("45:32")).toBe(2732);
  });

  it("parses raw seconds", () => {
    expect(parseDuration("5432")).toBe(5432);
  });

  it("returns null for undefined", () => {
    expect(parseDuration(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDuration("")).toBeNull();
  });

  it("returns null for non-numeric garbage", () => {
    expect(parseDuration("abc")).toBeNull();
  });
});

// ── parseOpml ─────────────────────────────────────────────────

describe("parseOpml", () => {
  it("parses all 10 feeds from sample OPML", async () => {
    const opml = readFixture("sample-opml.xml");
    const feeds = await parseOpml(opml);

    expect(feeds).toHaveLength(10);
  });

  it("extracts feed URLs correctly", async () => {
    const opml = readFixture("sample-opml.xml");
    const feeds = await parseOpml(opml);

    const urls = feeds.map((f) => f.feedUrl);
    expect(urls).toContain("https://feeds.example.com/techtalk.xml");
    expect(urls).toContain("https://feeds.example.com/labnotes.xml");
  });

  it("extracts feed titles", async () => {
    const opml = readFixture("sample-opml.xml");
    const feeds = await parseOpml(opml);

    const first = feeds.find(
      (f) => f.feedUrl === "https://feeds.example.com/techtalk.xml"
    );
    expect(first).toBeDefined();
    expect(first!.title).toBe("Tech Talk Daily");
  });

  it("flattens nested groups (folders)", async () => {
    const opml = readFixture("sample-opml.xml");
    const feeds = await parseOpml(opml);

    // Both Technology and Science folders should be flattened
    const techFeed = feeds.find(
      (f) => f.feedUrl === "https://feeds.example.com/codereview.xml"
    );
    const scienceFeed = feeds.find(
      (f) => f.feedUrl === "https://feeds.example.com/nature.xml"
    );
    expect(techFeed).toBeDefined();
    expect(scienceFeed).toBeDefined();
  });

  it("rejects OPML content exceeding 1 MB", async () => {
    const hugeOpml = "x".repeat(1_048_577);
    await expect(parseOpml(hugeOpml)).rejects.toThrow("maximum size");
  });

  it("skips feeds with invalid URLs", async () => {
    const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Good" xmlUrl="https://feeds.example.com/good.xml"/>
    <outline text="Bad" xmlUrl="ftp://bad.example.com/feed"/>
  </body>
</opml>`;

    const feeds = await parseOpml(opml);
    expect(feeds).toHaveLength(1);
    expect(feeds[0].feedUrl).toBe("https://feeds.example.com/good.xml");
  });

  it("returns empty array for OPML with no feed outlines", async () => {
    const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Folder Only"/>
  </body>
</opml>`;

    const feeds = await parseOpml(opml);
    expect(feeds).toHaveLength(0);
  });
});
