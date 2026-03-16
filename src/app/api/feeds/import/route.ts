/**
 * OPML feed import -- bulk-import podcast feeds from an OPML file.
 *
 * POST /api/feeds/import
 * Body: { opml: string } (XML content, max 1 MB)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { importOpmlSchema } from "@/lib/validation/feed-schemas";
import { parseOpml, parseFeed } from "@/lib/rss/parser";
import type { Database } from "@/types/database.types";
import { MAX_FEEDS_PER_USER } from "@/lib/utils/constants";

type PodcastFeedRow = Database["public"]["Tables"]["podcast_feeds"]["Row"];

/** Number of feeds to process concurrently during OPML import. */
const BATCH_SIZE = 5;

// ---------------------------------------------------------------------------
// POST /api/feeds/import
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
  const parsed = importOpmlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { opml } = parsed.data;

  // Parse the OPML content
  let opmlFeeds: Awaited<ReturnType<typeof parseOpml>>;
  try {
    opmlFeeds = await parseOpml(opml);
  } catch (err) {
    console.error("[feeds/import] OPML parse error:", err);
    return NextResponse.json(
      { error: "OPML parse error" },
      { status: 422 }
    );
  }

  if (opmlFeeds.length === 0) {
    return NextResponse.json(
      { error: "No valid feed URLs found in OPML content" },
      { status: 422 }
    );
  }

  // Check per-user feed limit
  const { count: existingCount, error: countError } = await supabase
    .from("podcast_feeds")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    console.error("[feeds/import] Count error:", countError);
    return NextResponse.json(
      { error: "Failed to check feed limit" },
      { status: 500 }
    );
  }

  const currentCount = existingCount ?? 0;
  if (currentCount >= MAX_FEEDS_PER_USER) {
    return NextResponse.json(
      {
        error: `Feed limit reached. You already have ${currentCount} feeds (max ${MAX_FEEDS_PER_USER}).`,
      },
      { status: 409 }
    );
  }

  // Get existing feed URLs to skip duplicates
  const { data: existingFeedsData } = await supabase
    .from("podcast_feeds")
    .select("feed_url")
    .eq("user_id", user.id);

  const existingUrls = new Set(
    ((existingFeedsData ?? []) as Pick<PodcastFeedRow, "feed_url">[]).map(
      (f) => f.feed_url
    )
  );

  // Filter feeds: skip duplicates and respect limit
  const feedsToProcess: typeof opmlFeeds = [];
  let skipped = 0;
  let totalFeedsProcessed = currentCount;

  for (const opmlFeed of opmlFeeds) {
    if (totalFeedsProcessed >= MAX_FEEDS_PER_USER) {
      break;
    }
    if (existingUrls.has(opmlFeed.feedUrl)) {
      skipped++;
      continue;
    }
    existingUrls.add(opmlFeed.feedUrl);
    feedsToProcess.push(opmlFeed);
    totalFeedsProcessed++;
  }

  // Process feeds in parallel batches of BATCH_SIZE
  let created = 0;
  const errors: string[] = [];

  for (let i = 0; i < feedsToProcess.length; i += BATCH_SIZE) {
    const batch = feedsToProcess.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (opmlFeed) => {
        const parsedFeed = await parseFeed(opmlFeed.feedUrl);

        const { data: insertedData, error: insertError } = await supabase
          .from("podcast_feeds")
          .insert({
            user_id: user.id,
            feed_url: opmlFeed.feedUrl,
            title: parsedFeed.title,
            description: parsedFeed.description,
            image_url: parsedFeed.imageUrl,
            is_active: true,
            last_polled_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertError || !insertedData) {
          if (insertError?.code === "23505") {
            return { status: "skipped" as const };
          }
          throw new Error(insertError?.message ?? "Insert failed");
        }

        const insertedFeed = insertedData as Pick<PodcastFeedRow, "id">;

        // Batch upsert episodes
        if (parsedFeed.episodes.length > 0) {
          const episodeRows = parsedFeed.episodes.map((ep) => ({
            feed_id: insertedFeed.id,
            user_id: user.id,
            guid: ep.guid,
            title: ep.title,
            description: ep.description,
            audio_url: ep.audioUrl,
            published_at: ep.publishedAt?.toISOString() ?? null,
            duration_seconds: ep.durationSeconds,
          }));

          const { error: upsertError } = await supabase
            .from("feed_episodes")
            .upsert(episodeRows, {
              onConflict: "feed_id,guid",
              ignoreDuplicates: true,
            });

          if (upsertError) {
            console.warn(
              "[feeds/import] Episode batch upsert warning:",
              upsertError.message
            );
          }
        }

        return { status: "created" as const };
      })
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        if (result.value.status === "created") {
          created++;
        } else {
          skipped++;
        }
      } else {
        const feedUrl = batch[j].feedUrl;
        console.error(`[feeds/import] Failed to import ${feedUrl}:`, result.reason);
        errors.push(`${feedUrl}: import failed`);
      }
    }
  }

  return NextResponse.json({ created, skipped, errors }, { status: 201 });
}
