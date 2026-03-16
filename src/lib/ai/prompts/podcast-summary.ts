/**
 * Podcast summary prompt — synthesizes transcripts from multiple podcast episodes
 * into a structured summary suitable for generating a summary podcast.
 *
 * Model: Sonnet (requires nuanced synthesis across multiple sources)
 *
 * Returns prompt strings only; does NOT call the API.
 */

import type { NewsSummaryOutput } from "./news-summary";

export interface PodcastTranscript {
  podcastTitle: string;
  episodeTitle: string;
  transcript: string;
  publishedAt: string | null;
}

export interface PodcastSummaryInput {
  transcripts: PodcastTranscript[];
  targetLengthMinutes: number;
}

export function podcastSummarySystemPrompt(): string {
  return `You are a podcast research assistant preparing background material for a summary podcast. Your job is to synthesize transcripts from multiple podcast episodes into a clear, well-organized summary.

Rules:
- Extract key insights, arguments, recommendations, and notable quotes from each transcript.
- ALWAYS attribute insights to the specific podcast and episode they came from.
- Cover ALL source podcasts proportionally — do not focus on just one podcast. If 4 podcasts are provided, each should get roughly equal representation.
- Identify the most compelling overarching theme or headline across all episodes.
- Handle variable transcript quality: some transcripts may be show-notes-only or low-quality auto-transcriptions. Extract what you can and note when a source had limited content.
- Capture disagreements, debates, or contrasting perspectives between different podcasts.
- Do not editorialize or add your own opinion.
- Provide a high-level topic overview suitable for a podcast host to read before recording.
- Always respond with valid JSON — no markdown fences, no commentary.

Output format (JSON):
{
  "headline": "The single most compelling headline across all podcasts",
  "keyPoints": [
    "Key insight 1 (Source: Podcast Title - Episode Title)",
    "Key insight 2 (Source: Podcast Title - Episode Title)"
  ],
  "sources": [
    { "title": "Episode Title", "url": "Podcast Title" }
  ],
  "topicOverview": "A 2-3 paragraph overview synthesizing the key themes suitable for podcast preparation."
}

Note: In the sources array, "url" is repurposed to hold the podcast name for attribution.`;
}

export function podcastSummaryUserPrompt(input: PodcastSummaryInput): string {
  const transcriptsBlock = input.transcripts
    .map(
      (t, i) =>
        `--- Podcast ${i + 1} ---\nPodcast: ${t.podcastTitle}\nEpisode: ${t.episodeTitle}\nPublished: ${t.publishedAt ?? "Unknown"}\nTranscript:\n${t.transcript}`,
    )
    .join("\n\n");

  return `Synthesize the following ${input.transcripts.length} podcast episode transcripts into a summary for a ${input.targetLengthMinutes}-minute summary podcast:\n\n${transcriptsBlock}`;
}

export function parsePodcastSummaryResponse(raw: string): NewsSummaryOutput {
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  const parsed: unknown = JSON.parse(cleaned);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid podcast summary response: expected an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.headline !== "string") {
    throw new Error(
      "Invalid podcast summary response: missing headline string",
    );
  }
  if (!Array.isArray(obj.keyPoints)) {
    throw new Error(
      "Invalid podcast summary response: missing keyPoints array",
    );
  }
  if (!Array.isArray(obj.sources)) {
    throw new Error(
      "Invalid podcast summary response: missing sources array",
    );
  }
  if (typeof obj.topicOverview !== "string") {
    throw new Error(
      "Invalid podcast summary response: missing topicOverview string",
    );
  }

  return {
    headline: obj.headline,
    keyPoints: obj.keyPoints.filter(
      (p): p is string => typeof p === "string",
    ),
    sources: (obj.sources as { title?: string; url?: string }[])
      .filter(
        (s) => typeof s.title === "string" && typeof s.url === "string",
      )
      .map((s) => ({ title: s.title as string, url: s.url as string })),
    topicOverview: obj.topicOverview,
  };
}

/**
 * Build the podcast summary prompt pair (system + user).
 * Convenience wrapper matching the task specification signature.
 */
export function buildPodcastSummaryPrompt(params: {
  transcripts: PodcastTranscript[];
  targetLengthMinutes: number;
}): { system: string; user: string } {
  return {
    system: podcastSummarySystemPrompt(),
    user: podcastSummaryUserPrompt({
      transcripts: params.transcripts,
      targetLengthMinutes: params.targetLengthMinutes,
    }),
  };
}
