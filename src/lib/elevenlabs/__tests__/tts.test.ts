import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textToSpeech } from "../tts";
import { resetClient } from "../client";

const originalEnv = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  resetClient();
  process.env.ELEVENLABS_API_KEY = "test-key";
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.ELEVENLABS_API_KEY = originalEnv;
  } else {
    delete process.env.ELEVENLABS_API_KEY;
  }
});

describe("textToSpeech", () => {
  it("calls the correct endpoint and returns audio buffer", async () => {
    const fakeAudio = new Uint8Array([0x49, 0x44, 0x33]).buffer;
    const mockResponse = new Response(fakeAudio, {
      status: 200,
      headers: { "request-id": "req-abc-123" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await textToSpeech({
      text: "Hello world",
      voiceId: "voice-1",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/text-to-speech/voice-1");
    expect(url).toContain("output_format=mp3_44100_64");

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.model_id).toBe("eleven_turbo_v2_5");
    expect(body.text).toBe("Hello world");

    expect(result.audio.byteLength).toBe(3);
    expect(result.requestId).toBe("req-abc-123");
    expect(result.characterCount).toBe(11);
  });

  it("sends previous_request_ids when provided", async () => {
    const fakeAudio = new Uint8Array([0x00]).buffer;
    const mockResponse = new Response(fakeAudio, {
      status: 200,
      headers: {},
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await textToSpeech({
      text: "Hi",
      voiceId: "voice-2",
      previousRequestIds: ["prev-1", "prev-2"],
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.previous_request_ids).toEqual(["prev-1", "prev-2"]);
    expect(result.requestId).toBeNull();
  });

  it("throws on empty text", async () => {
    await expect(
      textToSpeech({ text: "", voiceId: "voice-1" })
    ).rejects.toThrow("text is required");
  });

  it("throws on empty voiceId", async () => {
    await expect(
      textToSpeech({ text: "Hello", voiceId: "" })
    ).rejects.toThrow("voiceId is required");
  });

  it("uses custom model when specified", async () => {
    const fakeAudio = new Uint8Array([0x00]).buffer;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeAudio, { status: 200 })
    );

    await textToSpeech({
      text: "Hello",
      voiceId: "voice-1",
      modelId: "eleven_multilingual_v2",
    });

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string
    );
    expect(body.model_id).toBe("eleven_multilingual_v2");
  });
});
