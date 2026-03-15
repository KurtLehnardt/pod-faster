/**
 * Pipeline Orchestrator
 *
 * Runs the full 5-step podcast generation pipeline:
 *   1. SEARCH    — gather news articles for the topic
 *   2. SUMMARIZE — Claude summarizes the articles
 *   3. SCRIPT    — Claude generates podcast script
 *   4. AUDIO     — ElevenLabs converts script to audio
 *   5. UPLOAD    — Store audio in Supabase Storage
 *
 * Updates episode status in DB after each step.
 * Tracks token/character usage.
 * Handles errors gracefully (sets status to 'failed' with error_message).
 */

import type {
  EpisodeStyle,
  EpisodeTone,
  EpisodeStatus,
  VoiceConfig,
} from "@/types/episode";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchStep } from "./search-step";
import { summarizeStep } from "./summarize-step";
import { scriptStep } from "./script-step";
import { audioStep } from "./audio-step";
import { storageStep } from "./storage-step";

export interface PipelineParams {
  episodeId: string;
  userId: string;
  topicQuery: string;
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes: number;
  voiceConfig: VoiceConfig;
}

/**
 * Update the episode row in the database.
 * Uses admin client to bypass RLS (pipeline runs server-side).
 */
async function updateEpisode(
  episodeId: string,
  data: Record<string, unknown>
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("episodes")
    .update(data)
    .eq("id", episodeId);

  if (error) {
    console.error(`[pipeline] Failed to update episode ${episodeId}:`, error);
  }
}

/**
 * Set the episode status and optionally include extra fields.
 */
async function setStatus(
  episodeId: string,
  status: EpisodeStatus,
  extra?: Record<string, unknown>
): Promise<void> {
  await updateEpisode(episodeId, { status, ...extra });
}

/**
 * Mark the episode as failed with an error message.
 */
async function failEpisode(episodeId: string, error: unknown): Promise<void> {
  const message =
    error instanceof Error ? error.message : String(error);
  await setStatus(episodeId, "failed", {
    error_message: message.slice(0, 1000),
  });
}

/**
 * Run the full podcast generation pipeline.
 *
 * This function is designed to be called fire-and-forget from an API route.
 * It updates the episode record in the database at each step so the client
 * can poll for status.
 *
 * On any error, the episode status is set to 'failed' with the error message,
 * and the function returns without throwing.
 */
export async function runPipeline(params: PipelineParams): Promise<void> {
  const {
    episodeId,
    userId,
    topicQuery,
    style,
    tone,
    lengthMinutes,
    voiceConfig,
  } = params;

  let totalTokens = 0;

  try {
    // ---- Step 1: SEARCH ----
    await setStatus(episodeId, "searching");
    const { sources } = await searchStep(topicQuery);
    await updateEpisode(episodeId, {
      sources: JSON.parse(JSON.stringify(sources)),
    });

    // ---- Step 2: SUMMARIZE ----
    await setStatus(episodeId, "summarizing");
    const { summary, tokensUsed: summaryTokens } =
      await summarizeStep(sources);
    totalTokens += summaryTokens;
    await updateEpisode(episodeId, {
      summary: summary.topicOverview,
      claude_tokens_used: totalTokens,
    });

    // ---- Step 3: SCRIPT ----
    await setStatus(episodeId, "scripting");
    const { script, tokensUsed: scriptTokens } = await scriptStep({
      summary,
      style,
      tone,
      lengthMinutes,
      voiceConfig,
    });
    totalTokens += scriptTokens;
    await updateEpisode(episodeId, {
      title: script.title,
      script: JSON.parse(JSON.stringify(script)),
      claude_tokens_used: totalTokens,
    });

    // ---- Step 4: AUDIO ----
    await setStatus(episodeId, "generating_audio");
    const { audio, charactersUsed } = await audioStep({
      script,
      style,
    });
    await updateEpisode(episodeId, {
      elevenlabs_characters_used: charactersUsed,
    });

    // ---- Step 5: UPLOAD ----
    await setStatus(episodeId, "uploading");
    const audioPath = await storageStep({
      audio,
      userId,
      episodeId,
    });

    // ---- DONE ----
    await setStatus(episodeId, "completed", {
      audio_path: audioPath,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[pipeline] Episode ${episodeId} failed:`, error);
    await failEpisode(episodeId, error);
  }
}
