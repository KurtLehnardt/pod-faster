/**
 * RSS/OPML parser for podcast feed importer.
 *
 * - Parses RSS 2.0 and Atom feeds via rss-parser
 * - Parses OPML XML to extract feed URLs (supports nested groups)
 * - Extracts podcast:transcript URLs from RSS items
 */

import RssParser from "rss-parser";
import { parseStringPromise } from "xml2js";
import { validateFeedUrl, validateResolvedUrl } from "./url-validator";
import { createHash } from "crypto";

// ── Public Types ──────────────────────────────────────────────

export interface ParsedFeed {
  title: string;
  description: string | null;
  imageUrl: string | null;
  episodes: ParsedEpisode[];
}

export interface ParsedEpisode {
  guid: string;
  title: string;
  description: string | null;
  audioUrl: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  transcriptUrl: string | null;
}

export interface OpmlFeed {
  title: string | null;
  feedUrl: string;
}

// ── Constants ────────────────────────────────────────────────

const OPML_MAX_SIZE_BYTES = 1_048_576; // 1 MB

// ── Custom rss-parser fields ─────────────────────────────────

interface PodcastCustomFeed {
  subtitle?: string;
}

interface PodcastCustomItem {
  id?: string; // Atom <id> element (rss-parser uses `id` instead of `guid`)
  "podcast:transcript"?: string | { $: { url?: string; type?: string } };
}

const rssParser = new RssParser<PodcastCustomFeed, PodcastCustomItem>({
  customFields: {
    feed: ["subtitle"],
    item: ["podcast:transcript"],
  },
  timeout: 15_000,
});

// ── SSRF-safe fetch with redirect validation ────────────────

/**
 * Fetch feed XML with SSRF protection.
 * Follows redirects manually, validating each Location header
 * against both syntactic checks and DNS resolution checks.
 */
async function fetchFeedXml(url: string, maxRedirects = 3): Promise<string> {
  await validateResolvedUrl(url);
  let currentUrl = url;

  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without Location header");

      const resolved = new URL(location, currentUrl).toString();
      const redirectValidation = validateFeedUrl(resolved);
      if (!redirectValidation.valid) {
        throw new Error(`Redirect to invalid URL: ${redirectValidation.error}`);
      }
      await validateResolvedUrl(resolved);
      currentUrl = resolved;
      continue;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }

  throw new Error("Too many redirects");
}

// ── parseFeed ────────────────────────────────────────────────

/**
 * Parse a single RSS/Atom feed URL and return feed metadata + episodes.
 * Throws on invalid/malformed XML or failed fetch.
 *
 * Uses manual fetch with SSRF-safe redirect handling instead of
 * rssParser.parseURL() to prevent redirect-based SSRF attacks.
 */
export async function parseFeed(feedUrl: string): Promise<ParsedFeed> {
  const validation = validateFeedUrl(feedUrl);
  if (!validation.valid) {
    throw new Error(`Invalid feed URL: ${validation.error}`);
  }

  const xml = await fetchFeedXml(feedUrl);
  const feed = await rssParser.parseString(xml);

  const episodes: ParsedEpisode[] = feed.items.map((item) =>
    mapItem(item)
  );

  return {
    title: feed.title ?? "Untitled Feed",
    description: feed.description ?? feed.subtitle ?? null,
    imageUrl: feed.image?.url ?? feed.itunes?.image ?? null,
    episodes,
  };
}

/**
 * Parse a feed from an XML string (useful for testing and direct XML input).
 */
export async function parseFeedFromString(xml: string): Promise<ParsedFeed> {
  const feed = await rssParser.parseString(xml);

  const episodes: ParsedEpisode[] = feed.items.map((item) =>
    mapItem(item)
  );

  return {
    title: feed.title ?? "Untitled Feed",
    description: feed.description ?? feed.subtitle ?? null,
    imageUrl: feed.image?.url ?? feed.itunes?.image ?? null,
    episodes,
  };
}

// ── parseOpml ────────────────────────────────────────────────

