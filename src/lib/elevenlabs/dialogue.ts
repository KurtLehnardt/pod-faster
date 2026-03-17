import { elevenLabsFetch } from "./client";
import { textToSpeech } from "./tts";

export interface DialogueSegment {
  text: string;
  voice_id: string;
}

export interface DialogueParams {
  /** Ordered segments of dialogue, each with text and a voice ID. */
  segments: DialogueSegment[];
  /** Model to use for the dialogue API. Defaults to eleven_v3. */
  modelId?: string;
}

export interface DialogueResult {
  /** Combined audio bytes. */
  audio: ArrayBuffer;
  /** Total characters across all segments. */
  characterCount: number;
  /** Whether the primary dialogue API was used or the fallback. */
  usedDialogueApi: boolean;
}

/**
 * Generate multi-voice dialogue audio.
 *
 * Primary path: POST /text-to-dialogue (produces natural speaker transitions).
 * Fallback: sequential textToSpeech calls with previous_request_ids for
 *   voice continuity, then concatenate the raw audio buffers.
 */
export async function textToDialogue(
  params: DialogueParams
): Promise<DialogueResult> {
  const { segments, modelId = "eleven_v3" } = params;

  if (!segments.length) {
    throw new Error("At least one dialogue segment is required");
  }

  const totalChars = segments.reduce((sum, s) => sum + s.text.length, 0);

  // --- Primary: Dialogue API ---
  try {
    const body = {
      model_id: modelId,
      text: segments.map((s) => ({
        text: s.text,
        voice_id: s.voice_id,
      })),
    };

    const response = await elevenLabsFetch("/text-to-dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const audio = await response.arrayBuffer();
    return { audio, characterCount: totalChars, usedDialogueApi: true };
  } catch {
    // Fall through to concatenation fallback.
  }

  // --- Fallback: sequential TTS + concatenation ---
  return fallbackConcatenation(segments, totalChars, modelId);
}

/**
 * Fallback: call textToSpeech per segment with voice-continuity IDs,
 * then concatenate the resulting ArrayBuffers.
 */
async function fallbackConcatenation(
  segments: DialogueSegment[],
  totalChars: number,
  modelId?: string,
): Promise<DialogueResult> {
  const buffers: ArrayBuffer[] = [];
  const previousRequestIds: string[] = [];

  for (const segment of segments) {
    const result = await textToSpeech({
      text: segment.text,
      voiceId: segment.voice_id,
      modelId: modelId as import("./tts").TTSModelId | undefined,
      previousRequestIds: previousRequestIds.slice(-3), // ElevenLabs accepts up to 3
    });

    buffers.push(result.audio);

    if (result.requestId) {
      previousRequestIds.push(result.requestId);
    }
  }

  const audio = concatArrayBuffers(buffers);
  return { audio, characterCount: totalChars, usedDialogueApi: false };
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
