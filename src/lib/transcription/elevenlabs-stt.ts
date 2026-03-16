/**
 * ElevenLabs Speech-to-Text client.
 *
 * Uses the existing elevenLabsFetch helper for authentication and retry logic.
 * Attempts URL-based transcription first; falls back to stream-download + upload.
 */

import {
  elevenLabsFetch,
  ElevenLabsError,
} from "@/lib/elevenlabs/client";

// ── Public types ────────────────────────────────────────────

export interface SttResult {
  /** Full transcription text. */
  text: string;
  /** Audio duration in seconds (derived from word timestamps or API). */
  durationSeconds: number;
  /** Estimated cost in cents: ceil(minutes) * 0.67. */
  costCents: number;
}

// ── Internal types for the ElevenLabs STT response ──────────

interface SttWord {
  text: string;
  start: number;
  end: number;
  type: string;
}

interface SttResponse {
  text: string;
  words?: SttWord[];
  /** Some models return a top-level duration field. */
  duration?: number;
}

// ── Constants ───────────────────────────────────────────────

const STT_PATH = "/speech-to-text";
const STT_MODEL = "eleven_flash_v2_5";

// ── Cost calculation ────────────────────────────────────────

/**
 * Calculate STT cost in cents: ceil(durationSeconds / 60) * 0.67
 */
export function calculateSttCost(durationSeconds: number): number {
  const minutes = Math.ceil(durationSeconds / 60);
  return minutes * 0.67;
}

// ── Duration extraction ─────────────────────────────────────

function extractDuration(data: SttResponse): number {
  // Prefer word-level timestamps: last word end time
  if (data.words && data.words.length > 0) {
    const lastWord = data.words[data.words.length - 1];
    return lastWord.end;
  }
  // Fall back to top-level duration if present
  if (typeof data.duration === "number" && data.duration > 0) {
    return data.duration;
  }
  // Final fallback: rough estimate from text length (4 words/sec average)
  const wordCount = data.text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 4));
}

// ── URL-based transcription ─────────────────────────────────

async function transcribeViaUrl(audioUrl: string): Promise<SttResult> {
  const response = await elevenLabsFetch(STT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      model_id: STT_MODEL,
    }),
  });

  const data = (await response.json()) as SttResponse;
  const durationSeconds = extractDuration(data);

  return {
    text: data.text,
    durationSeconds,
    costCents: calculateSttCost(durationSeconds),
  };
}

// ── Upload-based transcription (fallback) ───────────────────

async function transcribeViaUpload(audioUrl: string): Promise<SttResult> {
  // Download the audio as a stream
  const downloadResponse = await fetch(audioUrl);
  if (!downloadResponse.ok) {
    throw new ElevenLabsError(
      `Failed to download audio from ${audioUrl}: ${downloadResponse.status} ${downloadResponse.statusText}`,
      downloadResponse.status
    );
  }

  const audioBlob = await downloadResponse.blob();

  const formData = new FormData();
  formData.append("audio", audioBlob, "audio.mp3");
  formData.append("model_id", STT_MODEL);

  // Do NOT set Content-Type header; the browser / Node runtime will set
  // the correct multipart boundary automatically.
  const response = await elevenLabsFetch(STT_PATH, {
    method: "POST",
    body: formData,
  });

  const data = (await response.json()) as SttResponse;
  const durationSeconds = extractDuration(data);

  return {
    text: data.text,
    durationSeconds,
    costCents: calculateSttCost(durationSeconds),
  };
}

// ── Public API ──────────────────────────────────────────────

/**
 * Transcribe audio from a URL using ElevenLabs Speech-to-Text.
 *
 * Strategy:
 * 1. Try URL-based transcription (avoids downloading the audio ourselves).
 * 2. If that fails, fall back to downloading + multipart upload.
 *
 * @throws {ElevenLabsError} on API failures after both strategies are exhausted.
 */
export async function transcribeAudio(audioUrl: string): Promise<SttResult> {
  if (!audioUrl) {
    throw new ElevenLabsError("audioUrl is required for transcription", 400);
  }

  try {
    return await transcribeViaUrl(audioUrl);
  } catch (urlError) {
    // If the URL-based approach fails, try the upload approach.
    // But if the error is auth-related (401/403) or missing key (503),
    // don't bother retrying with upload — it will fail the same way.
    if (urlError instanceof ElevenLabsError) {
      if (
        urlError.status === 401 ||
        urlError.status === 403 ||
        urlError.status === 503
      ) {
        throw urlError;
      }
    }

    try {
      return await transcribeViaUpload(audioUrl);
    } catch (uploadError) {
      // If both fail, throw the upload error (more informative for debugging)
      if (uploadError instanceof ElevenLabsError) {
        throw uploadError;
      }
      throw new ElevenLabsError(
        `Transcription failed for ${audioUrl}: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`,
        500
      );
    }
  }
}
