/**
 * TypeScript types generated from the pod-faster Supabase schema.
 * Based on migrations: 00001_initial_schema through 00007_feed_source_tracking.
 */

export type FeedSource = "imported" | "spotify";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type EpisodeStatus =
  | "pending"
  | "searching"
  | "summarizing"
  | "scripting"
  | "generating_audio"
  | "uploading"
  | "completed"
  | "failed";

export type EpisodeSourceType = "topic" | "feed_summary";

export type SubscriptionTier = "free" | "pro" | "premium";

export type PodcastStyle = "monologue" | "interview" | "group_chat";

export type PodcastTone =
  | "serious"
  | "lighthearted"
  | "dark_mystery"
  | "business_news";

export type VoiceRole = "narrator" | "host" | "expert" | "guest" | "co_host";

export type ChatRole = "user" | "assistant";

export type Cadence = "daily" | "twice_weekly" | "weekly" | "on_new_episodes";

export type TranscriptSource =
  | "rss_description"
  | "rss_transcript"
  | "podcast_index"
  | "elevenlabs_stt"
  | "manual";

export type TranscriptionStatus =
  | "none"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type SummaryGenerationStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          default_length: number;
          default_style: PodcastStyle;
          default_tone: PodcastTone;
          default_voice_id: string | null;
          subscription_tier: SubscriptionTier;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          default_length?: number;
          default_style?: PodcastStyle;
          default_tone?: PodcastTone;
          default_voice_id?: string | null;
          subscription_tier?: SubscriptionTier;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          default_length?: number;
          default_style?: PodcastStyle;
          default_tone?: PodcastTone;
          default_voice_id?: string | null;
          subscription_tier?: SubscriptionTier;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      topics: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topics_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      episodes: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          length_minutes: number;
          style: PodcastStyle;
          tone: PodcastTone;
          status: EpisodeStatus;
          error_message: string | null;
          topic_query: string;
          sources: Json | null;
          summary: string | null;
          script: Json | null;
          audio_path: string | null;
          audio_duration_seconds: number | null;
          voice_config: Json | null;
          claude_tokens_used: number;
          elevenlabs_characters_used: number;
          source_type: EpisodeSourceType;
          summary_config_id: string | null;
          language: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          length_minutes?: number;
          style: PodcastStyle;
          tone: PodcastTone;
          status?: EpisodeStatus;
          error_message?: string | null;
          topic_query: string;
          sources?: Json | null;
          summary?: string | null;
          script?: Json | null;
          audio_path?: string | null;
          audio_duration_seconds?: number | null;
          voice_config?: Json | null;
          claude_tokens_used?: number;
          elevenlabs_characters_used?: number;
          source_type?: EpisodeSourceType;
          summary_config_id?: string | null;
          language?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          length_minutes?: number;
          style?: PodcastStyle;
          tone?: PodcastTone;
          status?: EpisodeStatus;
          error_message?: string | null;
          topic_query?: string;
          sources?: Json | null;
          summary?: string | null;
          script?: Json | null;
          audio_path?: string | null;
          audio_duration_seconds?: number | null;
          voice_config?: Json | null;
          claude_tokens_used?: number;
          elevenlabs_characters_used?: number;
          source_type?: EpisodeSourceType;
          summary_config_id?: string | null;
          language?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "episodes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "episodes_summary_config_id_fkey";
            columns: ["summary_config_id"];
            isOneToOne: false;
            referencedRelation: "summary_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      voice_presets: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          elevenlabs_voice_id: string;
          role: VoiceRole;
          description: string | null;
          is_system: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          elevenlabs_voice_id: string;
          role: VoiceRole;
          description?: string | null;
          is_system?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string;
          elevenlabs_voice_id?: string;
          role?: VoiceRole;
          description?: string | null;
          is_system?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voice_presets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      spotify_tokens: {
        Row: {
          id: string;
          user_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          expires_at: string;
          spotify_user_id: string;
          spotify_display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          encrypted_access_token: string;
          encrypted_refresh_token: string;
          expires_at: string;
          spotify_user_id: string;
          spotify_display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          encrypted_access_token?: string;
          encrypted_refresh_token?: string;
          expires_at?: string;
          spotify_user_id?: string;
          spotify_display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "spotify_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      spotify_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          spotify_show_id: string;
          show_name: string;
          publisher: string;
          description: string;
          image_url: string | null;
          spotify_url: string;
          total_episodes: number;
          summarization_enabled: boolean;
          is_removed: boolean;
          synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          spotify_show_id: string;
          show_name: string;
          publisher?: string;
          description?: string;
          image_url?: string | null;
          spotify_url?: string;
          total_episodes?: number;
          summarization_enabled?: boolean;
          is_removed?: boolean;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          spotify_show_id?: string;
          show_name?: string;
          publisher?: string;
          description?: string;
          image_url?: string | null;
          spotify_url?: string;
          total_episodes?: number;
          summarization_enabled?: boolean;
          is_removed?: boolean;
          synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "spotify_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          user_id: string;
          episode_id: string | null;
          role: ChatRole;
          content: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          episode_id?: string | null;
          role: ChatRole;
          content: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          episode_id?: string | null;
          role?: ChatRole;
          content?: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
        ];
      };
      podcast_feeds: {
        Row: {
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
          source: FeedSource;
          spotify_show_id: string | null;
          auto_transcribe: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          feed_url: string;
          title?: string | null;
          description?: string | null;
          image_url?: string | null;
          last_polled_at?: string | null;
          last_episode_at?: string | null;
          is_active?: boolean;
          poll_error?: string | null;
          poll_error_count?: number;
          source?: FeedSource;
          spotify_show_id?: string | null;
          auto_transcribe?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          feed_url?: string;
          title?: string | null;
          description?: string | null;
          image_url?: string | null;
          last_polled_at?: string | null;
          last_episode_at?: string | null;
          is_active?: boolean;
          poll_error?: string | null;
          poll_error_count?: number;
          source?: FeedSource;
          spotify_show_id?: string | null;
          auto_transcribe?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "podcast_feeds_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      feed_episodes: {
        Row: {
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
          is_partial_transcript: boolean;
          transcript_clip_range: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          feed_id: string;
          user_id: string;
          guid: string;
          title: string;
          description?: string | null;
          audio_url?: string | null;
          published_at?: string | null;
          duration_seconds?: number | null;
          transcript?: string | null;
          transcript_source?: TranscriptSource | null;
          transcription_status?: TranscriptionStatus;
          transcription_error?: string | null;
          elevenlabs_cost_cents?: number;
          is_partial_transcript?: boolean;
          transcript_clip_range?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          feed_id?: string;
          user_id?: string;
          guid?: string;
          title?: string;
          description?: string | null;
          audio_url?: string | null;
          published_at?: string | null;
          duration_seconds?: number | null;
          transcript?: string | null;
          transcript_source?: TranscriptSource | null;
          transcription_status?: TranscriptionStatus;
          transcription_error?: string | null;
          elevenlabs_cost_cents?: number;
          is_partial_transcript?: boolean;
          transcript_clip_range?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feed_episodes_feed_id_fkey";
            columns: ["feed_id"];
            isOneToOne: false;
            referencedRelation: "podcast_feeds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feed_episodes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      summary_configs: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          cadence: Cadence;
          preferred_time: string | null;
          timezone: string | null;
          style: PodcastStyle;
          tone: PodcastTone;
          length_minutes: number;
          voice_config: Json | null;
          is_active: boolean;
          last_generated_at: string | null;
          next_due_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          cadence?: Cadence;
          preferred_time?: string | null;
          timezone?: string | null;
          style?: PodcastStyle;
          tone?: PodcastTone;
          length_minutes?: number;
          voice_config?: Json | null;
          is_active?: boolean;
          last_generated_at?: string | null;
          next_due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          cadence?: Cadence;
          preferred_time?: string | null;
          timezone?: string | null;
          style?: PodcastStyle;
          tone?: PodcastTone;
          length_minutes?: number;
          voice_config?: Json | null;
          is_active?: boolean;
          last_generated_at?: string | null;
          next_due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "summary_configs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      summary_config_feeds: {
        Row: {
          summary_config_id: string;
          feed_id: string;
          is_included: boolean;
          auto_excluded: boolean;
          auto_exclude_reason: string | null;
        };
        Insert: {
          summary_config_id: string;
          feed_id: string;
          is_included?: boolean;
          auto_excluded?: boolean;
          auto_exclude_reason?: string | null;
        };
        Update: {
          summary_config_id?: string;
          feed_id?: string;
          is_included?: boolean;
          auto_excluded?: boolean;
          auto_exclude_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "summary_config_feeds_summary_config_id_fkey";
            columns: ["summary_config_id"];
            isOneToOne: false;
            referencedRelation: "summary_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "summary_config_feeds_feed_id_fkey";
            columns: ["feed_id"];
            isOneToOne: false;
            referencedRelation: "podcast_feeds";
            referencedColumns: ["id"];
          },
        ];
      };
      summary_generation_log: {
        Row: {
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
        };
        Insert: {
          id?: string;
          summary_config_id: string;
          user_id: string;
          episode_id?: string | null;
          status?: SummaryGenerationStatus;
          error_message?: string | null;
          feeds_included?: number;
          feeds_excluded?: number;
          episodes_summarized?: number;
          claude_tokens_used?: number;
          elevenlabs_characters_used?: number;
          started_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          summary_config_id?: string;
          user_id?: string;
          episode_id?: string | null;
          status?: SummaryGenerationStatus;
          error_message?: string | null;
          feeds_included?: number;
          feeds_excluded?: number;
          episodes_summarized?: number;
          claude_tokens_used?: number;
          elevenlabs_characters_used?: number;
          started_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "summary_generation_log_summary_config_id_fkey";
            columns: ["summary_config_id"];
            isOneToOne: false;
            referencedRelation: "summary_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "summary_generation_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "summary_generation_log_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      stt_monthly_cost: {
        Args: { p_user_id: string };
        Returns: number;
      };
      stt_weekly_count: {
        Args: { p_user_id: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
  };
}
