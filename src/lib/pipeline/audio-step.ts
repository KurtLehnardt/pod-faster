/**
 * Pipeline Step 4 — AUDIO
 *
 * Converts the podcast script into audio using ElevenLabs.
 * - Monologue: uses textToSpeech() with a single voice
 * - Interview / group_chat: uses textToDialogue() with multiple voices
 */

import type { EpisodeStyle, EpisodeScript } from "@/types/episode";
import { textToSpeech } from "@/lib/elevenlabs/tts";
import { textToDialogue } from "@/lib/elevenlabs/dialogue";

export interface AudioStepParams {
  script: EpisodeScript;
  style: EpisodeStyle;
}

export interface AudioStepResult {
  audio: ArrayBuffer;
  charactersUsed: number;
}

/**
 * Generate audio from a podcast script.
 *
 * For monologue style, all segments are concatenated into a single TTS call
 * per segment with voice continuity. For multi-voice styles, the dialogue
 * API is used to produce natural speaker transitions.
 */
export async function audioStep(
  params: AudioStepParams
): Promise<AudioStepResult> {
  const { script, style } = params;

  if (script.segments.length === 0) {
    throw new Error("Cannot generate audio: script has no segments");
  }

  const totalChars = script.segments.reduce(
    (sum, seg) => sum + seg.text.length,
    0
  );

  if (style === "monologue") {
    return monologueAudio(script, totalChars);
  }

  return dialogueAudio(script, totalChars);
}

/**
 * Monologue: sequential TTS calls with voice continuity.
 */
async function monologueAudio(
  script: EpisodeScript,
  totalChars: number
): Promise<AudioStepResult> {
  const buffers: ArrayBuffer[] = [];
  const previousRequestIds: string[] = [];

  for (const segment of script.segments) {
    const result = await textToSpeech({
      text: segment.text,
      voiceId: segment.voice_id,
      previousRequestIds: previousRequestIds.slice(-3),
    });

    buffers.push(result.audio);
    if (result.requestId) {
      previousRequestIds.push(result.requestId);
    }
  }

  const audio = concatArrayBuffers(buffers);
  return { audio, charactersUsed: totalChars };
}

/**
 * Interview / Group Chat: use the dialogue API for multi-voice.
 */
async function dialogueAudio(
  script: EpisodeScript,
  totalChars: number
): Promise<AudioStepResult> {
  const segments = script.segments.map((seg) => ({
    text: seg.text,
    voice_id: seg.voice_id,
  }));

  const result = await textToDialogue({ segments });

  return { audio: result.audio, charactersUsed: totalChars };
}

/**
 * Concatenate multiple ArrayBuffers into one.
 */
function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer as ArrayBuffer;
}
