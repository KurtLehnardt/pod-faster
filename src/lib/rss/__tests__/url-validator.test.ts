import { describe, expect, it } from "vitest";
import { isAllowedUrl, validateFeedUrl } from "../url-validator";

describe("validateFeedUrl", () => {
  // ── Valid URLs ────────────────────────────────────────────

  it("accepts a valid HTTPS feed URL", () => {
    const result = validateFeedUrl("https://feeds.example.com/podcast.xml");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a valid HTTP feed URL", () => {
    const result = validateFeedUrl("http://feeds.example.com/rss");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a URL with a port number", () => {
    const result = validateFeedUrl("https://feeds.example.com:8443/feed");
    expect(result).toEqual({ valid: true });
  });

  it("accepts a URL with query parameters", () => {
    const result = validateFeedUrl(
      "https://feeds.example.com/rss?format=xml&limit=50"
    );
    expect(result).toEqual({ valid: true });
  });

  it("accepts a URL with a path", () => {
    const result = validateFeedUrl(
      "https://example.com/podcasts/my-show/feed.xml"
    );
    expect(result).toEqual({ valid: true });
  });

  // ── Empty / missing ──────────────────────────────────────

  it("rejects an empty string", () => {
    const result = validateFeedUrl("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("URL is required");
  });

  it("rejects undefined-like input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validateFeedUrl(null as any);
    expect(result.valid).toBe(false);
  });

  // ── Length ────────────────────────────────────────────────

  it("rejects a URL exceeding 2048 characters", () => {
    const longUrl = "https://example.com/" + "a".repeat(2048);
    const result = validateFeedUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("2048");
  });

  // ── Scheme ────────────────────────────────────────────────

  it("rejects ftp:// scheme", () => {
    const result = validateFeedUrl("ftp://feeds.example.com/rss");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ftp");
  });

  it("rejects file:// scheme", () => {
    const result = validateFeedUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("file");
  });

  it("rejects javascript: scheme", () => {
    // URL constructor may throw on javascript: scheme
    const result = validateFeedUrl("javascript:alert(1)");
    expect(result.valid).toBe(false);
  });

  it("rejects data: scheme", () => {
    const result = validateFeedUrl("data:text/html,<h1>hi</h1>");
    expect(result.valid).toBe(false);
  });

  // ── Credentials ───────────────────────────────────────────

  it("rejects a URL with user:pass@", () => {
    const result = validateFeedUrl("https://admin:secret@feeds.example.com/rss");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("credentials");
  });

  it("rejects a URL with only user@", () => {
    const result = validateFeedUrl("https://admin@feeds.example.com/rss");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("credentials");
  });

  // ── Private IPv4 ranges ───────────────────────────────────

  it("blocks 10.x.x.x (RFC 1918)", () => {
    expect(validateFeedUrl("https://10.0.0.1/feed").valid).toBe(false);
    expect(validateFeedUrl("https://10.255.255.255/feed").valid).toBe(false);
  });

  it("blocks 172.16-31.x.x (RFC 1918)", () => {
    expect(validateFeedUrl("https://172.16.0.1/feed").valid).toBe(false);
    expect(validateFeedUrl("https://172.31.255.255/feed").valid).toBe(false);
  });

  it("allows 172.15.x.x and 172.32.x.x (not RFC 1918)", () => {
    expect(validateFeedUrl("https://172.15.0.1/feed").valid).toBe(true);
    expect(validateFeedUrl("https://172.32.0.1/feed").valid).toBe(true);
  });

  it("blocks 192.168.x.x (RFC 1918)", () => {
    expect(validateFeedUrl("https://192.168.1.1/feed").valid).toBe(false);
    expect(validateFeedUrl("https://192.168.0.100/feed").valid).toBe(false);
  });

  it("blocks 127.x.x.x (loopback)", () => {
    expect(validateFeedUrl("https://127.0.0.1/feed").valid).toBe(false);
    expect(validateFeedUrl("https://127.255.255.255/feed").valid).toBe(false);
  });

  it("blocks 169.254.x.x (link-local)", () => {
    expect(validateFeedUrl("https://169.254.1.1/feed").valid).toBe(false);
  });

  it("blocks 0.0.0.0", () => {
    expect(validateFeedUrl("https://0.0.0.0/feed").valid).toBe(false);
  });

  // ── Private IPv6 ranges ───────────────────────────────────

  it("blocks ::1 (IPv6 loopback)", () => {
    expect(validateFeedUrl("https://[::1]/feed").valid).toBe(false);
  });

  it("blocks fc00:: (IPv6 unique local)", () => {
    expect(validateFeedUrl("https://[fc00::1]/feed").valid).toBe(false);
  });

  it("blocks fd00:: (IPv6 unique local)", () => {
    expect(validateFeedUrl("https://[fd12:3456::1]/feed").valid).toBe(false);
  });

  it("blocks fe80:: (IPv6 link-local)", () => {
    expect(validateFeedUrl("https://[fe80::1]/feed").valid).toBe(false);
  });

  // ── Hostname-based SSRF vectors ──────────────────────────

  it("blocks localhost", () => {
    expect(validateFeedUrl("https://localhost/feed").valid).toBe(false);
    expect(validateFeedUrl("https://localhost/feed").error).toContain(
      "private or internal"
    );
  });

  it("blocks LOCALHOST (case-insensitive)", () => {
    expect(validateFeedUrl("https://LOCALHOST/feed").valid).toBe(false);
  });

  it("blocks localhost with port", () => {
    expect(validateFeedUrl("https://localhost:8080/feed").valid).toBe(false);
  });

  it("blocks cloud metadata hostname (metadata.google.internal)", () => {
    expect(
      validateFeedUrl(
        "http://metadata.google.internal/computeMetadata/v1/"
      ).valid
    ).toBe(false);
  });

  it("blocks *.local domains", () => {
    expect(validateFeedUrl("https://something.local/feed").valid).toBe(false);
  });

  it("blocks *.internal domains", () => {
    expect(validateFeedUrl("https://something.internal/feed").valid).toBe(
      false
    );
  });

  it("blocks [::1] hostname", () => {
    expect(validateFeedUrl("http://[::1]/feed").valid).toBe(false);
  });

  it("blocks cloud metadata IP (169.254.169.254)", () => {
    expect(
      validateFeedUrl("http://169.254.169.254/latest/meta-data/").valid
    ).toBe(false);
  });

  it("blocks 0.0.0.0 hostname", () => {
    expect(validateFeedUrl("http://0.0.0.0/feed").valid).toBe(false);
  });

  // ── Malformed URLs ────────────────────────────────────────

  it("rejects a non-URL string", () => {
    const result = validateFeedUrl("not-a-url");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid URL format");
  });
});

describe("isAllowedUrl", () => {
  it("returns true for a valid URL", () => {
    expect(isAllowedUrl("https://feeds.example.com/podcast.xml")).toBe(true);
  });

  it("returns false for a private IP", () => {
    expect(isAllowedUrl("https://192.168.1.1/feed")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAllowedUrl("")).toBe(false);
  });
});
