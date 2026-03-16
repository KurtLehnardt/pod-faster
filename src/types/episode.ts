export type EpisodeSourceType = "topic" | "feed_summary";

export type EpisodeStyle = "monologue" | "interview" | "group_chat";
export type EpisodeTone =
  | "serious"
  | "lighthearted"
  | "dark_mystery"
  | "business_news";
export type EpisodeStatus =
  | "pending"
  | "searching"
  | "summarizing"
  | "scripting"
  | "generating_audio"
  | "uploading"
  | "completed"
  | "failed";

export interface ScriptSegment {
  speaker: string;
  text: string;
  voice_id: string;
}

export interface EpisodeScript {
  title: string;
  segments: ScriptSegment[];
}

export interface VoiceConfig {
  voices: { role: string; voice_id: string; name: string }[];
}
