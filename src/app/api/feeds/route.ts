/**
 * Feed CRUD -- list and create podcast feeds.
 *
 * GET  /api/feeds  -- list user's podcast feeds with episode counts
 * POST /api/feeds  -- add a single RSS feed
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { createFeedSchema } from "@/lib/validation/feed-schemas";
import { validateFeedUrl } from "@/lib/rss/url-validator";
import { parseFeed } from "@/lib/rss/parser";
import { extractTranscript } from "@/lib/rss/transcript";
import type { PodcastFeed } from "@/types/feed";
import type { Database } from "@/types/database.types";
import { MAX_FEEDS_PER_USER } from "@/lib/utils/constants";

// ---------------------------------------------------------------------------
// Row types from Database schema
// ---------------------------------------------------------------------------

type PodcastFeedRow = Database["public"]["Tables"]["podcast_feeds"]["Row"];
type FeedEpisodeInsert = Database["public"]["Tables"]["feed_episodes"]["Insert"];

// ---------------------------------------------------------------------------
// GET /api/feeds
// ---------------------------------------------------------------------------

export async function GET() {
  // TODO: Add per-user rate limiting (see rate-limit infrastructure task)
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  // Fetch all feeds for the user
  const { data, error } = await supabase
    .from("podcast_feeds")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[feeds] List error:", error);
    return NextResponse.json(
      { error: "Failed to list feeds" },
      { status: 500 }
    );
  }

  const feeds = (data ?? []) as PodcastFeedRow[];

  // Get episode counts per feed using the RPC
  const feedIds = feeds.map((f) => f.id);
  const feedsWithCounts: Array<PodcastFeed & { episode_count: number }> = [];

  if (feedIds.length > 0) {
    // RPC defined in migration 00005 but not yet in generated Database types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: countData, error: countError } = await (supabase.rpc as any)(
      "feed_episode_counts",
      { p_feed_ids: feedIds }
    );

    if (countError) {
      console.error("[feeds] Count RPC error:", countError);
      // Return feeds without counts rather than failing
      for (const feed of feeds) {
        feedsWithCounts.push({ ...feed, episode_count: 0 });
      }
    } else {
      const counts = (countData ?? []) as Array<{
        feed_id: string;
        episode_count: number;
      }>;
      const countMap = new Map<string, number>();
      for (const row of counts) {
        countMap.set(row.feed_id, Number(row.episode_count));
      }
      for (const feed of feeds) {
        feedsWithCounts.push({
          ...feed,
          episode_count: countMap.get(feed.id) ?? 0,
        });
      }
    }
  }

  return NextResponse.json({ feeds: feedsWithCounts });
}

// ---------------------------------------------------------------------------
// POST /api/feeds
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // TODO: Add per-user rate limiting (see rate-limit infrastructure task)
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate with Zod schema
  const parsed = createFeedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { feedUrl } = parsed.data;

  // Validate URL (SSRF protection)
  const urlValidation = validateFeedUrl(feedUrl);
  if (!urlValidation.valid) {
    return NextResponse.json(
      { error: `Invalid feed URL: ${urlValidation.error}` },
      { status: 400 }
    );
  }

  // Check per-user feed limit
  const { count: existingCount, error: countError } = await supabase
    .from("podcast_feeds")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    console.error("[feeds] Count error:", countError);
    return NextResponse.json(
      { error: "Failed to check feed limit" },
      { status: 500 }
    );
  }

  if ((existingCount ?? 0) >= MAX_FEEDS_PER_USER) {
    return NextResponse.json(
      {
        error: `Feed limit reached. Maximum ${MAX_FEEDS_PER_USER} feeds per user.`,
      },
      { status: 409 }
    );
  }

  // Check for duplicate feed URL
  const { data: existingFeedData } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("user_id", user.id)
    .eq("feed_url", feedUrl)
    .maybeSingle();

  if (existingFeedData) {
    return NextResponse.json(
      { error: "You are already subscribed to this feed" },
      { status: 409 }
    );
  }

  // Parse the feed to get metadata and episodes
  let parsedFeed: Awaited<ReturnType<typeof parseFeed>>;
  try {
    parsedFeed = await parseFeed(feedUrl);
  } catch (err) {
    console.error("[feeds] Feed parse error:", err);
    return NextResponse.json(
      { error: "Unable to fetch or parse feed" },
      { status: 422 }
    );
  }

  // Insert the feed row
  const { data: insertedData, error: insertError } = await supabase
    .from("podcast_feeds")
    .insert({
      user_id: user.id,
      feed_url: feedUrl,
      title: parsedFeed.title,
      description: parsedFeed.description,
      image_url: parsedFeed.imageUrl,
      is_active: true,
      last_polled_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError || !insertedData) {
    console.error("[feeds] Insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create feed" },
      { status: 500 }
    );
  }

  const feed = insertedData as PodcastFeedRow;

  // Batch insert episodes with transcripts
  let episodesImported = 0;

  // Prepare episode rows (extract transcripts first since they need async calls)
  const episodeRows: FeedEpisodeInsert[] = [];
  for (const ep of parsedFeed.episodes) {
    let transcript: string | null = null;
    let transcriptSource: "rss_description" | "rss_transcript" | "podcast_index" | null = null;

    try {
      const result = await extractTranscript({
        transcriptUrl: ep.transcriptUrl,
        description: ep.description,
        audioUrl: ep.audioUrl,
        podcastTitle: parsedFeed.title,
      });
      transcript = result.transcript;
      transcriptSource = result.source;
    } catch {
      // Transcript extraction failure is non-fatal
    }

    episodeRows.push({
      feed_id: feed.id,
      user_id: user.id,
      guid: ep.guid,
      title: ep.title,
      description: ep.description,
      audio_url: ep.audioUrl,
      published_at: ep.publishedAt?.toISOString() ?? null,
      duration_seconds: ep.durationSeconds,
      transcript,
      transcript_source: transcriptSource,
      transcription_status: transcript ? "completed" : "none",
    });
  }

  // Batch upsert all episodes at once
  if (episodeRows.length > 0) {
    const { error: upsertError, data: upsertData } = await supabase
      .from("feed_episodes")
      .upsert(episodeRows, {
        onConflict: "feed_id,guid",
        ignoreDuplicates: true,
      })
      .select("id");

    if (upsertError) {
      console.warn("[feeds] Episode batch upsert warning:", upsertError.message);
    } else {
      episodesImported = upsertData?.length ?? 0;
    }
  }

  // Update last_episode_at based on imported episodes
  const latestEpisode = parsedFeed.episodes
    .filter((ep) => ep.publishedAt !== null)
    .sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
    )[0];

  if (latestEpisode?.publishedAt) {
    await supabase
      .from("podcast_feeds")
      .update({ last_episode_at: latestEpisode.publishedAt.toISOString() })
      .eq("id", feed.id);
  }

  return NextResponse.json(
    { feed: feed as PodcastFeed, episodesImported },
    { status: 201 }
  );
}