/**
 * Parse OPML content (XML string) into a flat list of feed URLs with titles.
 * Handles nested folder groups by recursively extracting <outline> elements.
 * Rejects OPML content exceeding 1 MB.
 *
 * Uses xml2js for proper XML parsing instead of fragile regex patterns.
 */
export async function parseOpml(opmlContent: string): Promise<OpmlFeed[]> {
  if (opmlContent.length > OPML_MAX_SIZE_BYTES) {
    throw new Error(
      `OPML content exceeds maximum size of ${OPML_MAX_SIZE_BYTES} bytes`
    );
  }

  const result = await parseStringPromise(opmlContent);
  const feeds: OpmlFeed[] = [];

  function walkOutlines(outlines: Record<string, unknown>[]): void {
    for (const outline of outlines) {
      const attrs = (outline as Record<string, Record<string, string>>).$ ?? {};
      const xmlUrl = attrs.xmlUrl ?? attrs.xmlurl;

      if (xmlUrl) {
        const validation = validateFeedUrl(xmlUrl);
        if (!validation.valid) continue; // Skip invalid URLs silently

        const title = attrs.title ?? attrs.text ?? null;
        feeds.push({ title, feedUrl: xmlUrl });
      }

      // Recurse into nested outlines (folders)
      const children = (outline as Record<string, unknown>).outline;
      if (Array.isArray(children)) {
        walkOutlines(children as Record<string, unknown>[]);
      }
    }
  }

  const body = result?.opml?.body?.[0];
  if (body?.outline) {
    walkOutlines(body.outline as Record<string, unknown>[]);
  }

  return feeds;
}

// ── Internal helpers ─────────────────────────────────────────

type FeedItem = PodcastCustomItem & RssParser.Item;

/**
 * Map a raw rss-parser item to a ParsedEpisode.
 */
function mapItem(item: FeedItem): ParsedEpisode {
  return {
    guid: deriveGuid(item.guid ?? item.id, item.enclosure?.url, item.title),
    title: item.title ?? "Untitled",
    description: item.contentSnippet ?? item.content ?? item.summary ?? null,
    audioUrl: item.enclosure?.url ?? null,
    publishedAt: parseDate(item.isoDate ?? item.pubDate),
    durationSeconds: parseDuration(
      (item as Record<string, unknown>)["itunes:duration"] as string | undefined
    ),
    transcriptUrl: extractTranscriptUrl(item),
  };
}

/**
 * Derive a GUID from available data. Priority:
 * 1. Explicit guid from RSS
 * 2. SHA-256 hash of audio URL
 * 3. SHA-256 hash of title
 * 4. Random fallback (should never happen)
 */
function deriveGuid(
  guid: string | undefined,
  audioUrl: string | undefined,
  title: string | undefined
): string {
  if (guid && guid.trim().length > 0) return guid.trim();

  const hashInput = audioUrl ?? title;
  if (hashInput) {
    return createHash("sha256").update(hashInput).digest("hex").slice(0, 40);
  }

  return createHash("sha256")
    .update(Date.now().toString() + Math.random().toString())
    .digest("hex")
    .slice(0, 40);
}

/**
 * Parse a duration string into seconds.
 * Formats: "HH:MM:SS", "MM:SS", or raw seconds as string.
 */
export function parseDuration(raw: string | undefined | null): number | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Pure numeric → raw seconds
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // HH:MM:SS or MM:SS
  const parts = trimmed.split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => isNaN(p))) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return null;
}

function parseDate(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Extract the podcast:transcript URL from a feed item.
 * rss-parser returns the custom field as either:
 * - A string (plain text content)
 * - An object with `$` attribute containing `url` and `type`
 */
function extractTranscriptUrl(item: FeedItem): string | null {
  const transcript = item["podcast:transcript"];
  if (!transcript) return null;

  // Object form with $ attributes: { $: { url: "...", type: "..." } }
  if (typeof transcript === "object" && "$" in transcript && transcript.$.url) {
    return transcript.$.url;
  }

  // String form (plain text URL)
  if (typeof transcript === "string" && transcript.startsWith("http")) {
    return transcript;
  }

  return null;
}

