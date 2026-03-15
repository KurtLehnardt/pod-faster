const BASE_URL = "https://api.elevenlabs.io/v1";

let cachedApiKey: string | null = null;

function getApiKey(): string | null {
  if (cachedApiKey) return cachedApiKey;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  cachedApiKey = key;
  return key;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/**
 * Exponential backoff delay for retries.
 * base * 2^attempt with jitter: 1s, 2s, 4s, ...
 */
function backoffMs(attempt: number, baseMs = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs * 0.5;
  return exponential + jitter;
}

/**
 * Make a request to the ElevenLabs API with automatic retry on 429 (rate limit).
 * Retries up to `maxRetries` times with exponential backoff.
 */
export async function elevenLabsFetch(
  path: string,
  init: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new ElevenLabsError(
      "ELEVENLABS_API_KEY is not set. Get your key from https://elevenlabs.io/app/settings/api-keys",
      503
    );
  }
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "xi-api-key": apiKey,
    ...(init.headers as Record<string, string>),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 429 && attempt < maxRetries) {
      const delay = backoffMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text().catch(() => undefined);
      }
      throw new ElevenLabsError(
        `ElevenLabs API error: ${response.status} ${response.statusText} on ${path}`,
        response.status,
        detail
      );
    }

    return response;
  }

  // Unreachable — the loop always returns or throws — but satisfies TypeScript.
  throw new ElevenLabsError("Max retries exceeded", 429);
}

/**
 * Reset the cached API key (useful for testing).
 */
export function resetClient(): void {
  cachedApiKey = null;
}
