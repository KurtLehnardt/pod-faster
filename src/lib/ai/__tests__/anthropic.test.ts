import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getAnthropicClient,
  resetAnthropicClient,
  MODEL_SONNET,
  MODEL_HAIKU,
} from "../anthropic";

// Mock the Anthropic SDK module with a real class so `new Anthropic()` works
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    apiKey: string;
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  return { default: MockAnthropic };
});

describe("anthropic client", () => {
  beforeEach(() => {
    resetAnthropicClient();
    vi.unstubAllEnvs();
  });

  it("exports correct model constants", () => {
    expect(MODEL_SONNET).toBe("claude-sonnet-4-20250514");
    expect(MODEL_HAIKU).toBe("claude-haiku-4-5-20251001");
  });

  it("throws when ANTHROPIC_API_KEY is missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => getAnthropicClient()).toThrow("ANTHROPIC_API_KEY is not set");
  });

  it("returns a client when ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-123");
    const client = getAnthropicClient();
    expect(client).toBeDefined();
  });

  it("returns the same singleton on multiple calls", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-123");
    const a = getAnthropicClient();
    const b = getAnthropicClient();
    expect(a).toBe(b);
  });

  it("creates a fresh client after reset", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-123");
    const a = getAnthropicClient();
    resetAnthropicClient();
    const b = getAnthropicClient();
    expect(a).not.toBe(b);
  });
});
