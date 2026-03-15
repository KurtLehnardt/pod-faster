import Anthropic from "@anthropic-ai/sdk";

/**
 * Model IDs — use Sonnet for heavy generation, Haiku for classification.
 */
export const MODEL_SONNET = "claude-sonnet-4-20250514";
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

/**
 * Singleton Anthropic client with lazy initialization.
 * The SDK reads ANTHROPIC_API_KEY from the environment automatically,
 * but we pass it explicitly so missing keys fail fast at init time.
 */
let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to your environment variables.",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Reset the singleton (useful in tests).
 */
export function resetAnthropicClient(): void {
  client = null;
}
