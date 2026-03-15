/**
 * Podcast script generation prompt.
 *
 * Model: Sonnet (creative generation, structured output)
 *
 * Supports 3 styles and 4 tones. Calibrates length to ~150 words/minute.
 *
 * Returns prompt strings only; does NOT call the API.
 */

import type {
  EpisodeStyle,
  EpisodeTone,
  EpisodeScript,
  VoiceConfig,
} from "@/types/episode";
import type { NewsSummaryOutput } from "./news-summary";

export interface ScriptGenerationInput {
  summary: NewsSummaryOutput;
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes: number;
  voices: VoiceConfig;
}

const STYLE_INSTRUCTIONS: Record<EpisodeStyle, string> = {
  monologue: `Style: MONOLOGUE
- Single narrator delivering a cohesive, storytelling-driven episode.
- Use conversational but authoritative tone.
- Include natural pauses (marked as brief silence) for emphasis.
- Structure: hook, context, deep dive, takeaway.`,

  interview: `Style: INTERVIEW
- Two speakers: a Host who asks questions and an Expert who provides answers.
- Host drives the conversation with natural follow-ups.
- Expert provides depth, examples, and analysis.
- Structure: introduction, 3-5 question rounds, wrap-up.`,

  group_chat: `Style: GROUP CHAT
- 2-3 speakers discussing the topic naturally.
- Include interjections, agreements, disagreements, and natural banter.
- Each speaker has a distinct perspective.
- Structure: topic introduction, free-flowing discussion, closing thoughts.`,
};

const TONE_INSTRUCTIONS: Record<EpisodeTone, string> = {
  serious: `Tone: SERIOUS
- Professional, measured delivery. Focus on facts and analysis.
- Minimal humor. Gravitas in word choice.`,

  lighthearted: `Tone: LIGHTHEARTED
- Upbeat, conversational, approachable.
- Okay to include light humor, analogies, and relatable comparisons.
- Still factually accurate — fun does not mean inaccurate.`,

  dark_mystery: `Tone: DARK MYSTERY
- Atmospheric, suspenseful narration.
- Use dramatic pauses, rhetorical questions, and vivid imagery.
- Build tension even when discussing factual news.`,

  business_news: `Tone: BUSINESS NEWS
- Crisp, efficient, Bloomberg/CNBC-style delivery.
- Lead with numbers and impact. Attribution to sources.
- Forward-looking analysis: "What this means for..."`,
};

export function scriptGenerationSystemPrompt(
  input: ScriptGenerationInput,
): string {
  const targetWords = input.lengthMinutes * 150;
  const voiceMap = input.voices.voices
    .map((v) => `  - Role: "${v.role}" → voice_id: "${v.voice_id}" (${v.name})`)
    .join("\n");

  return `You are a podcast script writer. Generate a complete podcast script based on the provided news summary.

${STYLE_INSTRUCTIONS[input.style]}

${TONE_INSTRUCTIONS[input.tone]}

Target length: ~${targetWords} words (${input.lengthMinutes} minutes at 150 words/minute).

Available voices:
${voiceMap}

Rules:
- Each segment is a single speaker turn.
- Use the exact voice_id values from the voice map above.
- The "speaker" field should be a human-readable name (e.g., "Host", "Expert", the voice name).
- Every segment must reference one of the provided voice_id values.
- Generate a compelling title for the episode.
- Stay faithful to the source material — do not fabricate facts.
- Always respond with valid JSON — no markdown fences, no commentary.

Output format (JSON):
{
  "title": "Episode Title",
  "segments": [
    { "speaker": "Host", "text": "What the speaker says...", "voice_id": "voice_id_here" }
  ]
}`;
}

export function scriptGenerationUserPrompt(
  input: ScriptGenerationInput,
): string {
  const { summary } = input;

  return `Generate a podcast script based on this news summary:

Headline: ${summary.headline}

Key Points:
${summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Topic Overview:
${summary.topicOverview}

Sources: ${summary.sources.map((s) => s.title).join(", ")}`;
}

export function parseScriptGenerationResponse(raw: string): EpisodeScript {
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  const parsed: unknown = JSON.parse(cleaned);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid script response: expected an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.title !== "string" || !obj.title) {
    throw new Error("Invalid script response: missing or empty title");
  }

  if (!Array.isArray(obj.segments) || obj.segments.length === 0) {
    throw new Error("Invalid script response: missing or empty segments array");
  }

  const segments = (
    obj.segments as { speaker?: string; text?: string; voice_id?: string }[]
  ).map((seg, i) => {
    if (typeof seg.speaker !== "string" || !seg.speaker) {
      throw new Error(`Invalid segment ${i}: missing speaker`);
    }
    if (typeof seg.text !== "string" || !seg.text) {
      throw new Error(`Invalid segment ${i}: missing text`);
    }
    if (typeof seg.voice_id !== "string" || !seg.voice_id) {
      throw new Error(`Invalid segment ${i}: missing voice_id`);
    }
    return {
      speaker: seg.speaker,
      text: seg.text,
      voice_id: seg.voice_id,
    };
  });

  return { title: obj.title, segments };
}
