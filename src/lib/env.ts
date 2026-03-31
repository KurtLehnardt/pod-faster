/**
 * Validate required environment variables at import time.
 * Import this module early (e.g., in middleware or layout) to fail fast.
 */

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "TAVILY_API_KEY",
] as const;

const optional = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "PODCAST_INDEX_KEY",
  "PODCAST_INDEX_SECRET",
  "ADMIN_EMAILS",
] as const;

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0 && process.env.NODE_ENV !== "test") {
  throw new Error(
    `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join("\n")}\n\nCheck your .env file.`
  );
}

export const env = {
  ...Object.fromEntries(required.map((key) => [key, process.env[key]!])),
  ...Object.fromEntries(optional.map((key) => [key, process.env[key] ?? ""])),
} as Record<(typeof required)[number] | (typeof optional)[number], string>;
