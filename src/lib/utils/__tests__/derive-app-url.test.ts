import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deriveAppUrl } from "../derive-app-url";

/**
 * Unit tests for deriveAppUrl.
 *
 * The function resolves the app base URL via this fallback chain:
 *   1. x-forwarded-proto + host headers
 *   2. Explicit fallbackOrigin parameter
 *   3. NEXT_PUBLIC_APP_URL env var
 *   4. Hardcoded production URL
 */

function makeHeaders(entries: Record<string, string> = {}): Headers {
  return new Headers(entries);
}

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

  it("returns proto://host when both headers are present", () => {
    const headers = makeHeaders({
      "x-forwarded-proto": "https",
      host: "pod-faster.vercel.app",
    });
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });

  it("falls back to fallbackOrigin when only host is present (no proto)", () => {
    const headers = makeHeaders({ host: "pod-faster.vercel.app" });
    expect(deriveAppUrl(headers, "https://fallback.example.com")).toBe(
      "https://fallback.example.com"
    );
  });

  it("falls back to fallbackOrigin when neither header is present", () => {
    const headers = makeHeaders();
    expect(deriveAppUrl(headers, "https://fallback.example.com")).toBe(
      "https://fallback.example.com"
    );
  });

  it("falls back to NEXT_PUBLIC_APP_URL when no headers and no fallbackOrigin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const headers = makeHeaders();
    expect(deriveAppUrl(headers)).toBe("http://localhost:3000");
  });

  it("falls back to hardcoded production URL when nothing else is available", () => {
    const headers = makeHeaders();
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });

  it("headers win over NEXT_PUBLIC_APP_URL (the bug fix)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const headers = makeHeaders({
      "x-forwarded-proto": "https",
      host: "pod-faster.vercel.app",
    });
    expect(deriveAppUrl(headers)).toBe("https://pod-faster.vercel.app");
  });
});
