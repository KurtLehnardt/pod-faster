import { elevenLabsFetch } from "./client";

export type TTSModelId = "eleven_turbo_v2_5" | "eleven_multilingual_v2";

const DEFAULT_MODEL: TTSModelId = "eleven_turbo_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_64";

export interface TTSParams {
  /** The text to synthesize. */
  text: string;
  /** ElevenLabs voice ID. */
  voiceId: string;
  /** Model to use. Defaults to eleven_turbo_v2_5 (fast). */
  modelId?: TTSModelId;
  /** Output audio format. Defaults to mp3_44100_64. */
  outputFormat?: string;
  /**
   * Previous request IDs for voice continuity across segments.
   * ElevenLabs uses these to maintain prosody between calls.
   */
  previousRequestIds?: string[];
}

export interface TTSResult {
  /** Raw audio bytes. */
  audio: ArrayBuffer;
  /** The request ID returned by ElevenLabs (used for voice continuity). */
  requestId: string | null;
  /** Number of characters billed. */
  characterCount: number;
}

/**
 * Convert text to speech using a single voice.
 *
 * Uses POST /text-to-speech/{voice_id} with streaming disabled
 * so we receive the full audio buffer in one response.
 */
export async function textToSpeech(params: TTSParams): Promise<TTSResult> {
  const {
    text,
    voiceId,
    modelId = DEFAULT_MODEL,
    outputFormat = DEFAULT_OUTPUT_FORMAT,
    previousRequestIds,
  } = params;

  if (!text) throw new Error("text is required for TTS");
  if (!voiceId) throw new Error("voiceId is required for TTS");

  const body: Record<string, unknown> = {
    text,
    model_id: modelId,
    output_format: outputFormat,
  };

  if (previousRequestIds?.length) {
    body.previous_request_ids = previousRequestIds;
  }

  const response = await elevenLabsFetch(
    `/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const audio = await response.arrayBuffer();
  const requestId = response.headers.get("request-id");

  return {
    audio,
    requestId,
    characterCount: text.length,
  };
}
