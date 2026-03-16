/**
 * Transcription job orchestrator.
 *
 * Manages STT budget enforcement and coordinates transcription jobs,
 * updating feed_episode records in Supabase as work progresses.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio } from "./elevenlabs-stt";
import type { TranscriptSource, TranscriptionStatus } from "@/types/feed";

// ── Public types ────────────────────────────────────────────

export interface TranscriptionJob {
  feedEpisodeId: string;
  userId: string;
  audioUrl: string;
  /** Estimated duration (seconds) for pre-flight budget checks. */
  durationSeconds: number | null;
}

export interface BudgetCheckResult {
  allowed: boolean;
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
}

export interface TranscriptionResult {
  success: boolean;
  transcript: string | null;
  costCents: number;
  error: string | null;
}

// ── Constants ───────────────────────────────────────────────

const DEFAULT_STT_DAILY_LIMIT_MINUTES = 120;

function getSttDailyLimitMinutes(): number {
  const envVal = process.env.STT_DAILY_LIMIT_MINUTES;
  if (!envVal) return DEFAULT_STT_DAILY_LIMIT_MINUTES;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_STT_DAILY_LIMIT_MINUTES;
}

// ── Budget check ────────────────────────────────────────────

/**
 * Check whether a user has remaining STT budget for the current 24-hour window.
 *
 * Queries the sum of `duration_seconds` on feed_episodes where
 * `transcript_source = 'elevenlabs_stt'` in the last 24 hours.
 */
export async function checkSttBudget(
  userId: string
): Promise<BudgetCheckResult> {
  const supabase = createAdminClient();
  const limitMinutes = getSttDailyLimitMinutes();

  // Supabase doesn't support raw SQL aggregates via the JS client easily,
  // so we use an RPC call pattern or a simple select + sum on the client.
  // We'll use a raw query via .rpc or a workaround with .select.
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("feed_episodes")
    .select("duration_seconds")
    .eq("user_id", userId)
    .eq("transcript_source", "elevenlabs_stt" satisfies TranscriptSource)
    .gte("created_at", twentyFourHoursAgo);

  if (error) {
    throw new Error(`Failed to check STT budget: ${error.message}`);
  }

  const usedSeconds = (data ?? []).reduce(
    (sum: number, row: { duration_seconds: number | null }) =>
      sum + (row.duration_seconds ?? 0),
    0
  );

  const usedMinutes = Math.ceil(usedSeconds / 60);
  const remainingMinutes = Math.max(0, limitMinutes - usedMinutes);

  return {
    allowed: remainingMinutes > 0,
    usedMinutes,
    limitMinutes,
    remainingMinutes,
  };
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
 * Process a single transcription job.
 *
 * 1. Check budget.
 * 2. Set status to 'processing'.
 * 3. Call ElevenLabs STT.
 * 4. Update the feed_episode with results (or error).
 */
export async function processTranscription(
  job: TranscriptionJob
): Promise<TranscriptionResult> {
  // Budget gate
  const budget = await checkSttBudget(job.userId);
  if (!budget.allowed) {
    return {
      success: false,
      transcript: null,
      costCents: 0,
      error: "Daily STT budget exceeded",
    };
  }

  // Mark as processing
  await updateEpisodeStatus(job.feedEpisodeId, "processing");

  try {
    const result = await transcribeAudio(job.audioUrl);

    // Success: persist transcript and metadata
    await updateEpisodeStatus(job.feedEpisodeId, "completed", {
      transcript: result.text,
      transcript_source: "elevenlabs_stt" satisfies TranscriptSource,
      duration_seconds: result.durationSeconds,
      elevenlabs_cost_cents: result.costCents,
      transcription_error: null,
    });

    return {
      success: true,
      transcript: result.text,
      costCents: result.costCents,
      error: null,
    };
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
    };
  }
}
