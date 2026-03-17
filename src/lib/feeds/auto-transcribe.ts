/**
 * Auto-transcribe new feed episodes.
 *
 * Called after feed polling discovers new episodes for feeds with
 * auto_transcribe enabled. Uses atomic claim to prevent duplicate
 * transcription from concurrent poll requests.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { checkFeatureAccess } from "@/lib/auth/feature-gate";
import {
  checkSttBudget,
  processTranscription,
} from "@/lib/transcription/orchestrator";

/** Max episodes to auto-transcribe per poll cycle to limit cost/time. */
const MAX_EPISODES_PER_POLL = 5;

/**
 * Auto-transcribe new episodes for a feed.
 *
 * Checks that the feed has auto_transcribe enabled, the user has premium
 * access, and the STT budget allows it. Then atomically claims episodes
 * and processes them sequentially.
 */
export async function autoTranscribeNewEpisodes(
  feedId: string,
  userId: string,
  newEpisodeIds: string[],
): Promise<void> {
  if (newEpisodeIds.length === 0) return;

  const supabase = createAdminClient();

  // Verify feed has auto_transcribe enabled
  const { data: feed, error: feedError } = await supabase
    .from("podcast_feeds")
    .select("auto_transcribe")
    .eq("id", feedId)
    .single();

  if (feedError || !feed?.auto_transcribe) return;

  // Check user has premium access
  const { allowed } = await checkFeatureAccess(userId, "auto_transcribe");
  if (!allowed) return;

  // Batch fail-fast: check STT budget before processing any episodes
  // (processTranscription also checks per-episode, this is an optimization)
  const budget = await checkSttBudget(userId);
  if (!budget.allowed) {
    console.log(
      `[auto-transcribe] User ${userId} STT budget exhausted, skipping`,
    );
    return;
  }

  // Fetch episodes that need transcription
  const { data: episodes, error: epError } = await supabase
    .from("feed_episodes")
    .select("id, audio_url, duration_seconds")
    .in("id", newEpisodeIds)
    .eq("transcription_status", "none")
    .not("audio_url", "is", null)
    .limit(MAX_EPISODES_PER_POLL);

  if (epError || !episodes || episodes.length === 0) return;

  for (const ep of episodes) {
    try {
      // Atomic claim: only proceed if we successfully set status to pending
      const { data: claimed, error: claimError } = await supabase
        .from("feed_episodes")
        .update({ transcription_status: "pending" })
        .eq("id", ep.id)
        .eq("transcription_status", "none")
        .select("id")
        .single();

      if (claimError || !claimed) {
        // Another process already claimed this episode
        continue;
      }

      const audioUrl = ep.audio_url;
      if (!audioUrl) continue;

      const result = await processTranscription({
        feedEpisodeId: ep.id,
        userId,
        audioUrl,
        durationSeconds: ep.duration_seconds,
      });

      if (!result.success) {
        await supabase
          .from("feed_episodes")
          .update({
            transcription_status: "failed",
            transcription_error: result.error ?? "Transcription failed",
          })
          .eq("id", ep.id);
      }
    } catch (err) {
      console.error(`[auto-transcribe] Episode ${ep.id} failed:`, err);
      // Mark as failed so it can be retried manually
      await supabase
        .from("feed_episodes")
        .update({
          transcription_status: "failed",
          transcription_error:
            err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", ep.id);
    }
  }
}
