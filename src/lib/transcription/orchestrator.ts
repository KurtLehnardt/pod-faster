/**
 * Transcription job orchestrator.
 *
 * Tier-aware transcription with monthly cost caps.
 * Free tier gets a 5-min preview clip; Pro/Premium get full episodes.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio, transcribeAudioBlob, calculateSttCost } from "./elevenlabs-stt";
import { checkTierBudget } from "./tier-budget";
import { sliceAudio } from "./audio-slicer";
import type { SubscriptionTier } from "@/types/database.types";
import type { TranscriptSource, TranscriptionStatus } from "@/types/feed";

// ── Public types ────────────────────────────────────────────

export interface TranscriptionJob {
  feedEpisodeId: string;
  userId: string;
  audioUrl: string;
  /** Estimated duration (seconds) for pre-flight budget checks. */
  durationSeconds: number | null;
  /** User's subscription tier. */
  tier: SubscriptionTier;
}

export interface TranscriptionResult {
  success: boolean;
  transcript: string | null;
  costCents: number;
  error: string | null;
  /** True when only a clip was transcribed (free tier). */
  isPartial: boolean;
  /** Start-end seconds of the clip, e.g. "300-600". Null for full transcriptions. */
  clipRange: string | null;
}

// ── DB helpers ──────────────────────────────────────────────

async function updateEpisodeStatus(
  episodeId: string,
  status: TranscriptionStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("feed_episodes")
    .update({ transcription_status: status, ...extra })
    .eq("id", episodeId);

  if (error) {
    throw new Error(
      `Failed to update episode ${episodeId} status to ${status}: ${error.message}`
    );
  }
}

// ── Process transcription ───────────────────────────────────

/**
 * Process a single transcription job with tier-aware routing.
 *
 * - Free tier → sliceAudio() → transcribeAudioBlob() → partial transcript
 * - Pro/Premium → transcribeAudio() (existing URL/upload strategy) → full transcript
 *
 * Pre-flight: estimate cost, check tier budget, reject if over cap.
 */
export async function processTranscription(
  job: TranscriptionJob
): Promise<TranscriptionResult> {
  const isFree = job.tier === "free";

  // Estimate cost for pre-flight check
  const estimatedCostCents = job.durationSeconds
    ? calculateSttCost(isFree ? Math.min(job.durationSeconds, 300) : job.durationSeconds)
    : undefined;

  // Tier budget gate
  const budget = await checkTierBudget(job.userId, job.tier, estimatedCostCents);
  if (!budget.allowed) {
    return {
      success: false,
      transcript: null,
      costCents: 0,
      error: budget.reason ?? "Transcription budget exceeded",
      isPartial: false,
      clipRange: null,
    };
  }

  // Mark as processing
  await updateEpisodeStatus(job.feedEpisodeId, "processing");

  try {
    if (isFree) {
      return await processFreeTier(job);
    } else {
      return await processFullTier(job);
    }
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // Failure: record the error
    await updateEpisodeStatus(job.feedEpisodeId, "failed", {
      transcription_error: errorMessage,
    });

    return {
      success: false,
      transcript: null,
      costCents: 0,
      error: errorMessage,
      isPartial: false,
      clipRange: null,
    };
  }
}

// ── Free tier: 5-min preview ────────────────────────────────

async function processFreeTier(
  job: TranscriptionJob
): Promise<TranscriptionResult> {
  // Slice audio to 5-min clip
  const sliced = await sliceAudio(job.audioUrl, job.durationSeconds);
  const clipRange = `${sliced.startSeconds}-${sliced.endSeconds}`;

  // Transcribe the sliced blob
  const result = await transcribeAudioBlob(sliced.audioBlob);

  // Persist with partial flags
  await updateEpisodeStatus(job.feedEpisodeId, "completed", {
    transcript: result.text,
    transcript_source: "elevenlabs_stt" satisfies TranscriptSource,
    duration_seconds: result.durationSeconds,
    elevenlabs_cost_cents: Math.round(result.costCents),
    transcription_error: null,
    is_partial_transcript: true,
    transcript_clip_range: clipRange,
  });

  return {
    success: true,
    transcript: result.text,
    costCents: result.costCents,
    error: null,
    isPartial: true,
    clipRange,
  };
}

// ── Pro/Premium: full episode ───────────────────────────────

async function processFullTier(
  job: TranscriptionJob
): Promise<TranscriptionResult> {
  const result = await transcribeAudio(job.audioUrl);

  // Persist full transcript
  await updateEpisodeStatus(job.feedEpisodeId, "completed", {
    transcript: result.text,
    transcript_source: "elevenlabs_stt" satisfies TranscriptSource,
    duration_seconds: result.durationSeconds,
    elevenlabs_cost_cents: Math.round(result.costCents),
    transcription_error: null,
    is_partial_transcript: false,
    transcript_clip_range: null,
  });

  return {
    success: true,
    transcript: result.text,
    costCents: result.costCents,
    error: null,
    isPartial: false,
    clipRange: null,
  };
}
