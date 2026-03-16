/**
 * Summary Pipeline
 *
 * Generates summary podcasts from feed episode transcripts.
 * Steps:
 *   1. GATHER     — query feed_episodes for included feeds since last generation
 *   2. INACTIVITY — auto-exclude feeds with no new episodes
 *   3. CREATE     — insert episode row with source_type='feed_summary'
 *   4. SUMMARIZE  — Claude synthesizes podcast transcripts
 *   5. SCRIPT     — generate podcast script from summary
 *   6. AUDIO      — convert script to audio via ElevenLabs
 *   7. UPLOAD     — store audio in Supabase Storage
 *   8. LOG        — write to summary_generation_log
 *   9. UPDATE     — update summary_config with last_generated_at, next_due_at
 *
 * Follows the same error-handling pattern as orchestrator.ts:
 * catches all errors, sets episode status to 'failed', logs to generation log.
 *
 * A single admin Supabase client is created in runSummaryPipeline() and
 * injected into all helper functions to avoid redundant client construction.
 */

import type {
  EpisodeStyle,
  EpisodeTone,
  EpisodeStatus,
  VoiceConfig,
} from "@/types/episode";
import type { Cadence, SummaryConfig, FeedEpisode } from "@/types/feed";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeJson, MODEL_SONNET } from "@/lib/ai/chat";
import {
  podcastSummarySystemPrompt,
  podcastSummaryUserPrompt,
  parsePodcastSummaryResponse,
  type PodcastTranscript,
} from "@/lib/ai/prompts/podcast-summary";
import { scriptStep } from "./script-step";
import { audioStep } from "./audio-step";
import { storageStep } from "./storage-step";

// ── Constants ────────────────────────────────────────────────

/** Max total characters to send to Claude (~100K tokens at ~4 chars/token). */
const MAX_TRANSCRIPT_CHARS = 400_000;

// ── Types ────────────────────────────────────────────────────

export interface SummaryPipelineParams {
  summaryConfigId: string;
  userId: string;
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes: number;
  voiceConfig: VoiceConfig;
}

/** A feed episode with its parent feed title, used internally by the pipeline. */
interface GatheredEpisode {
  episodeId: string;
  feedId: string;
  podcastTitle: string;
  episodeTitle: string;
  transcript: string;
  publishedAt: string | null;
}

/** Tracking metrics accumulated during pipeline execution. */
interface PipelineMetrics {
  feedsIncluded: number;
  feedsExcluded: number;
  episodesSummarized: number;
  claudeTokensUsed: number;
  elevenlabsCharactersUsed: number;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Update the episode row in the database.
 * Accepts the shared admin client to avoid redundant construction.
 */
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
      `[summary-pipeline] Failed to update episode ${episodeId}:`,
      error,
    );
  }
}

/**
 * Set the episode status and optionally include extra fields.
 */
async function setStatus(
  supabase: SupabaseClient,
  episodeId: string,
  status: EpisodeStatus,
  extra?: Record<string, unknown>,
): Promise<void> {
  await updateEpisode(supabase, episodeId, { status, ...extra });
}

/**
 * Mark the episode as failed with an error message.
 */
async function failEpisode(
  supabase: SupabaseClient,
  episodeId: string,
  error: unknown,
): Promise<void> {
  const message =
    error instanceof Error ? error.message : String(error);
  await setStatus(supabase, episodeId, "failed", {
    error_message: message.slice(0, 1000),
  });
}

/**
 * Compute the next_due_at timestamp based on cadence.
 */
export function computeNextDueAt(cadence: Cadence, fromDate: Date): string {
  const next = new Date(fromDate);

  switch (cadence) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "twice_weekly":
      // Advance 3 or 4 days to hit ~2x per week
      next.setDate(next.getDate() + 3);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "on_new_episodes":
      // No fixed schedule — set far future; scheduler checks for new episodes
      next.setDate(next.getDate() + 1);
      break;
  }

  return next.toISOString();
}

