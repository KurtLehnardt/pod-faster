import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tier-budget constants (imported by audio-slicer)
vi.mock("../tier-budget", () => ({
  FREE_TIER_CLIP_SECONDS: 300,
  FREE_TIER_CLIP_START_SECONDS: 300,
}));

import { sliceAudio } from "../audio-slicer";

// ── Setup ───────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

/** Create a fake audio blob of the given size. */
function fakeAudioBlob(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: "audio/mpeg" });
}

/** Create a fake Response with a blob. */
function fakeResponse(blob: Blob, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(blob, { status, headers });
}

/** Create a HEAD response with content-length and accept-ranges. */
function fakeHeadResponse(
  contentLength: number,
  acceptRanges: string | null = "bytes",
): Response {
  const headers = new Headers();
  headers.set("content-length", String(contentLength));
  if (acceptRanges) headers.set("accept-ranges", acceptRanges);
  return new Response(null, { status: 200, headers });
}

// ── Tests ───────────────────────────────────────────────────

describe("sliceAudio", () => {
  it("returns full file for short episode (< 300s)", async () => {
    const blob = fakeAudioBlob(1000);
    fetchSpy.mockResolvedValueOnce(fakeResponse(blob));

    const result = await sliceAudio("https://example.com/short.mp3", 200);

    expect(result.startSeconds).toBe(0);
    expect(result.endSeconds).toBe(200);
    // Only one fetch (direct download, no HEAD needed)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/short.mp3");
  });

  it("clips from 0-300 for medium episode (400s)", async () => {
    const fileSize = 400 * 16000; // ~128kbps
    const blob = fakeAudioBlob(fileSize);

    // HEAD request
    fetchSpy.mockResolvedValueOnce(fakeHeadResponse(fileSize, "bytes"));
    // Range request succeeds
    const slicedBlob = fakeAudioBlob(300 * 16000);
    fetchSpy.mockResolvedValueOnce(fakeResponse(slicedBlob, 206));

    const result = await sliceAudio("https://example.com/medium.mp3", 400);

    expect(result.startSeconds).toBe(0);
    expect(result.endSeconds).toBe(300);
  });

  it("clips from 300-600 for normal episode (3600s)", async () => {
    const fileSize = 3600 * 16000;
    const blob = fakeAudioBlob(fileSize);

    // HEAD request
    fetchSpy.mockResolvedValueOnce(fakeHeadResponse(fileSize, "bytes"));
    // Range request succeeds
    const slicedBlob = fakeAudioBlob(300 * 16000);
    fetchSpy.mockResolvedValueOnce(fakeResponse(slicedBlob, 206));

    const result = await sliceAudio("https://example.com/long.mp3", 3600);

    expect(result.startSeconds).toBe(300);
    expect(result.endSeconds).toBe(600);
  });

  it("sends Range header when server supports it", async () => {
    const fileSize = 3600 * 16000;

    fetchSpy.mockResolvedValueOnce(fakeHeadResponse(fileSize, "bytes"));
    fetchSpy.mockResolvedValueOnce(fakeResponse(fakeAudioBlob(1000), 206));

    await sliceAudio("https://example.com/ranged.mp3", 3600);

    // Second call should have Range header
    const rangeCall = fetchSpy.mock.calls[1];
    expect(rangeCall[1]).toHaveProperty("headers");
    const headers = rangeCall[1]!.headers as Record<string, string>;
    expect(headers.Range).toMatch(/^bytes=\d+-\d+$/);
  });

  it("falls back to full download when Range not supported", async () => {
    const fileSize = 3600 * 16000;
    const fullBlob = fakeAudioBlob(fileSize);

    // HEAD: no accept-ranges
    fetchSpy.mockResolvedValueOnce(fakeHeadResponse(fileSize, null));
    // Full download
    fetchSpy.mockResolvedValueOnce(fakeResponse(fullBlob));

    const result = await sliceAudio("https://example.com/no-range.mp3", 3600);

    expect(result.startSeconds).toBe(300);
    expect(result.endSeconds).toBe(600);
    // Blob should be smaller than the full file
    expect(result.audioBlob.size).toBeLessThan(fileSize);
  });

  it("throws when download fails", async () => {
    // Short episode → direct download fails
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: "Not Found" })
    );

    await expect(
      sliceAudio("https://example.com/missing.mp3", 100)
    ).rejects.toThrow("Failed to download audio: 404 Not Found");
  });

  it("treats null duration as long episode (clips 300-600)", async () => {
    const fileSize = 100_000_000; // large file

    fetchSpy.mockResolvedValueOnce(fakeHeadResponse(fileSize, "bytes"));
    fetchSpy.mockResolvedValueOnce(fakeResponse(fakeAudioBlob(5000), 206));

    const result = await sliceAudio("https://example.com/unknown.mp3", null);

    expect(result.startSeconds).toBe(300);
    expect(result.endSeconds).toBe(600);
  });
});
