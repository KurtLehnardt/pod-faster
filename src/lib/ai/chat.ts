/**
 * Chat completion helper — wraps the Anthropic messages API.
 *
 * Provides:
 *  - Non-streaming completions with JSON parsing
 *  - Streaming completions via async generator
 *  - Token counting and usage tracking
 *  - Chat assistant system prompt for the explore/configure flow
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, MODEL_SONNET, MODEL_HAIKU } from "./anthropic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionOptions {
  system: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  stopReason: string | null;
}

export interface StreamChunk {
  type: "text" | "usage" | "done";
  text?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Chat assistant system prompt (explore topics + configure episodes)
// ---------------------------------------------------------------------------

export function chatAssistantSystemPrompt(): string {
  return `You are the Pod Faster assistant. You help users explore news topics and configure podcast episodes.

Your capabilities:
1. Help users discover interesting news topics through conversation.
2. Suggest angles, perspectives, and related stories.
3. Guide users in configuring their episode (style, tone, length).
4. Explain the available episode styles: monologue, interview, group_chat.
5. Explain the available tones: serious, lighthearted, dark_mystery, business_news.

Behavior:
- Be concise and helpful. No filler.
- When the user expresses interest in a topic, confirm it and ask about preferences (style, tone, length).
- When the user has configured everything, summarize the episode config for confirmation.
- Never fabricate news. If you don't know something, say so.
- Keep responses under 200 words unless the user asks for detail.`;
}

// ---------------------------------------------------------------------------
// Non-streaming completion
// ---------------------------------------------------------------------------

export async function complete(
  options: CompletionOptions,
): Promise<CompletionResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: options.model ?? MODEL_SONNET,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
    system: options.system,
    messages: [{ role: "user", content: options.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock && "text" in textBlock ? textBlock.text : "";

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
    stopReason: response.stop_reason,
  };
}

// ---------------------------------------------------------------------------
// Streaming completion (async generator)
// ---------------------------------------------------------------------------

export async function* stream(
  options: CompletionOptions,
): AsyncGenerator<StreamChunk> {
  const client = getAnthropicClient();

  const streamResponse = client.messages.stream({
    model: options.model ?? MODEL_SONNET,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0,
    system: options.system,
    messages: [{ role: "user", content: options.userPrompt }],
  });

  const messageStream = await streamResponse;

  for await (const event of messageStream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }

  const finalMessage = await messageStream.finalMessage();

  yield {
    type: "usage",
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };

  yield { type: "done" };
}

// ---------------------------------------------------------------------------
// Convenience: complete and parse JSON
// ---------------------------------------------------------------------------

export async function completeJson<T>(
  options: CompletionOptions,
  parser: (raw: string) => T,
): Promise<{ data: T; usage: CompletionResult["usage"]; model: string }> {
  const result = await complete(options);
  const data = parser(result.content);
  return { data, usage: result.usage, model: result.model };
}

// ---------------------------------------------------------------------------
// Re-export model constants for convenience
// ---------------------------------------------------------------------------

export { MODEL_SONNET, MODEL_HAIKU };
