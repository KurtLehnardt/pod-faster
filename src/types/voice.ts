export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

export type VoiceRole = "narrator" | "host" | "expert" | "guest" | "co_host";
