import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetClient } from "@/lib/elevenlabs/client";

// Mock elevenLabsFetch at the module level
const mockElevenLabsFetch = vi.fn();
vi.mock("@/lib/elevenlabs/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/elevenlabs/client")>();
  return {
    ...actual,
    elevenLabsFetch: (...args: Parameters<typeof actual.elevenLabsFetch>) =>
      mockElevenLabsFetch(...args),
  };
});

import {
  transcribeAudio,
  calculateSttCost,
} from "../elevenlabs-stt";
import { ElevenLabsError } from "@/lib/elevenlabs/client";

const originalApiKey = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  resetClient();
  process.env.ELEVENLABS_API_KEY = "test-key";
  vi.restoreAllMocks();
  mockElevenLabsFetch.mockReset();
});

afterEach(() => {
  if (originalApiKey !== undefined) {
    process.env.ELEVENLABS_API_KEY = originalApiKey;
  } else {
    delete process.env.ELEVENLABS_API_KEY;
  }
});

// ── calculateSttCost ────────────────────────────────────────

describe("calculateSttCost", () => {
  it("charges 0.67 cents for 60 seconds (1 minute)", () => {
    expect(calculateSttCost(60)).toBeCloseTo(0.67);
  });

  it("charges 1.34 cents for 61 seconds (rounds up to 2 minutes)", () => {
    expect(calculateSttCost(61)).toBeCloseTo(1.34);
  });

  it("charges 40.2 cents for 3600 seconds (60 minutes)", () => {
    expect(calculateSttCost(3600)).toBeCloseTo(40.2);
  });

  it("charges 0.67 cents for 1 second (rounds up to 1 minute)", () => {
    expect(calculateSttCost(1)).toBeCloseTo(0.67);
  });

  it("charges 0.67 cents for 59 seconds (rounds up to 1 minute)", () => {
    expect(calculateSttCost(59)).toBeCloseTo(0.67);
  });
});

// ── transcribeAudio ─────────────────────────────────────────

