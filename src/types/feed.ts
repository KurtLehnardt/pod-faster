/**
 * TypeScript types for the podcast feed importer feature.
 * Maps to tables: podcast_feeds, feed_episodes, summary_configs,
 * summary_config_feeds, summary_generation_log.
 */

import type { Json } from "./database.types";

// ── Enums / Union Types ──────────────────────────────────────

export type Cadence = "daily" | "twice_weekly" | "weekly" | "on_new_episodes";

export type TranscriptSource =
  | "rss_transcript"
  | "rss_description"
  | "podcast_index"
  | "elevenlabs_stt"
  | "manual";

export type TranscriptionStatus =
  | "none"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type EpisodeSourceType = "topic" | "feed_summary";

export type SummaryGenerationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

// ── Table Interfaces ─────────────────────────────────────────

export interface PodcastFeed {
  id: string;
  user_id: string;
  feed_url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  last_polled_at: string | null;
  last_episode_at: string | null;
  is_active: boolean;
  poll_error: string | null;
  poll_error_count: number;
  created_at: string;
  updated_at: string;
}

export interface FeedEpisode {
  id: string;
  feed_id: string;
  user_id: string;
  guid: string;
  title: string;
  description: string | null;
  audio_url: string | null;
  published_at: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_source: TranscriptSource | null;
  transcription_status: TranscriptionStatus;
  transcription_error: string | null;
  elevenlabs_cost_cents: number;
  created_at: string;
}

export interface SummaryConfig {
  id: string;
  user_id: string;
  name: string;
  cadence: Cadence;
  preferred_time: string | null;
  timezone: string | null;
  style: "monologue" | "interview" | "group_chat";
  tone: "serious" | "lighthearted" | "dark_mystery" | "business_news";
  length_minutes: number;
  voice_config: Json | null;
  is_active: boolean;
  last_generated_at: string | null;
  next_due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SummaryConfigFeed {
  summary_config_id: string;
  feed_id: string;
  is_included: boolean;
  auto_excluded: boolean;
  auto_exclude_reason: string | null;
}

export interface SummaryGenerationLog {
  id: string;
  summary_config_id: string;
  user_id: string;
  episode_id: string | null;
  status: SummaryGenerationStatus;
  error_message: string | null;
  feeds_included: number;
  feeds_excluded: number;
  episodes_summarized: number;
  claude_tokens_used: number;
  elevenlabs_characters_used: number;
  started_at: string;
  completed_at: string | null;
}
