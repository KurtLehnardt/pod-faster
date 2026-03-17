/**
 * Pipeline Step 3 — SCRIPT
 *
 * Uses Claude (Sonnet) to generate a full podcast script from the summary.
 * Applies style, tone, and length constraints. Returns structured segments.
 */

import type { EpisodeStyle, EpisodeTone, EpisodeScript, VoiceConfig } from "@/types/episode";
import type { NewsSummaryOutput } from "@/lib/ai/prompts/news-summary";
import { completeJson, MODEL_SONNET } from "@/lib/ai/chat";
import {
  scriptGenerationSystemPrompt,
  scriptGenerationUserPrompt,
  parseScriptGenerationResponse,
  type ScriptGenerationInput,
} from "@/lib/ai/prompts/script-generation";

export interface ScriptStepParams {
  summary: NewsSummaryOutput;
  style: EpisodeStyle;
  tone: EpisodeTone;
  lengthMinutes: number;
  voiceConfig: VoiceConfig;
  language?: string;
}

export interface ScriptStepResult {
  script: EpisodeScript;
  tokensUsed: number;
}

/**
 * Generate a podcast script from the news summary.
 *
 * The script is structured as an array of speaker segments, each with
 * a speaker name, text, and voice_id for TTS rendering.
 */
export async function scriptStep(
  params: ScriptStepParams
): Promise<ScriptStepResult> {
  const { summary, style, tone, lengthMinutes, voiceConfig, language } = params;

  const input: ScriptGenerationInput = {
    summary,
    style,
    tone,
    lengthMinutes,
    voices: voiceConfig,
    language,
  };

  // Use higher max tokens for longer episodes — ~150 words/minute,
  // ~0.75 tokens/word, plus JSON overhead
  const estimatedTokens = Math.max(4096, lengthMinutes * 150 * 2);
  const maxTokens = Math.min(estimatedTokens, 8192);

  const { data, usage } = await completeJson(
    {
      system: scriptGenerationSystemPrompt(input),
      userPrompt: scriptGenerationUserPrompt(input),
      model: MODEL_SONNET,
      maxTokens,
      temperature: 0.7,
    },
    parseScriptGenerationResponse
  );

  const tokensUsed = usage.inputTokens + usage.outputTokens;

  return { script: data, tokensUsed };
}
