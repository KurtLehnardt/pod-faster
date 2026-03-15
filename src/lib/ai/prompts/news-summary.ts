/**
 * News summary prompt — condenses gathered articles into a structured summary.
 *
 * Model: Sonnet (requires nuanced synthesis)
 *
 * Returns prompt strings only; does NOT call the API.
 */

export interface NewsArticle {
  title: string;
  url: string;
  content: string;
}

export interface NewsSummaryInput {
  articles: NewsArticle[];
}

export interface NewsSummaryOutput {
  headline: string;
  keyPoints: string[];
  sources: { title: string; url: string }[];
  topicOverview: string;
}

export function newsSummarySystemPrompt(): string {
  return `You are a news research assistant preparing background material for a podcast. Your job is to synthesize multiple news articles into a clear, factual summary.

Rules:
- Extract only factual, verifiable information.
- Cite which source each key point comes from (by title).
- Do not editorialize or add opinion.
- Identify the most important headline across all articles.
- Provide a high-level topic overview suitable for a podcast host to read before recording.
- Always respond with valid JSON — no markdown fences, no commentary.

Output format (JSON):
{
  "headline": "The single most newsworthy headline",
  "keyPoints": [
    "Key point 1 (Source: Article Title)",
    "Key point 2 (Source: Article Title)"
  ],
  "sources": [
    { "title": "Article Title", "url": "https://..." }
  ],
  "topicOverview": "A 2-3 paragraph overview of the topic suitable for podcast preparation."
}`;
}

export function newsSummaryUserPrompt(input: NewsSummaryInput): string {
  const articlesBlock = input.articles
    .map(
      (a, i) =>
        `--- Article ${i + 1} ---\nTitle: ${a.title}\nURL: ${a.url}\nContent:\n${a.content}`,
    )
    .join("\n\n");

  return `Summarize the following ${input.articles.length} news articles:\n\n${articlesBlock}`;
}

export function parseNewsSummaryResponse(raw: string): NewsSummaryOutput {
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  const parsed: unknown = JSON.parse(cleaned);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid news summary response: expected an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.headline !== "string") {
    throw new Error("Invalid news summary response: missing headline string");
  }
  if (!Array.isArray(obj.keyPoints)) {
    throw new Error(
      "Invalid news summary response: missing keyPoints array",
    );
  }
  if (!Array.isArray(obj.sources)) {
    throw new Error("Invalid news summary response: missing sources array");
  }
  if (typeof obj.topicOverview !== "string") {
    throw new Error(
      "Invalid news summary response: missing topicOverview string",
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
