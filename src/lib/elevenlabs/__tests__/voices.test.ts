import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listVoices, invalidateVoiceCache } from "../voices";
import { resetClient } from "../client";

const originalEnv = process.env.ELEVENLABS_API_KEY;

const MOCK_VOICES_RESPONSE = {
  voices: [
    {
      voice_id: "v1",
      name: "Rachel",
      category: "premade",
      description: "Calm and clear",
      preview_url: "https://example.com/rachel.mp3",
      labels: { accent: "american", gender: "female" },
    },
    {
      voice_id: "v2",
      name: "Drew",
      category: "premade",
    },
  ],
};

beforeEach(() => {
  resetClient();
  invalidateVoiceCache();
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

describe("listVoices", () => {
  it("fetches and maps voices from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_VOICES_RESPONSE), { status: 200 })
    );

    const voices = await listVoices();

    expect(voices).toHaveLength(2);
    expect(voices[0]).toEqual({
      voice_id: "v1",
      name: "Rachel",
      category: "premade",
      description: "Calm and clear",
      preview_url: "https://example.com/rachel.mp3",
      labels: { accent: "american", gender: "female" },
    });
    expect(voices[1]).toEqual({
      voice_id: "v2",
      name: "Drew",
      category: "premade",
      description: undefined,
      preview_url: undefined,
      labels: undefined,
    });
  });

  it("caches results and does not re-fetch within TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_VOICES_RESPONSE), { status: 200 })
    );

    await listVoices();
    await listVoices();
    await listVoices();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after cache invalidation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(MOCK_VOICES_RESPONSE), { status: 200 })
    );

    await listVoices();
    invalidateVoiceCache();
    await listVoices();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
