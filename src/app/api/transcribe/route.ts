/**
 * Trigger transcription for a feed episode.
 *
 * POST /api/transcribe
 * Body: { feedEpisodeId: string }
 *
 * Validates ownership, budget, and episode state before processing.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { triggerTranscriptionSchema } from "@/lib/validation/feed-schemas";
import {
  processTranscription,
  checkSttBudget,
} from "@/lib/transcription/orchestrator";

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
    .select("id, feed_id, user_id, audio_url, transcription_status, duration_seconds")
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

  // Check transcription status -- only allow 'none' or 'failed'
  if (
    episode.transcription_status !== "none" &&
    episode.transcription_status !== "failed"
  ) {
    return NextResponse.json(
      {
        error: `Transcription is already ${episode.transcription_status}. Only episodes with status 'none' or 'failed' can be transcribed.`,
      },
      { status: 409 }
    );
  }

  // Check STT budget
  const budget = await checkSttBudget(user.id);
  if (!budget.allowed) {
    return NextResponse.json(
      {
        error: "Daily STT budget exceeded",
        budget: {
          usedMinutes: budget.usedMinutes,
          limitMinutes: budget.limitMinutes,
          remainingMinutes: budget.remainingMinutes,
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
    });

    if (!result.success) {
      console.error("[transcribe] Transcription failed:", result.error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[transcribe] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    started: true,
    feedEpisodeId: episode.id,
  });
}
