/**
 * OPML feed import — bulk-import podcast feeds from an OPML file.
 *
 * POST /api/feeds/import
 * Body: { opml: string } (XML content, max 1 MB)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { importOpmlSchema } from "@/lib/validation/feed-schemas";
import { parseOpml, parseFeed } from "@/lib/rss/parser";
import type { Database } from "@/types/database.types";
import { MAX_FEEDS_PER_USER } from "@/lib/utils/constants";

type PodcastFeedRow = Database["public"]["Tables"]["podcast_feeds"]["Row"];

// ---------------------------------------------------------------------------
// POST /api/feeds/import
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const message =
      err instanceof Error ? err.message : "Failed to parse OPML";
    return NextResponse.json(
      { error: `OPML parse error: ${message}` },
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

  // Process each feed from the OPML
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  let totalFeedsProcessed = currentCount;

  for (const opmlFeed of opmlFeeds) {
    // Check if adding another would exceed the limit
    if (totalFeedsProcessed >= MAX_FEEDS_PER_USER) {
      errors.push(
        `Skipped remaining feeds: user feed limit (${MAX_FEEDS_PER_USER}) reached`
      );
      break;
    }

    // Skip if already subscribed
    if (existingUrls.has(opmlFeed.feedUrl)) {
      skipped++;
      continue;
    }

    // Try to parse the feed for metadata
    try {
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
        // Could be a race condition duplicate
        if (insertError?.code === "23505") {
          skipped++;
        } else {
          errors.push(
            `${opmlFeed.feedUrl}: ${insertError?.message ?? "Insert failed"}`
          );
        }
        continue;
      }

      const insertedFeed = insertedData as Pick<PodcastFeedRow, "id">;

      // Track the URL to avoid duplicates within this batch
      existingUrls.add(opmlFeed.feedUrl);
      totalFeedsProcessed++;
      created++;

      // Insert episodes (best-effort, don't fail the whole import)
      for (const ep of parsedFeed.episodes) {
        await supabase
          .from("feed_episodes")
          .insert({
            feed_id: insertedFeed.id,
            user_id: user.id,
            guid: ep.guid,
            title: ep.title,
            description: ep.description,
            audio_url: ep.audioUrl,
            published_at: ep.publishedAt?.toISOString() ?? null,
            duration_seconds: ep.durationSeconds,
          })
          .then(({ error: epErr }) => {
            if (epErr) {
              console.warn(
                "[feeds/import] Episode insert warning:",
                epErr.message
              );
            }
          });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      errors.push(`${opmlFeed.feedUrl}: ${message}`);
    }
  }

  return NextResponse.json({ created, skipped, errors }, { status: 201 });
}
