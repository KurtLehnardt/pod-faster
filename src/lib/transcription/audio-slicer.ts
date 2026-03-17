/**
 * Audio slicer for free-tier preview clips.
 *
 * Uses HTTP Range headers with bitrate estimation to download only the
 * target time window (default: minutes 5-10). Falls back to full download
 * + in-memory byte slice if the CDN doesn't support Range requests.
 *
 * MP3 decoders (including ElevenLabs STT) tolerate non-frame-aligned boundaries.
 */

import {
  FREE_TIER_CLIP_SECONDS,
  FREE_TIER_CLIP_START_SECONDS,
} from "./tier-budget";

// ── Public types ────────────────────────────────────────────

export interface SlicedAudio {
  /** The audio blob for the clipped segment. */
  audioBlob: Blob;
  /** Actual start of the clip in seconds. */
  startSeconds: number;
  /** Actual end of the clip in seconds. */
  endSeconds: number;
}

// ── Constants ───────────────────────────────────────────────

/** Default bitrate assumption when Content-Length is unavailable (128 kbps). */
const DEFAULT_BITRATE_BPS = 128_000;

// ── Public API ──────────────────────────────────────────────

/**
 * Slice a remote audio file to a 5-minute clip.
 *
 * - If episode < 10 min: clip from the start.
 * - If episode < 5 min: return the whole file (no slicing).
 * - Otherwise: clip minutes 5-10.
 *
 * @param audioUrl  Public URL of the episode audio.
 * @param durationSeconds  Known duration of the episode (may be null).
 * @returns The sliced audio blob with its time range.
 */
export async function sliceAudio(
  audioUrl: string,
  durationSeconds: number | null,
): Promise<SlicedAudio> {
  const duration = durationSeconds ?? Infinity;
  const clipLength = FREE_TIER_CLIP_SECONDS;

  // Determine clip window
  let startSeconds: number;
  let endSeconds: number;

  if (duration <= clipLength) {
    // Episode shorter than clip length — return the whole thing
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
    }
    const audioBlob = await response.blob();
    return { audioBlob, startSeconds: 0, endSeconds: duration };
  } else if (duration < FREE_TIER_CLIP_START_SECONDS + clipLength) {
    // Episode < 10 min — clip from the start
    startSeconds = 0;
    endSeconds = clipLength;
  } else {
    // Normal case: minutes 5-10
    startSeconds = FREE_TIER_CLIP_START_SECONDS;
    endSeconds = FREE_TIER_CLIP_START_SECONDS + clipLength;
  }

  // Probe file size and Range support
  const headResponse = await fetch(audioUrl, { method: "HEAD" });
  const contentLength = Number(headResponse.headers.get("content-length") || 0);
  const acceptRanges = headResponse.headers.get("accept-ranges");
  const supportsRange = acceptRanges === "bytes" && contentLength > 0;

  // Estimate bitrate
  const bitrateBps =
    contentLength > 0 && durationSeconds && durationSeconds > 0
      ? (contentLength * 8) / durationSeconds
      : DEFAULT_BITRATE_BPS;

  const bytesPerSecond = bitrateBps / 8;
  const startByte = Math.floor(startSeconds * bytesPerSecond);
  const endByte = Math.min(
    Math.ceil(endSeconds * bytesPerSecond),
    contentLength > 0 ? contentLength - 1 : Infinity,
  );

  if (supportsRange) {
    // Range request for just the clip
    const rangeResponse = await fetch(audioUrl, {
      headers: { Range: `bytes=${startByte}-${endByte}` },
    });

    if (rangeResponse.status === 206 || rangeResponse.ok) {
      const audioBlob = await rangeResponse.blob();
      return { audioBlob, startSeconds, endSeconds };
    }
    // If range request didn't work (e.g. CDN ignored it), fall through to full download
  }

  // Fallback: download full file, slice bytes in memory
  const fullResponse = await fetch(audioUrl);
  if (!fullResponse.ok) {
    throw new Error(`Failed to download audio: ${fullResponse.status} ${fullResponse.statusText}`);
  }

  const fullBuffer = await fullResponse.arrayBuffer();
  const sliceEnd = Math.min(endByte + 1, fullBuffer.byteLength);
  const slicedBuffer = fullBuffer.slice(
    Math.min(startByte, fullBuffer.byteLength),
    sliceEnd,
  );

  const audioBlob = new Blob([slicedBuffer], { type: "audio/mpeg" });
  return { audioBlob, startSeconds, endSeconds };
}
