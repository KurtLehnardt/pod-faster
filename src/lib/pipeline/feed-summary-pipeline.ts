/**
 * Feed Summary Pipeline (ad-hoc)
 *
 * Generates a podcast episode from feed transcripts without requiring a
 * summary_config. Used when a user selects "From Feeds" in the episode
 * creation UI and picks specific feeds.
 *
 * Steps:
 *   1. GATHER     — query feed_episodes for the selected feeds
 *   2. WINDOW     — trim transcripts to fit token budget
 *   3. SUMMARIZE  — Claude synthesizes podcast transcripts
 *   4. SCRIPT     — generate podcast script from summary
 *   5. AUDIO      — convert script to audio via ElevenLabs
 *   6. UPLOAD     — store audio in Supabase Storage
 */

import type {
  EpisodeStyle,
  EpisodeTone,
  EpisodeStatus,
  VoiceConfig,
} from "@/types/episode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type GatheredEpisode,
  windowTranscripts,
  summarizeTranscripts,
} from "./summary-pipeline";
import { scriptStep } from "./script-step";
import { audioStep } from "./audio-step";
import { storageStep } from "./storage-step";

// ── Types ────────────────────────────────────────────────────

export interface FeedSummaryPipelineParams {
  episodeId: string;
  userId: string;
  feedIds: string[];
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes: number;
  voiceConfig: VoiceConfig;
}

// ── Helpers ──────────────────────────────────────────────────

async function updateEpisode(
  supabase: SupabaseClient,
  episodeId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("episodes")
    .update(data)
    .eq("id", episodeId);

  if (error) {
    console.error(
      `[feed-summary-pipeline] Failed to update episode ${episodeId}:`,
      error,
    );
  }
}

async function setStatus(
  supabase: SupabaseClient,
  episodeId: string,
  status: EpisodeStatus,
  extra?: Record<string, unknown>,
): Promise<void> {
  await updateEpisode(supabase, episodeId, { status, ...extra });
}

async function failEpisode(
  supabase: SupabaseClient,
  episodeId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await setStatus(supabase, episodeId, "failed", {
    error_message: message.slice(0, 1000),
  });
}

// ── Main Pipeline ────────────────────────────────────────────

export async function runFeedSummaryPipeline(
  params: FeedSummaryPipelineParams,
): Promise<void> {
  const { episodeId, userId, feedIds, style, tone, lengthMinutes, voiceConfig } =
    params;

  // Create a single admin client for the entire pipeline run
  const supabase = createAdminClient();
  let totalTokens = 0;

  try {
    // ---- Step 1: GATHER ----
    // Verify feeds belong to this user (defense-in-depth; API layer also validates)
    const { data: feeds, error: feedsError } = await supabase
      .from("podcast_feeds")
      .select("id, title")
      .in("id", feedIds)
      .eq("user_id", userId);

    if (feedsError) {
      throw new Error(`Failed to query podcast_feeds: ${feedsError.message}`);
    }

    if (!feeds || feeds.length !== feedIds.length) {
      throw new Error(
        `Feed ownership mismatch: requested ${feedIds.length} feeds but user owns ${feeds?.length ?? 0} of them`,
      );
    }

    const feedTitleMap = new Map(
      feeds.map((f) => [f.id, f.title ?? "Unknown Podcast"]),
    );

    // Query feed_episodes with completed transcripts for the selected feeds
    const { data: episodes, error: epError } = await supabase
      .from("feed_episodes")
      .select("id, feed_id, title, transcript, published_at")
      .in("feed_id", feedIds)
      .eq("transcription_status", "completed")
      .not("transcript", "is", null)
      .order("published_at", { ascending: false })
      .limit(100);

    if (epError) {
      throw new Error(`Failed to query feed_episodes: ${epError.message}`);
    }

    if (!episodes || episodes.length === 0) {
      throw new Error(
        "No transcripts available for the selected feeds. Ensure feed episodes have been transcribed.",
      );
    }

    const gathered: GatheredEpisode[] = episodes.map((ep) => ({
      episodeId: ep.id,
      feedId: ep.feed_id,
      podcastTitle: feedTitleMap.get(ep.feed_id) ?? "Unknown Podcast",
      episodeTitle: ep.title,
      transcript: ep.transcript as string,
      publishedAt: ep.published_at,
    }));

    // ---- Step 2: WINDOW ----
    const windowed = windowTranscripts(gathered);

    // Update sources on episode with what we're actually using
    await updateEpisode(supabase, episodeId, {
      sources: JSON.parse(
        JSON.stringify(
          windowed.map((ep) => ({
            title: ep.episodeTitle,
            url: ep.podcastTitle,
            episodeId: ep.episodeId,
            feedId: ep.feedId,
          })),
        ),
      ),
    });

    // ---- Step 3: SUMMARIZE ----
    await setStatus(supabase, episodeId, "summarizing");
    const { summary, tokensUsed: summaryTokens } = await summarizeTranscripts(
      windowed,
      lengthMinutes,
    );
    totalTokens += summaryTokens;
    await updateEpisode(supabase, episodeId, {
      summary: summary.topicOverview,
      claude_tokens_used: totalTokens,
    });

    // ---- Step 4: SCRIPT ----
    await setStatus(supabase, episodeId, "scripting");
    const { script, tokensUsed: scriptTokens } = await scriptStep({
      summary,
      style,
      tone,
      lengthMinutes,
      voiceConfig,
    });
    totalTokens += scriptTokens;
    await updateEpisode(supabase, episodeId, {
      title: script.title,
      script: JSON.parse(JSON.stringify(script)),
      claude_tokens_used: totalTokens,
    });

    // ---- Step 5: AUDIO ----
    await setStatus(supabase, episodeId, "generating_audio");
    const { audio, charactersUsed } = await audioStep({
      script,
      style,
    });
    await updateEpisode(supabase, episodeId, {
      elevenlabs_characters_used: charactersUsed,
    });

    // ---- Step 6: UPLOAD ----
    await setStatus(supabase, episodeId, "uploading");
    const audioPath = await storageStep({
      audio,
      userId,
      episodeId,
    });

    // ---- DONE ----
    await setStatus(supabase, episodeId, "completed", {
      audio_path: audioPath,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[feed-summary-pipeline] Episode ${episodeId} failed:`, error);
    await failEpisode(supabase, episodeId, error);
  }
}
