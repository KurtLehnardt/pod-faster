/**
 * Pipeline Step 4 — AUDIO
 *
 * Converts the podcast script into audio using ElevenLabs.
 * - Monologue: uses textToSpeech() with a single voice (one call for all segments)
 * - Interview / group_chat: uses textToDialogue() with multiple voices
 */

import type { EpisodeStyle, EpisodeScript } from "@/types/episode";
import type { TTSModelId } from "@/lib/elevenlabs/tts";
import { textToSpeech } from "@/lib/elevenlabs/tts";
import { textToDialogue } from "@/lib/elevenlabs/dialogue";

export interface AudioStepParams {
  script: EpisodeScript;
  style: EpisodeStyle;
  language?: string;
}

export interface AudioStepResult {
  audio: ArrayBuffer;
  charactersUsed: number;
}

/**
 * Generate audio from a podcast script.
 *
 * For monologue style, all segment texts are joined and sent as a single
 * TTS call, producing one properly-encoded MP3 with correct seek support.
 * For multi-voice styles, the dialogue API handles speaker transitions.
 *
 * Non-English languages use the multilingual TTS model.
 */
export async function audioStep(
  params: AudioStepParams
): Promise<AudioStepResult> {
  const { script, style, language } = params;

  if (script.segments.length === 0) {
    throw new Error("Cannot generate audio: script has no segments");
  }

  const totalChars = script.segments.reduce(
    (sum, seg) => sum + seg.text.length,
    0
  );

  const modelId: TTSModelId | undefined =
    language && language !== "en" ? "eleven_multilingual_v2" : undefined;

  if (style === "monologue") {
    return monologueAudio(script, totalChars, modelId);
  }

  return dialogueAudio(script, totalChars, modelId);
}

/**
 * ElevenLabs per-request character limit. Chunks exceeding this are
 * sent as separate TTS calls and concatenated.
 */
const TTS_CHAR_LIMIT = 5000;

/**
 * Monologue: single TTS call with all segment texts joined.
 * Produces one MP3 file with correct headers and seek table.
 * For long scripts exceeding the ElevenLabs character limit,
 * text is chunked at paragraph boundaries.
 */
async function monologueAudio(
  script: EpisodeScript,
  totalChars: number,
  modelId?: TTSModelId,
): Promise<AudioStepResult> {
  const fullText = script.segments.map((s) => s.text).join("\n\n");
  const voiceId = script.segments[0].voice_id;

  if (fullText.length <= TTS_CHAR_LIMIT) {
    const result = await textToSpeech({ text: fullText, voiceId, modelId });
    return { audio: result.audio, charactersUsed: totalChars };
  }

  // Chunk at paragraph boundaries to stay under the per-request limit
  const chunks = chunkText(fullText, TTS_CHAR_LIMIT);
  const buffers: ArrayBuffer[] = [];
  const previousRequestIds: string[] = [];

  for (const chunk of chunks) {
    const result = await textToSpeech({
      text: chunk,
      voiceId,
      modelId,
      previousRequestIds: previousRequestIds.slice(-3),
    });
    buffers.push(result.audio);
    if (result.requestId) {
      previousRequestIds.push(result.requestId);
    }
  }

  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  return { audio: combined.buffer as ArrayBuffer, charactersUsed: totalChars };
}

/**
 * Split text into chunks at paragraph boundaries (\n\n),
 * each under the given character limit.
 */
function chunkText(text: string, limit: number): string[] {
  const paragraphs = text.split("\n\n");
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const addition = current ? `\n\n${para}` : para;
    if (current.length + addition.length > limit && current) {
      chunks.push(current);
      current = para;
    } else {
      current += addition;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * Interview / Group Chat: use the dialogue API for multi-voice.
 */
async function dialogueAudio(
  script: EpisodeScript,
  totalChars: number,
  modelId?: TTSModelId,
): Promise<AudioStepResult> {
  const segments = script.segments.map((seg) => ({
    text: seg.text,
    voice_id: seg.voice_id,
  }));

  const result = await textToDialogue({
    segments,
    ...(modelId ? { modelId } : {}),
  });

  return { audio: result.audio, charactersUsed: totalChars };
}
