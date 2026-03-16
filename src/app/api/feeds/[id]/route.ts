/**
 * Single feed CRUD — get, update, and delete a podcast feed.
 *
 * GET    /api/feeds/[id]  — single feed with recent episodes
 * PUT    /api/feeds/[id]  — update feed (toggle is_active, rename)
 * DELETE /api/feeds/[id]  — delete feed (cascades episodes)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { updateFeedSchema } from "@/lib/validation/feed-schemas";
import type { PodcastFeed, FeedEpisode } from "@/types/feed";

// ---------------------------------------------------------------------------
// Route params type
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/feeds/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  // Fetch feed with ownership check
  const { data: feed, error } = await supabase
    .from("podcast_feeds")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !feed) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }

  // Fetch last 20 episodes ordered by published_at
  const { data: episodes, error: epError } = await supabase
    .from("feed_episodes")
    .select("*")
    .eq("feed_id", id)
    .eq("user_id", user.id)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(20);

  if (epError) {
    console.error("[feeds] Episodes fetch error:", epError);
    return NextResponse.json(
      { error: "Failed to fetch episodes" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    feed: feed as PodcastFeed,
    episodes: (episodes ?? []) as FeedEpisode[],
  });
}

// ---------------------------------------------------------------------------
// PUT /api/feeds/[id]
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate with Zod
  const parsed = updateFeedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Check that at least one field is being updated
  const updateData = parsed.data;
  if (updateData.is_active === undefined && updateData.title === undefined) {
    return NextResponse.json(
      { error: "No update fields provided. Allowed: is_active, title" },
      { status: 400 }
    );
  }

  // Verify ownership before update
  const { data: existing } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }

  // Build update payload — only set fields that were provided
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updateData.is_active !== undefined) {
    payload.is_active = updateData.is_active;
  }
  if (updateData.title !== undefined) {
    payload.title = updateData.title;
  }

  const { data: feed, error } = await supabase
    .from("podcast_feeds")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("[feeds] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update feed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ feed: feed as PodcastFeed });
}

// ---------------------------------------------------------------------------
// DELETE /api/feeds/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  // Verify ownership
  const { data: existing } = await supabase
    .from("podcast_feeds")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }

  // Delete feed — cascade handles feed_episodes and summary_config_feeds.
  // NOTE: Cascades work correctly because the FK constraints use ON DELETE CASCADE
  // at the database level, which executes regardless of RLS policies. The
  // user-scoped Supabase client only controls whether the DELETE on podcast_feeds
  // itself is authorised (via RLS), but once the row is deleted, Postgres handles
  // the cascade internally.
  const { error } = await supabase
    .from("podcast_feeds")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[feeds] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete feed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: true });
}
