/**
 * Feed polling — trigger poll for new episodes.
 *
 * POST /api/feeds/poll
 * Body: { feedId?: string } — poll specific feed or all active feeds
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pollFeed } from "@/lib/rss/poller";
import { extractTranscript } from "@/lib/rss/transcript";
import type { PodcastFeed } from "@/types/feed";
import type { Database } from "@/types/database.types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between polls for a single feed (15 minutes). */
const MIN_POLL_INTERVAL_MS = 15 * 60 * 1000;

/** Number of consecutive errors before auto-deactivating a feed. */
const MAX_POLL_ERRORS = 5;

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

type PodcastFeedRow = Database["public"]["Tables"]["podcast_feeds"]["Row"];

// ---------------------------------------------------------------------------
// POST /api/feeds/poll
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body (feedId is optional)
  let feedId: string | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.feedId !== undefined) {
      if (typeof body.feedId !== "string" || body.feedId.trim().length === 0) {
        return NextResponse.json(
          { error: "feedId must be a non-empty string if provided" },
          { status: 400 }
        );
      }
      feedId = body.feedId;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Determine which feeds to poll
  let feedsToPoll: PodcastFeed[];

  if (feedId) {
    // Specific feed — verify ownership
    const { data: feedData, error } = await supabase
      .from("podcast_feeds")
      .select("*")
      .eq("id", feedId)
      .eq("user_id", user.id)
      .single();

    if (error || !feedData) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    const feed = feedData as PodcastFeedRow;

    // Check minimum poll interval
    if (feed.last_polled_at) {
      const lastPolled = new Date(feed.last_polled_at).getTime();
      const now = Date.now();
      if (now - lastPolled < MIN_POLL_INTERVAL_MS) {
        const waitMinutes = Math.ceil(
          (MIN_POLL_INTERVAL_MS - (now - lastPolled)) / 60_000
        );
        return NextResponse.json(
          {
            error: `Feed was polled recently. Please wait ${waitMinutes} minute(s) before polling again.`,
          },
          { status: 429 }
        );
      }
    }

    feedsToPoll = [feed as PodcastFeed];
  } else {
    // All active feeds for this user
    const { data: feedsData, error } = await supabase
      .from("podcast_feeds")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (error) {
      console.error("[feeds/poll] Fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch feeds" },
        { status: 500 }
      );
    }

    feedsToPoll = ((feedsData ?? []) as PodcastFeedRow[]) as PodcastFeed[];
  }

  if (feedsToPoll.length === 0) {
    return NextResponse.json({ polled: 0, newEpisodes: 0 });
  }

  let totalPolled = 0;
  let totalNewEpisodes = 0;

  for (const feed of feedsToPoll) {
    try {
      // Get existing episode GUIDs
      const { data: existingEpData } = await supabase
        .from("feed_episodes")
        .select("guid")
        .eq("feed_id", feed.id);

      const existingGuids = ((existingEpData ?? []) as Array<{ guid: string }>).map(
        (e) => e.guid
      );

      // Poll the feed
      const result = await pollFeed({
        feedUrl: feed.feed_url,
        lastPolledAt: feed.last_polled_at
          ? new Date(feed.last_polled_at)
          : null,
        existingGuids,
      });

      let newEpisodeCount = 0;

      // Insert new episodes
      for (const ep of result.newEpisodes) {
        // Try to extract a free transcript
        let transcript: string | null = null;
        let transcriptSource: "rss_transcript" | "rss_description" | "podcast_index" | null =
          null;

        try {
          const txResult = await extractTranscript({
            transcriptUrl: ep.transcriptUrl,
            description: ep.description,
            audioUrl: ep.audioUrl,
            podcastTitle: result.feed.title,
          });
          transcript = txResult.transcript;
          transcriptSource = txResult.source;
        } catch {
          // Transcript extraction failure is non-fatal
        }

        const { error: epError } = await supabase
          .from("feed_episodes")
          .insert({
            feed_id: feed.id,
            user_id: feed.user_id,
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

        if (!epError) {
          newEpisodeCount++;
        } else {
          console.warn(
            "[feeds/poll] Episode insert warning:",
            epError.message
          );
        }
      }

      // Determine the latest episode date
      const latestDate = result.newEpisodes
        .filter((ep) => ep.publishedAt !== null)
        .sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
        )[0]?.publishedAt;

      // Update feed metadata
      const updatePayload: Record<string, unknown> = {
        last_polled_at: new Date().toISOString(),
        poll_error: null,
        poll_error_count: 0,
      };

      if (latestDate) {
        // Only update if newer than current
        if (
          !feed.last_episode_at ||
          latestDate.getTime() > new Date(feed.last_episode_at).getTime()
        ) {
          updatePayload.last_episode_at = latestDate.toISOString();
        }
      }

      // Update feed title/description if changed
      if (result.feed.title && result.feed.title !== feed.title) {
        updatePayload.title = result.feed.title;
      }
      if (
        result.feed.description &&
        result.feed.description !== feed.description
      ) {
        updatePayload.description = result.feed.description;
      }
      if (result.feed.imageUrl && result.feed.imageUrl !== feed.image_url) {
        updatePayload.image_url = result.feed.imageUrl;
      }

      await supabase
        .from("podcast_feeds")
        .update(updatePayload)
        .eq("id", feed.id);

      totalPolled++;
      totalNewEpisodes += newEpisodeCount;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      console.error(`[feeds/poll] Error polling feed ${feed.id}:`, message);

      // Increment error count and potentially auto-deactivate
      const newErrorCount = feed.poll_error_count + 1;
      const updatePayload: Record<string, unknown> = {
        poll_error: message,
        poll_error_count: newErrorCount,
        last_polled_at: new Date().toISOString(),
      };

      if (newErrorCount >= MAX_POLL_ERRORS) {
        updatePayload.is_active = false;
        console.warn(
          `[feeds/poll] Auto-deactivated feed ${feed.id} after ${newErrorCount} consecutive errors`
        );
      }

      await supabase
        .from("podcast_feeds")
        .update(updatePayload)
        .eq("id", feed.id);
    }
  }

  return NextResponse.json({ polled: totalPolled, newEpisodes: totalNewEpisodes });
}