/**
 * Window transcripts to fit within MAX_TRANSCRIPT_CHARS.
 * Prioritizes the most recent episodes. Trims oldest first.
 */
export function windowTranscripts(
  episodes: GatheredEpisode[],
): GatheredEpisode[] {
  // Sort by publishedAt descending (most recent first)
  const sorted = [...episodes].sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });

  const result: GatheredEpisode[] = [];
  let totalChars = 0;

  for (const ep of sorted) {
    const epChars = ep.transcript.length;
    if (totalChars + epChars > MAX_TRANSCRIPT_CHARS) {
      // If we have nothing yet, include at least one (truncated)
      if (result.length === 0) {
        result.push({
          ...ep,
          transcript: ep.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
        });
      }
      break;
    }
    result.push(ep);
    totalChars += epChars;
  }

  return result;
}

// ── Step 1: GATHER ───────────────────────────────────────────

async function gatherEpisodes(
  supabase: SupabaseClient,
  summaryConfigId: string,
  lastGeneratedAt: string | null,
): Promise<{
  episodes: GatheredEpisode[];
  feedIds: string[];
  excludedFeedIds: string[];
}> {
  // Get included feeds for this config
  const { data: configFeeds, error: cfError } = await supabase
    .from("summary_config_feeds")
    .select("feed_id, is_included, auto_excluded")
    .eq("summary_config_id", summaryConfigId);

  if (cfError) {
    throw new Error(`Failed to query summary_config_feeds: ${cfError.message}`);
  }

  if (!configFeeds || configFeeds.length === 0) {
    throw new Error("No feeds configured for this summary config");
  }

  const includedFeedIds = configFeeds
    .filter((cf) => cf.is_included && !cf.auto_excluded)
    .map((cf) => cf.feed_id);

  if (includedFeedIds.length === 0) {
    throw new Error("All feeds are excluded from this summary config");
  }

  // Get feed titles
  const { data: feeds, error: feedsError } = await supabase
    .from("podcast_feeds")
    .select("id, title")
    .in("id", includedFeedIds);

  if (feedsError) {
    throw new Error(`Failed to query podcast_feeds: ${feedsError.message}`);
  }

  const feedTitleMap = new Map(
    (feeds ?? []).map((f) => [f.id, f.title ?? "Unknown Podcast"]),
  );

  // Query feed_episodes with transcription_status = 'completed' since last generation
  let query = supabase
    .from("feed_episodes")
    .select("id, feed_id, title, transcript, published_at")
    .in("feed_id", includedFeedIds)
    .eq("transcription_status", "completed")
    .not("transcript", "is", null)
    .order("published_at", { ascending: false });

  if (lastGeneratedAt) {
    query = query.gt("published_at", lastGeneratedAt);
  }

  const { data: episodes, error: epError } = await query;

  if (epError) {
    throw new Error(`Failed to query feed_episodes: ${epError.message}`);
  }

  if (!episodes || episodes.length === 0) {
    return { episodes: [], feedIds: includedFeedIds, excludedFeedIds: [] };
  }

  // Identify feeds with no new episodes (for inactivity check)
  const feedsWithEpisodes = new Set(episodes.map((ep) => ep.feed_id));
  const inactiveFeedIds = includedFeedIds.filter(
    (fid) => !feedsWithEpisodes.has(fid),
  );

  const gathered: GatheredEpisode[] = episodes
    .filter((ep) => ep.transcript !== null)
    .map((ep) => ({
      episodeId: ep.id,
      feedId: ep.feed_id,
      podcastTitle: feedTitleMap.get(ep.feed_id) ?? "Unknown Podcast",
      episodeTitle: ep.title,
      transcript: ep.transcript as string,
      publishedAt: ep.published_at,
    }));

  return {
    episodes: gathered,
    feedIds: includedFeedIds,
    excludedFeedIds: inactiveFeedIds,
  };
}

// ── Step 2: INACTIVITY CHECK ─────────────────────────────────

