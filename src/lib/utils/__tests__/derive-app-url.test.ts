import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deriveAppUrl } from "../derive-app-url";

/**
 * Unit tests for deriveAppUrl — verifies the fallback chain:
 *   1. x-forwarded-proto + host headers
 *   2. fallbackOrigin parameter
 *   3. NEXT_PUBLIC_APP_URL env var
 *   4. Hardcoded production URL
 */
describe("deriveAppUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_APP_URL;
    }
  });

  function makeHeaders(entries: Record<string, string>): Headers {
    return new Headers(entries);
  }

  it("returns proto://host when both x-forwarded-proto and host are present", () => {
    const headers = makeHeaders({
      "x-forwarded-proto": "https",
      host: "pod-faster.vercel.app",
    });
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });

  it("falls back to fallbackOrigin when only host is present (no proto)", () => {
    const headers = makeHeaders({ host: "pod-faster.vercel.app" });
    const result = deriveAppUrl(headers, "https://fallback.example.com");
    expect(result).toBe("https://fallback.example.com");
  });

  it("returns fallbackOrigin when neither header is present", () => {
    const headers = makeHeaders({});
    const result = deriveAppUrl(headers, "https://fallback.example.com");
    expect(result).toBe("https://fallback.example.com");
  });

  it("returns NEXT_PUBLIC_APP_URL when no headers and no fallbackOrigin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://env-url.example.com";
    const headers = makeHeaders({});
    expect(deriveAppUrl(headers)).toBe("https://env-url.example.com");
  });

  it("returns hardcoded production URL when nothing else is available", () => {
    const headers = makeHeaders({});
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });

  it("prefers headers over env var (the bug fix)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const headers = makeHeaders({
      "x-forwarded-proto": "https",
      host: "pod-faster.vercel.app",
    });
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });
});
