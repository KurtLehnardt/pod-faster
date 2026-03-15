import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textToDialogue } from "../dialogue";
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

describe("textToDialogue", () => {
  it("uses the dialogue API on success", async () => {
    const fakeAudio = new Uint8Array([0x01, 0x02, 0x03]).buffer;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(fakeAudio, { status: 200 })
    );

    const result = await textToDialogue({
      segments: [
        { text: "Hello", voice_id: "v1" },
        { text: "Hi there", voice_id: "v2" },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/text-to-dialogue");

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.model_id).toBe("eleven_v3");
    expect(body.text).toHaveLength(2);

    expect(result.usedDialogueApi).toBe(true);
    expect(result.characterCount).toBe(13); // "Hello" + "Hi there"
    expect(result.audio.byteLength).toBe(3);
  });

  it("falls back to sequential TTS when dialogue API fails", async () => {
    const audio1 = new Uint8Array([0x01, 0x02]);
    const audio2 = new Uint8Array([0x03, 0x04]);

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      callCount++;
      const urlStr = typeof url === "string" ? url : url.toString();

      // First call is dialogue API - make it fail
      if (urlStr.includes("/text-to-dialogue")) {
        return new Response("Server error", { status: 500, statusText: "Internal Server Error" });
      }

      // Subsequent calls are individual TTS
      if (urlStr.includes("/text-to-speech/v1")) {
        return new Response(audio1.buffer, {
          status: 200,
          headers: { "request-id": "req-1" },
        });
      }
      if (urlStr.includes("/text-to-speech/v2")) {
        return new Response(audio2.buffer, {
          status: 200,
          headers: { "request-id": "req-2" },
        });
      }

      return new Response("Not found", { status: 404, statusText: "Not Found" });
    });

    const result = await textToDialogue({
      segments: [
        { text: "Hello", voice_id: "v1" },
        { text: "World", voice_id: "v2" },
      ],
    });

    expect(result.usedDialogueApi).toBe(false);
    expect(result.characterCount).toBe(10);
    // Concatenated: [0x01, 0x02, 0x03, 0x04]
    expect(result.audio.byteLength).toBe(4);
    const combined = new Uint8Array(result.audio);
    expect(Array.from(combined)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("throws on empty segments", async () => {
    await expect(
      textToDialogue({ segments: [] })
    ).rejects.toThrow("At least one dialogue segment is required");
  });
});
