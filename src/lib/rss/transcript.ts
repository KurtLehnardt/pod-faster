/**
 * Transcript extraction from multiple sources.
 *
 * Priority order:
 * 1. Fetch from transcriptUrl (RSS podcast:transcript tag) — text, SRT, or VTT
 * 2. PodcastIndex API lookup (if API key is configured)
 * 3. Fallback: strip HTML from episode description if > 200 chars
 * 4. null if nothing found
 */

import { validateFeedUrl } from "./url-validator";

// ── Public Types ──────────────────────────────────────────────

export interface TranscriptParams {
  transcriptUrl: string | null;
  description: string | null;
  audioUrl: string | null;
  podcastTitle: string | null;
}

export interface TranscriptResult {
  transcript: string | null;
  source: "rss_description" | "podcast_index" | null;
  truncated: boolean;
}

// ── Constants ────────────────────────────────────────────────

const MAX_TRANSCRIPT_BYTES = 512_000; // 500 KB
const MIN_DESCRIPTION_CHARS = 200;
const PODCAST_INDEX_BASE = "https://api.podcastindex.org/api/1.0";
const FETCH_TIMEOUT_MS = 15_000;

// ── extractTranscript ────────────────────────────────────────

export async function extractTranscript(
  params: TranscriptParams
): Promise<TranscriptResult> {
  const { transcriptUrl, description, audioUrl, podcastTitle } = params;

  // 1. Try transcript URL from RSS
  if (transcriptUrl) {
    const result = await fetchTranscriptUrl(transcriptUrl);
    if (result) return result;
  }

  // 2. Try PodcastIndex API
  const podcastIndexResult = await tryPodcastIndex(audioUrl, podcastTitle);
  if (podcastIndexResult) return podcastIndexResult;

  // 3. Fallback to description
  if (description) {
    const stripped = stripHtml(description);
    if (stripped.length >= MIN_DESCRIPTION_CHARS) {
      return truncateResult(stripped, "rss_description");
    }
  }

  // 4. Nothing found
  return { transcript: null, source: null, truncated: false };
}

// ── Internal: Fetch transcript from URL ──────────────────────

async function fetchTranscriptUrl(
  url: string
): Promise<TranscriptResult | null> {
  const validation = validateFeedUrl(url);
  if (!validation.valid) return null;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/plain, text/vtt, text/srt, */*" },
    });

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.trim().length === 0) return null;

    // Parse SRT/VTT to plain text, or use as-is
    const plain = parseSrtVtt(text);
    // Use "rss_description" as the closest source type for transcript URL
    // (the DB enum doesn't have a dedicated "rss_transcript_url" value)
    return truncateResult(plain, "rss_description");
  } catch {
    return null;
  }
}

// ── Internal: PodcastIndex API lookup ────────────────────────

async function tryPodcastIndex(
  audioUrl: string | null,
  podcastTitle: string | null
): Promise<TranscriptResult | null> {
  const apiKey = process.env.PODCAST_INDEX_API_KEY;
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET;

  if (!apiKey || !apiSecret) return null;
  if (!podcastTitle) return null;

  try {
    const authDate = Math.floor(Date.now() / 1000).toString();
    const query = encodeURIComponent(podcastTitle);
    const url = audioUrl
      ? `${PODCAST_INDEX_BASE}/episodes/byfeedurl?url=${encodeURIComponent(audioUrl)}`
      : `${PODCAST_INDEX_BASE}/search/byterm?q=${query}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "X-Auth-Key": apiKey,
        "X-Auth-Date": authDate,
        "User-Agent": "pod-faster/1.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as PodcastIndexResponse;

    // Look for a transcript URL in the results
    const episodes = data.items ?? data.episodes ?? [];
    for (const episode of episodes) {
      if (episode.transcriptUrl) {
        const result = await fetchTranscriptUrl(episode.transcriptUrl);
        if (result) {
          return { ...result, source: "podcast_index" };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

interface PodcastIndexEpisode {
  transcriptUrl?: string;
}

interface PodcastIndexResponse {
  items?: PodcastIndexEpisode[];
  episodes?: PodcastIndexEpisode[];
}

// ── Internal: SRT/VTT to plain text ─────────────────────────

/**
 * Strip SRT/VTT timestamps and cue identifiers, leaving only the spoken text.
 * If the input doesn't look like SRT/VTT, return it as-is.
 */
function parseSrtVtt(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip WEBVTT header
    if (trimmed.startsWith("WEBVTT")) continue;
    // Skip NOTE blocks
    if (trimmed.startsWith("NOTE")) continue;
    // Skip timestamp lines (00:00:00.000 --> 00:00:00.000)
    if (/^\d{2}:\d{2}/.test(trimmed) && trimmed.includes("-->")) continue;
    // Skip pure numeric cue identifiers
    if (/^\d+$/.test(trimmed)) continue;
    // Skip empty lines
    if (trimmed.length === 0) continue;

    // Strip inline VTT tags like <v Speaker>, <c>, etc.
    const cleaned = trimmed.replace(/<[^>]+>/g, "").trim();
    if (cleaned.length > 0) {
      output.push(cleaned);
    }
  }

  return output.join(" ");
}

// ── Internal: HTML stripping ─────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Internal: Truncation ─────────────────────────────────────

function truncateResult(
  text: string,
  source: "rss_description" | "podcast_index"
): TranscriptResult {
  const truncated = text.length > MAX_TRANSCRIPT_BYTES;
  return {
    transcript: truncated ? text.slice(0, MAX_TRANSCRIPT_BYTES) : text,
    source,
    truncated,
  };
}