async function autoExcludeInactiveFeeds(
  supabase: SupabaseClient,
  summaryConfigId: string,
  inactiveFeedIds: string[],
): Promise<void> {
  if (inactiveFeedIds.length === 0) return;

  for (const feedId of inactiveFeedIds) {
    const { error } = await supabase
      .from("summary_config_feeds")
      .update({
        auto_excluded: true,
        auto_exclude_reason:
          "No new episodes since last summary generation",
      })
      .eq("summary_config_id", summaryConfigId)
      .eq("feed_id", feedId);

    if (error) {
      console.error(
        `[summary-pipeline] Failed to auto-exclude feed ${feedId}:`,
        error,
      );
    }
  }
}

// ── Step 4: SUMMARIZE ────────────────────────────────────────

async function summarizeTranscripts(
  episodes: GatheredEpisode[],
  targetLengthMinutes: number,
): Promise<{ summary: NewsSummaryOutput; tokensUsed: number }> {
  const transcripts: PodcastTranscript[] = episodes.map((ep) => ({
    podcastTitle: ep.podcastTitle,
    episodeTitle: ep.episodeTitle,
    transcript: ep.transcript,
    publishedAt: ep.publishedAt,
  }));

  const { data, usage } = await completeJson(
    {
      system: podcastSummarySystemPrompt(),
      userPrompt: podcastSummaryUserPrompt({
        transcripts,
        targetLengthMinutes,
      }),
      model: MODEL_SONNET,
      maxTokens: 4096,
      temperature: 0,
    },
    parsePodcastSummaryResponse,
  );

  const tokensUsed = usage.inputTokens + usage.outputTokens;
  return { summary: data, tokensUsed };
}

// ── Step 8: LOG ──────────────────────────────────────────────

async function writeGenerationLog(
  supabase: SupabaseClient,
  summaryConfigId: string,
  userId: string,
  episodeId: string | null,
  status: "completed" | "failed",
  metrics: PipelineMetrics,
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabase.from("summary_generation_log").insert({
    summary_config_id: summaryConfigId,
    user_id: userId,
    episode_id: episodeId,
    status,
    error_message: errorMessage?.slice(0, 1000) ?? null,
    feeds_included: metrics.feedsIncluded,
    feeds_excluded: metrics.feedsExcluded,
    episodes_summarized: metrics.episodesSummarized,
    claude_tokens_used: metrics.claudeTokensUsed,
    elevenlabs_characters_used: metrics.elevenlabsCharactersUsed,
    started_at: new Date().toISOString(),
    completed_at: status === "completed" ? new Date().toISOString() : null,
  });

  if (error) {
    console.error(
      `[summary-pipeline] Failed to write generation log:`,
      error,
    );
  }
}

// ── Step 9: UPDATE CONFIG ────────────────────────────────────

async function updateSummaryConfig(
  supabase: SupabaseClient,
  summaryConfigId: string,
  cadence: Cadence,
): Promise<void> {
  const now = new Date();

  const { error } = await supabase
    .from("summary_configs")
    .update({
      last_generated_at: now.toISOString(),
      next_due_at: computeNextDueAt(cadence, now),
    })
    .eq("id", summaryConfigId);

  if (error) {
    console.error(
      `[summary-pipeline] Failed to update summary config:`,
      error,
    );
  }
}

// ── Main Pipeline ────────────────────────────────────────────

/**
 * Run the full summary podcast generation pipeline.
 *
 * This function is designed to be called fire-and-forget from an API route.
 * It creates an episode record and updates it at each step so clients
 * can poll for status.
 *
 * On any error, the episode status is set to 'failed' with the error message,
 * and the function returns without throwing.
 *
 * Creates a single admin Supabase client and passes it to all step functions,
 * avoiding redundant client construction.
 */
