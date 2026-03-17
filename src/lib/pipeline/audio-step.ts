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
 * Monologue: single TTS call with all segment texts joined.
 * Produces one MP3 file with correct headers and seek table.
 */
async function monologueAudio(
  script: EpisodeScript,
  totalChars: number,
  modelId?: TTSModelId,
): Promise<AudioStepResult> {
  const fullText = script.segments.map((s) => s.text).join("\n\n");
  const voiceId = script.segments[0].voice_id;

  const result = await textToSpeech({ text: fullText, voiceId, modelId });
  return { audio: result.audio, charactersUsed: totalChars };
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
