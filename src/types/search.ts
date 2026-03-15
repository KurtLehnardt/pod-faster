export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
  raw_content?: string;
}

export interface TavilyResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}