export async function runSummaryPipeline(
  params: SummaryPipelineParams,
): Promise<void> {
  const {
    summaryConfigId,
    userId,
    style,
    tone,
    lengthMinutes,
    voiceConfig,
  } = params;

  // Create a single admin client for the entire pipeline run
  const supabase = createAdminClient();
  let episodeId: string | null = null;
  let totalTokens = 0;

  const metrics: PipelineMetrics = {
    feedsIncluded: 0,
    feedsExcluded: 0,
    episodesSummarized: 0,
    claudeTokensUsed: 0,
    elevenlabsCharactersUsed: 0,
  };

  try {
    // Load config to get cadence and last_generated_at
    const { data: config, error: configError } = await supabase
      .from("summary_configs")
      .select("*")
      .eq("id", summaryConfigId)
      .single();

    if (configError || !config) {
      throw new Error(
        `Failed to load summary config: ${configError?.message ?? "not found"}`,
      );
    }

    const typedConfig = config as unknown as SummaryConfig;

    // ---- Step 1: GATHER ----
    const { episodes: gathered, feedIds, excludedFeedIds } =
      await gatherEpisodes(supabase, summaryConfigId, typedConfig.last_generated_at);

    metrics.feedsIncluded = feedIds.length - excludedFeedIds.length;
    metrics.feedsExcluded = excludedFeedIds.length;

    // ---- Step 2: INACTIVITY CHECK ----
    await autoExcludeInactiveFeeds(supabase, summaryConfigId, excludedFeedIds);

    // After inactivity check, verify we still have transcripts
    if (gathered.length === 0) {
      throw new Error("No new transcripts available");
    }

    // Window transcripts to fit within token budget
    const windowed = windowTranscripts(gathered);
    metrics.episodesSummarized = windowed.length;

    // ---- Step 3: CREATE EPISODE ----
    // Create the episode row early so we can track status
    const configName = typedConfig.name ?? "Summary";
    const { data: newEpisode, error: insertError } = await supabase
      .from("episodes")
      .insert({
        user_id: userId,
        source_type: "feed_summary",
        summary_config_id: summaryConfigId,
        status: "pending" as const,
        topic_query: `${configName} summary`,
        style,
        tone,
        length_minutes: lengthMinutes,
        voice_config: JSON.parse(JSON.stringify(voiceConfig)),
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
      })
      .select("id")
      .single();

    if (insertError || !newEpisode) {
      throw new Error(
        `Failed to create episode: ${insertError?.message ?? "unknown error"}`,
      );
    }

    episodeId = newEpisode.id;

    // ---- Step 4: SUMMARIZE ----
    await setStatus(supabase, episodeId, "summarizing");
    const { summary, tokensUsed: summaryTokens } =
      await summarizeTranscripts(windowed, lengthMinutes);
    totalTokens += summaryTokens;
    await updateEpisode(supabase, episodeId, {
      summary: summary.topicOverview,
      claude_tokens_used: totalTokens,
    });

    // ---- Step 5: SCRIPT ----
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

    // ---- Step 6: AUDIO ----
    await setStatus(supabase, episodeId, "generating_audio");
    const { audio, charactersUsed } = await audioStep({
      script,
      style,
    });
    await updateEpisode(supabase, episodeId, {
      elevenlabs_characters_used: charactersUsed,
    });

    // ---- Step 7: UPLOAD ----
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

    // ---- Step 8: LOG ----
    metrics.claudeTokensUsed = totalTokens;
    metrics.elevenlabsCharactersUsed = charactersUsed;
    await writeGenerationLog(
      supabase,
      summaryConfigId,
      userId,
      episodeId,
      "completed",
      metrics,
    );

    // ---- Step 9: UPDATE CONFIG ----
    await updateSummaryConfig(
      supabase,
      summaryConfigId,
      typedConfig.cadence as Cadence,
    );
  } catch (error) {
    console.error(
      `[summary-pipeline] Config ${summaryConfigId} failed:`,
      error,
    );

    if (episodeId) {
      await failEpisode(supabase, episodeId, error);
    }

    const errorMessage =
      error instanceof Error ? error.message : String(error);

    metrics.claudeTokensUsed = totalTokens;
    await writeGenerationLog(
      supabase,
      summaryConfigId,
      userId,
      episodeId,
      "failed",
      metrics,
      errorMessage,
    );
  }
}
