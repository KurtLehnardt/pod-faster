/**
 * TypeScript types generated from the pod-faster Supabase schema.
 * Based on migrations: 00001_initial_schema, 00002_rls_policies,
 * 00003_indexes, 00004_storage.
 */

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

export type PodcastStyle = "monologue" | "interview" | "group_chat";

export type PodcastTone =
  | "serious"
  | "lighthearted"
  | "dark_mystery"
  | "business_news";

export type VoiceRole = "narrator" | "host" | "expert" | "guest" | "co_host";

export type ChatRole = "user" | "assistant";

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
          created_at?: string;
          updated_at?: string;
        };
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
          created_at?: string;
          completed_at?: string | null;
        };
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
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
