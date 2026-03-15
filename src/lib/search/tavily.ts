import type { TavilyResponse, TavilyResult } from "@/types/search";

const TAVILY_API_URL = "https://api.tavily.com/search";
const CONTENT_CHAR_LIMIT = 2000;

export interface TavilySearchParams {
  query: string;
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  topic?: "general" | "news";
  includeAnswer?: boolean;
  includeRawContent?: boolean;
}

export class TavilyError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new TavilyError("TAVILY_API_KEY environment variable is not set");
  }
  return key;
}

function truncateContent(content: string): string {
  if (content.length <= CONTENT_CHAR_LIMIT) return content;
  return content.slice(0, CONTENT_CHAR_LIMIT);
}

export async function searchTavily(
  params: TavilySearchParams,
): Promise<TavilyResult[]> {
  const {
    query,
    searchDepth = "basic",
    maxResults = 5,
    topic = "news",
    includeAnswer = false,
    includeRawContent = false,
  } = params;

  if (!query.trim()) {
    throw new TavilyError("Search query cannot be empty");
  }

  const apiKey = getApiKey();

  const body = {
    api_key: apiKey,
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    topic,
    include_answer: includeAnswer,
    include_raw_content: includeRawContent,
  };

  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new TavilyError(
      `Tavily API error: ${response.status} — ${text}`,
      response.status,
    );
  }

  const data = (await response.json()) as TavilyResponse;

  return data.results.map((result) => ({
    ...result,
    content: truncateContent(result.content),
    raw_content: result.raw_content
      ? truncateContent(result.raw_content)
      : undefined,
  }));
}
