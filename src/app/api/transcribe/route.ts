/**
 * Trigger transcription for a feed episode.
 *
 * POST /api/transcribe
 * Body: { feedEpisodeId: string }
 *
 * Validates ownership, tier budget, and episode state before processing.
 * Free users get a 5-min preview; Pro/Premium get full transcription.
 * Partial transcripts can be re-transcribed after upgrading.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { getUserTier } from "@/lib/auth/feature-gate";
import { triggerTranscriptionSchema } from "@/lib/validation/feed-schemas";
import { checkTierBudget } from "@/lib/transcription/tier-budget";
import { processTranscription } from "@/lib/transcription/orchestrator";

// Allow up to 300s for long audio files
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // TODO: Add per-user rate limiting (see rate-limit infrastructure task)
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = triggerTranscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { feedEpisodeId } = parsed.data;

  // Fetch episode and verify ownership through the feed relationship
  const { data: episode, error: episodeError } = await supabase
    .from("feed_episodes")
    .select("id, feed_id, user_id, audio_url, transcription_status, duration_seconds, is_partial_transcript")
    .eq("id", feedEpisodeId)
    .single();

  if (episodeError || !episode) {
    return NextResponse.json(
      { error: "Feed episode not found" },
      { status: 404 }
    );
  }

  // Ownership check: feed_episodes has user_id directly
  if (episode.user_id !== user.id) {
    return NextResponse.json(
      { error: "Feed episode not found" },
      { status: 404 }
    );
  }

  // Validate audio URL exists
  if (!episode.audio_url) {
    return NextResponse.json(
      { error: "Episode has no audio URL" },
      { status: 400 }
    );
  }

  // Check transcription status — allow 'none', 'failed', or re-transcription of partials
  const isPartialRetranscribe =
    episode.transcription_status === "completed" && episode.is_partial_transcript;

  if (
    episode.transcription_status !== "none" &&
    episode.transcription_status !== "failed" &&
    !isPartialRetranscribe
  ) {
    return NextResponse.json(
      {
        error: `Transcription is already ${episode.transcription_status}. Only episodes with status 'none', 'failed', or partial transcripts can be transcribed.`,
      },
      { status: 409 }
    );
  }

  // Fetch user's tier
  const tier = await getUserTier(user.id);

  // Check tier budget
  const budget = await checkTierBudget(user.id, tier);
  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: budget.reason ?? "Transcription budget exceeded",
        budget: {
          usedCentsThisMonth: budget.usedCentsThisMonth,
          remainingCents: budget.remainingCents,
          weeklyClipsUsed: budget.weeklyClipsUsed,
          tier,
        },
      },
      { status: 429 }
    );
  }

  // Process transcription
  try {
    const result = await processTranscription({
      feedEpisodeId: episode.id,
      userId: user.id,
      audioUrl: episode.audio_url,
      durationSeconds: episode.duration_seconds,
      tier,
    });

    if (!result.success) {
      console.error("[transcribe] Transcription failed:", result.error);
      return NextResponse.json(
        { error: "Transcription failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      started: true,
      feedEpisodeId: episode.id,
      isPartial: result.isPartial,
      clipRange: result.clipRange,
    });
  } catch (err) {
    console.error("[transcribe] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
