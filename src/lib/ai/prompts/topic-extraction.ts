/**
 * Topic extraction prompt — identifies news topics from natural language input.
 *
 * Model: Haiku (classification task, low complexity)
 *
 * Returns prompt strings only; does NOT call the API.
 */

export interface TopicExtractionInput {
  userMessage: string;
}

export interface TopicExtractionOutput {
  topics: string[];
  suggestedQuery: string;
}

export function topicExtractionSystemPrompt(): string {
  return `You are a news topic extraction assistant. Your job is to analyze a user's natural language message and identify the specific news topics they want to learn about.

Rules:
- Extract concrete, searchable topics (not vague categories).
- Return between 1 and 5 topics, ordered by relevance.
- Generate a single combined search query that would find the most relevant recent news.
- If the user's message is ambiguous, interpret it in the context of current events and news.
- Always respond with valid JSON — no markdown fences, no commentary.

Output format (JSON):
{
  "topics": ["topic1", "topic2"],
  "suggestedQuery": "a search engine query string"
}`;
}

export function topicExtractionUserPrompt(input: TopicExtractionInput): string {
  return `Extract news topics from this message:\n\n"${input.userMessage}"`;
}

export function parseTopicExtractionResponse(
  raw: string,
): TopicExtractionOutput {
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  const parsed: unknown = JSON.parse(cleaned);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as TopicExtractionOutput).topics) ||
    typeof (parsed as TopicExtractionOutput).suggestedQuery !== "string"
  ) {
    throw new Error(
      "Invalid topic extraction response: missing topics array or suggestedQuery string",
    );
  }

  const result = parsed as TopicExtractionOutput;

  return {
    topics: result.topics.filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    ),
    suggestedQuery: result.suggestedQuery,
  };
}