describe("transcribeAudio", () => {
  it("returns text, duration, and cost on successful URL-based transcription", async () => {
    const sttResponse = {
      text: "Hello world, this is a test transcription.",
      words: [
        { text: "Hello", start: 0.0, end: 0.5, type: "word" },
        { text: "world,", start: 0.5, end: 1.0, type: "word" },
        { text: "this", start: 1.0, end: 1.3, type: "word" },
        { text: "is", start: 1.3, end: 1.5, type: "word" },
        { text: "a", start: 1.5, end: 1.6, type: "word" },
        { text: "test", start: 1.6, end: 2.0, type: "word" },
        { text: "transcription.", start: 2.0, end: 65.0, type: "word" },
      ],
    };

    mockElevenLabsFetch.mockResolvedValue(
      new Response(JSON.stringify(sttResponse), { status: 200 })
    );

    const result = await transcribeAudio("https://example.com/audio.mp3");

    expect(result.text).toBe("Hello world, this is a test transcription.");
    expect(result.durationSeconds).toBe(65.0);
    // 65s -> ceil(65/60) = 2 minutes -> 2 * 0.67 = 1.34
    expect(result.costCents).toBeCloseTo(1.34);

    // Verify the correct endpoint and FormData body
    expect(mockElevenLabsFetch).toHaveBeenCalledOnce();
    expect(mockElevenLabsFetch.mock.calls[0][0]).toBe("/speech-to-text");
    const body = mockElevenLabsFetch.mock.calls[0][1].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("cloud_storage_url")).toBe("https://example.com/audio.mp3");
    expect(body.get("model_id")).toBe("scribe_v2");
  });

  it("uses top-level duration when no word timestamps are present", async () => {
    const sttResponse = {
      text: "No word timestamps here.",
      duration: 120.5,
    };

    mockElevenLabsFetch.mockResolvedValue(
      new Response(JSON.stringify(sttResponse), { status: 200 })
    );

    const result = await transcribeAudio("https://example.com/audio.mp3");

    expect(result.durationSeconds).toBe(120.5);
    // ceil(120.5/60) = 3 minutes -> 3 * 0.67 = 2.01
    expect(result.costCents).toBeCloseTo(2.01);
  });

  it("falls back to text-length estimate when no timestamps or duration", async () => {
    // 8 words -> 8/4 = 2 seconds -> ceil(2/60) = 1 minute
    const sttResponse = {
      text: "one two three four five six seven eight",
    };

    mockElevenLabsFetch.mockResolvedValue(
      new Response(JSON.stringify(sttResponse), { status: 200 })
    );

    const result = await transcribeAudio("https://example.com/audio.mp3");

    expect(result.durationSeconds).toBe(2);
    expect(result.costCents).toBeCloseTo(0.67);
  });

  it("falls back to upload when URL-based transcription fails with 422", async () => {
    // First call (URL-based) fails
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("Unprocessable Entity", 422)
    );

    // Second call (upload-based) succeeds
    const sttResponse = {
      text: "Uploaded transcription.",
      words: [{ text: "Uploaded", start: 0, end: 30.0, type: "word" }],
    };
    mockElevenLabsFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(sttResponse), { status: 200 })
    );

    // Mock global fetch for audio download
    const audioBlob = new Blob([new Uint8Array([0xff, 0xfb])], {
      type: "audio/mpeg",
    });
    const downloadSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(audioBlob, { status: 200 })
      );

    const result = await transcribeAudio("https://example.com/audio.mp3");

    expect(result.text).toBe("Uploaded transcription.");
    expect(result.durationSeconds).toBe(30.0);

    // elevenLabsFetch called twice: URL attempt + upload attempt
    expect(mockElevenLabsFetch).toHaveBeenCalledTimes(2);
    // global fetch called once for download
    expect(downloadSpy).toHaveBeenCalledOnce();
  });

  it("does not fall back to upload on auth errors (401)", async () => {
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("Unauthorized", 401)
    );

    await expect(
      transcribeAudio("https://example.com/audio.mp3")
    ).rejects.toThrow("Unauthorized");

    // Should only have been called once (no upload fallback)
    expect(mockElevenLabsFetch).toHaveBeenCalledOnce();
  });

  it("does not fall back to upload on auth errors (403)", async () => {
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("Forbidden", 403)
    );

    await expect(
      transcribeAudio("https://example.com/audio.mp3")
    ).rejects.toThrow("Forbidden");

    expect(mockElevenLabsFetch).toHaveBeenCalledOnce();
  });

  it("does not fall back to upload when API key is missing (503)", async () => {
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("ELEVENLABS_API_KEY is not set", 503)
    );

    await expect(
      transcribeAudio("https://example.com/audio.mp3")
    ).rejects.toThrow("ELEVENLABS_API_KEY is not set");

    expect(mockElevenLabsFetch).toHaveBeenCalledOnce();
  });

  it("throws ElevenLabsError when both URL and upload fail", async () => {
    // URL attempt fails with 500
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("Server Error", 500)
    );

    // Audio download succeeds but upload attempt fails
    const audioBlob = new Blob([new Uint8Array([0xff])]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(audioBlob, { status: 200 })
    );
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("Upload also failed", 500)
    );

    await expect(
      transcribeAudio("https://example.com/audio.mp3")
    ).rejects.toThrow("Upload also failed");
  });

  it("throws on empty audioUrl", async () => {
    await expect(transcribeAudio("")).rejects.toThrow(
      "audioUrl is required for transcription"
    );
    expect(mockElevenLabsFetch).not.toHaveBeenCalled();
  });

  it("wraps non-ElevenLabsError in upload fallback", async () => {
    // URL attempt fails
    mockElevenLabsFetch.mockRejectedValueOnce(
      new ElevenLabsError("URL failed", 500)
    );

    // Download fails with a generic error
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("Network error")
    );

    const error = await transcribeAudio(
      "https://example.com/audio.mp3"
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ElevenLabsError);
    expect((error as ElevenLabsError).message).toContain("Network error");
    expect((error as ElevenLabsError).status).toBe(500);
  });
});
