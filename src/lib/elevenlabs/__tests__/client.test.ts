import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { elevenLabsFetch, ElevenLabsError, resetClient } from "../client";

// Store original env
const originalEnv = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  resetClient();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.ELEVENLABS_API_KEY = originalEnv;
  } else {
    delete process.env.ELEVENLABS_API_KEY;
  }
});

describe("elevenLabsFetch", () => {
  it("throws when ELEVENLABS_API_KEY is not set", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    await expect(elevenLabsFetch("/voices")).rejects.toThrow(
      "ELEVENLABS_API_KEY environment variable is not set"
    );
  });

  it("sends the api key header and makes a successful request", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key-123";

    const mockResponse = new Response(JSON.stringify({ voices: [] }), {
      status: 200,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const response = await elevenLabsFetch("/voices");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe("https://api.elevenlabs.io/v1/voices");
    expect((callArgs[1]?.headers as Record<string, string>)["xi-api-key"]).toBe(
      "test-key-123"
    );
    expect(response.status).toBe(200);
  });

  it("retries on 429 with exponential backoff", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key-123";

    const rateLimitResponse = new Response("Rate limited", { status: 429 });
    const okResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(okResponse);

    // Speed up the backoff for testing
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void
    ) => {
      fn();
      return 0;
    }) as typeof setTimeout);

    const response = await elevenLabsFetch("/voices", {}, 3);
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws ElevenLabsError on non-429 error responses", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key-123";

    const errorResponse = new Response(
      JSON.stringify({ detail: "Not found" }),
      { status: 404, statusText: "Not Found" }
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse);

    try {
      await elevenLabsFetch("/nonexistent");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ElevenLabsError);
      const e = err as ElevenLabsError;
      expect(e.status).toBe(404);
      expect(e.message).toContain("404");
      expect(e.message).toContain("/nonexistent");
    }
  });

  it("throws after exhausting all retries on persistent 429", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key-123";

    const rateLimitResponse = () => new Response("Rate limited", { status: 429 });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(rateLimitResponse());

    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void
    ) => {
      fn();
      return 0;
    }) as typeof setTimeout);

    try {
      await elevenLabsFetch("/voices", {}, 3);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ElevenLabsError);
      const e = err as ElevenLabsError;
      expect(e.status).toBe(429);
    }
  });
});
