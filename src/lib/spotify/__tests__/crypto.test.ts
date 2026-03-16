import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  encryptToken,
  decryptToken,
  TokenEncryptionError,
} from "../crypto";

// Valid 64-hex-char key (32 bytes) for tests
const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("spotify token crypto", () => {
  beforeEach(() => {
    vi.stubEnv("SPOTIFY_TOKEN_ENCRYPTION_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("encrypts and decrypts a token roundtrip", () => {
    const original = "BQDj3xkO2z9PqR...some-spotify-access-token";
    const encrypted = encryptToken(original);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const original = "same-value-every-time";
    const a = encryptToken(original);
    const b = encryptToken(original);
    expect(a).not.toBe(b);

    // But both decrypt to the same value
    expect(decryptToken(a)).toBe(original);
    expect(decryptToken(b)).toBe(original);
  });

  it("throws TokenEncryptionError on tampered ciphertext", () => {
    const encrypted = encryptToken("secret-data");
    const parts = encrypted.split(":");
    // Tamper with the ciphertext portion
    const ciphertextBuf = Buffer.from(parts[2], "base64");
    ciphertextBuf[0] ^= 0xff;
    parts[2] = ciphertextBuf.toString("base64");
    const tampered = parts.join(":");

    expect(() => decryptToken(tampered)).toThrow(TokenEncryptionError);
  });

  it("throws TokenEncryptionError on tampered auth tag", () => {
    const encrypted = encryptToken("secret-data");
    const parts = encrypted.split(":");
    // Tamper with the auth tag portion
    const authTagBuf = Buffer.from(parts[1], "base64");
    authTagBuf[0] ^= 0xff;
    parts[1] = authTagBuf.toString("base64");
    const tampered = parts.join(":");

    expect(() => decryptToken(tampered)).toThrow(TokenEncryptionError);
  });

  it("throws TokenEncryptionError when env var is missing", () => {
    vi.stubEnv("SPOTIFY_TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptToken("test")).toThrow(TokenEncryptionError);
    expect(() => encryptToken("test")).toThrow("is not set");
  });

  it("throws TokenEncryptionError when env var is undefined", () => {
    delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("test")).toThrow(TokenEncryptionError);
  });

  it("throws TokenEncryptionError when key is wrong length", () => {
    vi.stubEnv("SPOTIFY_TOKEN_ENCRYPTION_KEY", "abcd1234");
    expect(() => encryptToken("test")).toThrow(TokenEncryptionError);
    expect(() => encryptToken("test")).toThrow("64 hex characters");
  });

  it("throws TokenEncryptionError when key contains non-hex chars", () => {
    vi.stubEnv(
      "SPOTIFY_TOKEN_ENCRYPTION_KEY",
      "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    );
    expect(() => encryptToken("test")).toThrow(TokenEncryptionError);
  });

  it("encrypts and decrypts empty string", () => {
    const encrypted = encryptToken("");
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe("");
  });

  it("encrypts and decrypts long string (1000+ chars)", () => {
    const long = "x".repeat(2000);
    const encrypted = encryptToken(long);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(long);
  });

  it("throws TokenEncryptionError on malformed encrypted string (missing parts)", () => {
    expect(() => decryptToken("onlyonepart")).toThrow(TokenEncryptionError);
    expect(() => decryptToken("two:parts")).toThrow(TokenEncryptionError);
    expect(() => decryptToken("a:b:c:d")).toThrow(TokenEncryptionError);
  });

  it("throws TokenEncryptionError on malformed encrypted string (bad IV length)", () => {
    // Produce valid encrypted string, then replace IV with wrong-length value
    const encrypted = encryptToken("test");
    const parts = encrypted.split(":");
    parts[0] = Buffer.from("short").toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow(TokenEncryptionError);
    expect(() => decryptToken(parts.join(":"))).toThrow("IV must be");
  });

  it("throws TokenEncryptionError on malformed encrypted string (bad auth tag length)", () => {
    const encrypted = encryptToken("test");
    const parts = encrypted.split(":");
    parts[1] = Buffer.from("short").toString("base64");
    expect(() => decryptToken(parts.join(":"))).toThrow(TokenEncryptionError);
    expect(() => decryptToken(parts.join(":"))).toThrow("auth tag must be");
  });

  it("encrypted output has exactly 3 colon-separated base64 parts", () => {
    const encrypted = encryptToken("check-format");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);

    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it("handles unicode content", () => {
    const unicode = "Hello, \u4e16\u754c! \u{1f680}\u{1f30d}";
    const encrypted = encryptToken(unicode);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(unicode);
  });
});
