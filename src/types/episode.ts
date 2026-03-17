export type EpisodeSourceType = "topic" | "feed_summary";

export type EpisodeStyle = "monologue" | "interview" | "group_chat";
export type EpisodeTone =
  | "serious"
  | "lighthearted"
  | "dark_mystery"
  | "business_news";
export type EpisodeLanguage =
  | "en"
  | "de"
  | "es"
  | "fr"
  | "pt"
  | "it"
  | "nl"
  | "pl"
  | "ja"
  | "ko"
  | "zh"
  | "hi"
  | "ar";
export type EpisodeStatus =
  | "pending"
  | "searching"
  | "summarizing"
  | "scripting"
  | "generating_audio"
  | "uploading"
  | "completed"
  | "failed";

export const LANGUAGE_OPTIONS: { code: EpisodeLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
];

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
