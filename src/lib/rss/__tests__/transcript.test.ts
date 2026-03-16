import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { extractTranscript } from "../transcript";

// Save original fetch and env
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset fetch mock
  globalThis.fetch = vi.fn();
  // Clear PodcastIndex env vars by default
  delete process.env.PODCAST_INDEX_API_KEY;
  delete process.env.PODCAST_INDEX_API_SECRET;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

const mockFetch = () => globalThis.fetch as ReturnType<typeof vi.fn>;

describe("extractTranscript", () => {
  // ── Transcript URL source ──────────────────────────────────

  it("extracts transcript from a transcript URL (plain text)", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("Hello, welcome to the show. Today we discuss..."),
    });

    const result = await extractTranscript({
      transcriptUrl: "https://cdn.example.com/transcript.txt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBe(
      "Hello, welcome to the show. Today we discuss..."
    );
    // Transcripts fetched from an RSS podcast:transcript URL use "rss_transcript"
    expect(result.source).toBe("rss_transcript");
    expect(result.truncated).toBe(false);
  });

  it("extracts and cleans SRT format transcript", async () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Welcome to the show.

2
00:00:04,500 --> 00:00:08,000
Today we discuss AI.`;

    mockFetch().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(srt),
    });

    const result = await extractTranscript({
      transcriptUrl: "https://cdn.example.com/transcript.srt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBe(
      "Welcome to the show. Today we discuss AI."
    );
    expect(result.source).toBe("rss_transcript");
  });

  it("extracts and cleans VTT format transcript", async () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to the podcast.

00:00:04.500 --> 00:00:08.000
Let us begin.`;

    mockFetch().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(vtt),
    });

    const result = await extractTranscript({
      transcriptUrl: "https://cdn.example.com/transcript.vtt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBe(
      "Welcome to the podcast. Let us begin."
    );
  });

  it("returns null when transcript URL fetch fails", async () => {
    mockFetch().mockResolvedValueOnce({ ok: false });

    const result = await extractTranscript({
      transcriptUrl: "https://cdn.example.com/transcript.txt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBeNull();
    expect(result.source).toBeNull();
  });

  // ── PodcastIndex source ────────────────────────────────────

  it("extracts from PodcastIndex when env vars are set", async () => {
    process.env.PODCAST_INDEX_API_KEY = "test-key";
    process.env.PODCAST_INDEX_API_SECRET = "test-secret";

    // First call: PodcastIndex API
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          episodes: [
            {
              transcriptUrl: "https://cdn.example.com/pi-transcript.txt",
            },
          ],
        }),
    });

    // Second call: fetch the transcript URL from PI result
    mockFetch().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("Transcript from PodcastIndex."),
    });

    const result = await extractTranscript({
      transcriptUrl: null,
      description: null,
      audioUrl: null,
      podcastTitle: "Test Podcast",
    });

    expect(result.transcript).toBe("Transcript from PodcastIndex.");
    expect(result.source).toBe("podcast_index");
  });

  it("skips PodcastIndex when env vars are missing", async () => {
    // No PODCAST_INDEX_API_KEY set (cleared in beforeEach)

    const result = await extractTranscript({
      transcriptUrl: null,
      description: "Short description.",
      audioUrl: null,
      podcastTitle: "Test Podcast",
    });

    // Should fall through to description (but it's too short)
    expect(result.transcript).toBeNull();
    expect(result.source).toBeNull();
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  // ── Description fallback ───────────────────────────────────

  it("falls back to description when > 200 chars", async () => {
    const longDesc =
      "<p>" +
      "This is a very detailed episode description that covers many topics. ".repeat(
        5
      ) +
      "</p>";

    const result = await extractTranscript({
      transcriptUrl: null,
      description: longDesc,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBeTruthy();
    expect(result.source).toBe("rss_description");
    // HTML should be stripped
    expect(result.transcript).not.toContain("<p>");
  });

  it("does not use description when < 200 chars", async () => {
    const result = await extractTranscript({
      transcriptUrl: null,
      description: "Short description.",
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.transcript).toBeNull();
    expect(result.source).toBeNull();
  });

  // ── Null result ────────────────────────────────────────────

  it("returns null when nothing is found", async () => {
    const result = await extractTranscript({
      transcriptUrl: null,
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result).toEqual({
      transcript: null,
      source: null,
      truncated: false,
    });
  });

  // ── Truncation ─────────────────────────────────────────────

  it("truncates transcripts exceeding 500KB", async () => {
    const hugeText = "A".repeat(600_000);

    mockFetch().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(hugeText),
    });

    const result = await extractTranscript({
      transcriptUrl: "https://cdn.example.com/huge.txt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    expect(result.truncated).toBe(true);
    expect(result.transcript).toHaveLength(512_000);
    expect(result.source).toBe("rss_transcript");
  });

  // ── Validation of transcript URL ───────────────────────────

  it("rejects transcript URL pointing to private IP", async () => {
    const result = await extractTranscript({
      transcriptUrl: "https://192.168.1.1/transcript.txt",
      description: null,
      audioUrl: null,
      podcastTitle: null,
    });

    // Should not attempt to fetch private URLs
    expect(mockFetch()).not.toHaveBeenCalled();
    expect(result.transcript).toBeNull();
  });
});
