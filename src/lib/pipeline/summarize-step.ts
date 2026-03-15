/**
 * Pipeline Step 2 — SUMMARIZE
 *
 * Uses Claude (Sonnet) to synthesize gathered articles into a structured
 * summary suitable for podcast script generation.
 */

import type { SearchResult } from "@/types/search";
import { completeJson, MODEL_SONNET } from "@/lib/ai/chat";
import {
  newsSummarySystemPrompt,
  newsSummaryUserPrompt,
  parseNewsSummaryResponse,
  type NewsSummaryOutput,
} from "@/lib/ai/prompts/news-summary";

export interface SummarizeStepResult {
  summary: NewsSummaryOutput;
  tokensUsed: number;
}

/**
 * Summarize the gathered search results into a structured news summary.
 *
 * The summary includes a headline, key points, source attribution,
 * and a topic overview that the script generation step will consume.
 */
export async function summarizeStep(
  sources: SearchResult[]
): Promise<SummarizeStepResult> {
  if (sources.length === 0) {
    throw new Error("Cannot summarize: no sources provided");
  }

  const articles = sources.map((s) => ({
    title: s.title,
    url: s.url,
    content: s.content,
  }));

  const { data, usage } = await completeJson(
    {
      system: newsSummarySystemPrompt(),
      userPrompt: newsSummaryUserPrompt({ articles }),
      model: MODEL_SONNET,
      maxTokens: 4096,
      temperature: 0,
    },
    parseNewsSummaryResponse
  );

  const tokensUsed = usage.inputTokens + usage.outputTokens;

  return { summary: data, tokensUsed };
}
