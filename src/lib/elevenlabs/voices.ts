import type { Voice } from "@/types/voice";
import { elevenLabsFetch } from "./client";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface VoiceCache {
  voices: Voice[];
  timestamp: number;
}

let cache: VoiceCache | null = null;

/**
 * List available ElevenLabs voices.
 *
 * Results are cached in-process memory for 5 minutes to avoid
 * hitting the API on every request (voice list rarely changes).
 */
export async function listVoices(): Promise<Voice[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.voices;
  }

  const response = await elevenLabsFetch("/voices");
  const data: { voices: ElevenLabsVoiceResponse[] } = await response.json();

  const voices: Voice[] = data.voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category ?? "unknown",
    description: v.description ?? undefined,
    preview_url: v.preview_url ?? undefined,
    labels: v.labels ?? undefined,
  }));

  cache = { voices, timestamp: Date.now() };
  return voices;
}

/**
 * Invalidate the voice cache (useful for testing or after adding custom voices).
 */
export function invalidateVoiceCache(): void {
  cache = null;
}

// ---- Internal types matching the ElevenLabs API response shape ----

interface ElevenLabsVoiceResponse {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}
